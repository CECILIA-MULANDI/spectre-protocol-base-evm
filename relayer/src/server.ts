/**
 * Hosted prover API — accepts a .eml file + recovery params, returns a ZK proof.
 *
 * POST /prove
 *   multipart/form-data:
 *     eml          — raw .eml file
 *     newPublicKey — recovery key as decimal Field string
 *     nonce        — nonce as decimal string
 *
 *   Response 200:
 *     {
 *       proof:        hex string
 *       publicInputs: hex string
 *       fromAddress:  "user@example.com"
 *     }
 *
 * POST /verify
 *   JSON: { proof: hex, publicInputs: hex, verificationKey: hex }
 *   Response 200: { valid: true }
 */
import express from "express";
import cors from "cors";
import multer from "multer";
import { signRequest } from "@worldcoin/idkit-server";
import { isAddress } from "viem";
import { parseEmail } from "./email/parser.js";
import { fetchDKIMPublicKey } from "./email/dkim.js";
import {
  issueChallenge,
  verifyChallenge,
  sendRecoveryEmail,
  ChallengeCooldownError,
  EmailConfigError,
} from "./email/outbound.js";
import { buildWitness } from "./prover/witness.js";
import { generateProof, verifyProof } from "./prover/prover.js";
import { registerNotifyRoutes } from "./notify/api.js";
import { makeRateLimiter } from "./http/rateLimit.js";
import { startWatcher } from "./notify/watcher.js";
import { startDispatcher } from "./notify/dispatcher.js";
import { openDb, DEFAULT_DB_PATH } from "./notify/db.js";
import { setDb as setSubsDb } from "./notify/subscriptions.js";

const WORLD_ID_RP_ID     = process.env.WORLD_ID_RP_ID ?? "";
const WORLD_ID_SIGNING_KEY = process.env.WORLD_ID_SIGNING_KEY ?? "";

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1_000_000 } });

// S8: these endpoints are unauthenticated and CPU-bound (proof gen / verify).
// A per-IP token bucket stops trivial resource-exhaustion DoS. Stricter than
// the notify API's bucket because each request here is far more expensive.
// Production should still front this with a real WAF / edge limit.
const proverLimit = makeRateLimiter({
  capacity: 5,
  refillPerSec: 0.2, // ~1 request / 5s sustained, burst of 5
  message: "rate limit exceeded — prover is CPU-bound, retry shortly",
});

