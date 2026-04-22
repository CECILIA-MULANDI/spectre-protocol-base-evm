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
import { parseEmail } from "./email/parser.js";
import { fetchDKIMPublicKey } from "./email/dkim.js";
import { buildWitness } from "./prover/witness.js";
import { generateProof, verifyProof } from "./prover/prover.js";

const WORLD_ID_RP_ID     = process.env.WORLD_ID_RP_ID ?? "";
const WORLD_ID_SIGNING_KEY = process.env.WORLD_ID_SIGNING_KEY ?? "";

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1_000_000 } });

app.post("/prove", upload.single("eml"), async (req, res) => {
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

    // Verify the body contains the correct recovery params
    const expectedBody = `${newPublicKeyBig}:${nonceBig}\r\n`;
    const actualBody = parsed.canonicalBody.toString("utf8");
    if (actualBody !== expectedBody) {
      res.status(400).json({
        error: "Email body must be exactly: {newPublicKey}:{nonce}\\r\\n",
        expected: JSON.stringify(expectedBody),
        got: JSON.stringify(actualBody),
      });
      return;
    }

    const pubkey = await fetchDKIMPublicKey(parsed.dkim.selector, parsed.dkim.domain);
    const witness = buildWitness(parsed, pubkey, newPublicKeyBig, nonceBig);
    const result = await generateProof(witness);

    res.json({
      proof: result.proof.toString("hex"),
      publicInputs: result.publicInputs.toString("hex"),
      fromAddress: parsed.fromAddress,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.post("/verify", async (req, res) => {
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
app.post("/worldid-context", (_req, res) => {
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

app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => console.log(`Spectre prover API listening on :${PORT}`));
