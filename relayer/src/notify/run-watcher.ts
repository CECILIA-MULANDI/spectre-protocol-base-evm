/**
 * Standalone notification process: opens the DB, starts the watcher (chain →
 * queue) and the dispatcher (queue → webhook) side-by-side, and exits cleanly
 * on SIGTERM/SIGINT.
 *
 * Required env:
 *   SPECTRE_RPC       — RPC URL (Base mainnet or Base Sepolia)
 *   SPECTRE_REGISTRY  — SpectreRegistry address (0x-prefixed)
 *
 * Optional:
 *   SPECTRE_POLL_MS    — watcher poll interval (default 5000)
 *   SPECTRE_FROM_BLOCK — initial block on a fresh DB
 *   SPECTRE_DB_PATH    — override DB path (default relayer/state/spectre.db)
 */
import { startWatcher } from "./watcher.js";
import { startDispatcher } from "./dispatcher.js";
import { openDb, DEFAULT_DB_PATH } from "./db.js";
import { setDb as setSubsDb } from "./subscriptions.js";

const rpc = process.env.SPECTRE_RPC;
const registry = process.env.SPECTRE_REGISTRY as `0x${string}` | undefined;
if (!rpc || !registry) {
  console.error("SPECTRE_RPC and SPECTRE_REGISTRY are required");
  process.exit(1);
}

const dbPath = process.env.SPECTRE_DB_PATH ?? DEFAULT_DB_PATH;
const db = openDb(dbPath);
setSubsDb(db);
console.log(`[notify] DB opened at ${dbPath}`);

// Single AbortController fans out to both loops. SIGTERM/SIGINT trip it; the
// loops finish their current iteration and exit. A second signal force-exits.
const ac = new AbortController();
let signalled = false;
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    if (signalled) {
      console.error(`[notify] received ${sig} again; force-exiting`);
      process.exit(1);
    }
    signalled = true;
    console.log(`[notify] received ${sig}; stopping`);
    ac.abort();
  });
}

const watcher = startWatcher({
  rpcUrl: rpc,
  registryAddress: registry,
  db,
  pollIntervalMs: process.env.SPECTRE_POLL_MS
    ? Number(process.env.SPECTRE_POLL_MS)
    : undefined,
  startFromBlock: process.env.SPECTRE_FROM_BLOCK
    ? BigInt(process.env.SPECTRE_FROM_BLOCK)
    : undefined,
  signal: ac.signal,
});

const dispatcher = startDispatcher({ db, signal: ac.signal });

await Promise.all([watcher, dispatcher]);
db.close();
console.log("[notify] DB closed; goodbye");
process.exit(0);