app.post("/prove", proverLimit, upload.single("eml"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "eml file is required" });
      return;
    }
    const { newPublicKey, nonce } = req.body as { newPublicKey?: string; nonce?: string };
    if (!newPublicKey || !nonce) {
      res.status(400).json({ error: "newPublicKey and nonce are required" });
      return;
    }

    const newPublicKeyBig = BigInt(newPublicKey);
    const nonceBig = BigInt(nonce);

    if (newPublicKeyBig === 0n || nonceBig === 0n) {
      res.status(400).json({ error: "newPublicKey and nonce must be non-zero" });
      return;
    }

    const parsed = await parseEmail(req.file.buffer);

    // Verify the subject contains the expected `spectre:<newPublicKey>:<nonce>` binding.
    const expectedBinding = `spectre:${newPublicKeyBig}:${nonceBig}`;
    const subjectValue = parsed.dkim.canonicalHeader
      .subarray(parsed.subjectValueStart, parsed.subjectValueEnd)
      .toString("utf8");
    if (!subjectValue.includes(expectedBinding)) {
      res.status(400).json({
        error: `Email subject must contain "${expectedBinding}"`,
        subject: subjectValue,
      });
      return;
    }

    const pubkey = await fetchDKIMPublicKey(parsed.dkim.selector, parsed.dkim.domain);
    const witness = buildWitness(parsed, pubkey, newPublicKeyBig, nonceBig);
    const result = await generateProof(witness);

    // Split binary public_inputs into 32-byte field elements, format as
    // comma-separated 0x-prefixed hex (matches BrowserProver output format).
    const piHex = result.publicInputs.toString("hex");
    const fieldHexes: string[] = [];
    for (let i = 0; i < piHex.length; i += 64) {
      fieldHexes.push(`0x${piHex.slice(i, i + 64)}`);
    }
    res.json({
      proof: result.proof.toString("hex"),
      publicInputs: fieldHexes.join(","),
      fromAddress: parsed.fromAddress,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.post("/verify", proverLimit, async (req, res) => {
  try {
    const { proof, publicInputs, verificationKey } = req.body as {
      proof?: string;
      publicInputs?: string;
      verificationKey?: string;
    };
    if (!proof || !publicInputs || !verificationKey) {
      res.status(400).json({ error: "proof, publicInputs, and verificationKey are required" });
      return;
    }
    const valid = await verifyProof({
      proof: Buffer.from(proof, "hex"),
      publicInputs: Buffer.from(publicInputs, "hex"),
      verificationKey: Buffer.from(verificationKey, "hex"),
    });
    res.json({ valid });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Returns a signed rp_context for IDKit v4. Called by the world-id-ui before opening the widget.
app.post("/worldid-context", proverLimit, (_req, res) => {
  if (!WORLD_ID_RP_ID || !WORLD_ID_SIGNING_KEY) {
    res.status(500).json({ error: "WORLD_ID_RP_ID and WORLD_ID_SIGNING_KEY must be set" });
    return;
  }
  const sig = signRequest({ signingKeyHex: WORLD_ID_SIGNING_KEY, action: "spectre-recovery" });
  res.json({
    rp_id:      WORLD_ID_RP_ID,
    nonce:      sig.nonce,
    created_at: sig.createdAt,
    expires_at: sig.expiresAt,
    signature:  sig.sig,
  });
});

// Email-confirmation challenge endpoints. Per-IP rate limit at the bucket
// below; per-destination-email cooldown enforced inside issueChallenge.
// Together they bound (IP-based) request floods and (email-based) harassment.
const emailLimit = makeRateLimiter({
  capacity: 5,
  refillPerSec: 0.05, // sustained ~3/min, burst of 5
  message: "rate limit exceeded — too many email requests, retry shortly",
});

function isValidEmail(email: unknown): email is string {
  if (typeof email !== "string") return false;
  if (email.length === 0 || email.length > 254) return false;
  // Structural check; production should swap for a real validator.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

app.post("/email/challenge", emailLimit, async (req, res) => {
  try {
    const { email } = req.body as { email?: unknown };
    if (!isValidEmail(email)) {
      res.status(400).json({ error: "valid email is required" });
      return;
    }
    await issueChallenge(email);
    res.status(204).end();
  } catch (err: unknown) {
    if (err instanceof ChallengeCooldownError) {
      res.status(429).json({
        error: "challenge cooldown",
        retryAfterMs: err.retryAfterMs,
      });
      return;
    }
    if (err instanceof EmailConfigError) {
      res
        .status(503)
        .json({ error: "email confirmation not configured on this relayer" });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.post("/email/verify", emailLimit, (req, res) => {
  const { email, code } = req.body as { email?: unknown; code?: unknown };
  if (!isValidEmail(email)) {
    res.status(400).json({ error: "valid email is required" });
    return;
  }
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    res.status(400).json({ error: "code must be a 6-digit string" });
    return;
  }
  const verified = verifyChallenge(email, code);
  res.status(verified ? 200 : 400).json({ verified });
});

app.post("/email/recovery", emailLimit, async (req, res) => {
  try {
    const { email, agentOwner, newOwner, nonce } = req.body as {
      email?: unknown;
      agentOwner?: unknown;
      newOwner?: unknown;
      nonce?: unknown;
    };
    if (!isValidEmail(email)) {
      res.status(400).json({ error: "valid email is required" });
      return;
    }
    if (!isAddress(agentOwner)) {
      res.status(400).json({ error: "agentOwner must be a valid address" });
      return;
    }
    if (!isAddress(newOwner)) {
      res.status(400).json({ error: "newOwner must be a valid address" });
      return;
    }
    if (typeof nonce !== "string" || !/^\d+$/.test(nonce)) {
      res.status(400).json({ error: "nonce must be a numeric string" });
      return;
    }
    await sendRecoveryEmail(email, agentOwner as string, newOwner as string, BigInt(nonce));
    res.status(204).end();
  } catch (err: unknown) {
    if (err instanceof EmailConfigError) {
      res
        .status(503)
        .json({ error: "email service not configured on this relayer" });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

// Open the SQLite connection used by the subscription store and (optionally)
// the watcher + dispatcher. setDb() makes it the singleton seen by api.ts.
const dbPath = process.env.SPECTRE_DB_PATH ?? DEFAULT_DB_PATH;
const db = openDb(dbPath);
setSubsDb(db);
console.log(`[server] notify DB opened at ${dbPath}`);

// Notification API: POST /subscribe, DELETE /subscribe/:agentOwner, GET /subscribe/:agentOwner
registerNotifyRoutes(app);

const PORT = process.env.PORT ?? 3001;
const httpServer = app.listen(PORT, () =>
  console.log(`Spectre prover API listening on :${PORT}`)
);

// Optionally start the watcher + dispatcher in the same process. Skipped
// unless both SPECTRE_RPC and SPECTRE_REGISTRY are set, so a prover-only
// deployment remains valid (run them in their own process via npm run watcher).
const watcherRpc = process.env.SPECTRE_RPC;
const watcherRegistry = process.env.SPECTRE_REGISTRY;
const ac = new AbortController();
let watcherDone: Promise<void> = Promise.resolve();
let dispatcherDone: Promise<void> = Promise.resolve();
if (watcherRpc && watcherRegistry) {
  watcherDone = startWatcher({
    rpcUrl: watcherRpc,
    registryAddress: watcherRegistry as `0x${string}`,
    db,
    confirmations: process.env.SPECTRE_CONFIRMATIONS
      ? BigInt(process.env.SPECTRE_CONFIRMATIONS)
      : undefined,
    signal: ac.signal,
  }).catch((err) => console.error("[watcher] fatal:", err));
  dispatcherDone = startDispatcher({ db, signal: ac.signal }).catch((err) =>
    console.error("[dispatcher] fatal:", err)
  );
} else {
  console.log(
    "[watcher] disabled — set SPECTRE_RPC and SPECTRE_REGISTRY to enable."
  );
}

// Graceful shutdown: stop accepting new HTTP requests, finish in-flight ones,
// abort the watcher + dispatcher loops, wait for both to drain, close the DB.
// Second signal force-exits.
let signalled = false;
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, async () => {
    if (signalled) {
      console.error(`[server] received ${sig} again; force-exiting`);
      process.exit(1);
    }
    signalled = true;
    console.log(`[server] received ${sig}; shutting down`);
    ac.abort();
    httpServer.close(() => console.log("[server] HTTP closed"));
    await Promise.all([watcherDone, dispatcherDone]);
    db.close();
    console.log("[server] DB closed; goodbye");
    process.exit(0);
  });
}
