/**
 * Subscribe an agent owner's address to recovery-event notifications.
 *
 * Usage:
 *   tsx subscribe.ts <relayer-base-url> <webhook-endpoint>
 *
 * Reads the owner's private key from config.json (ownerPrivateKey) and signs a
 * canonical message proving control of the address. The relayer verifies the
 * signature before storing the subscription.
 *
 * Example:
 *   tsx subscribe.ts http://localhost:3001 https://hooks.example.com/spectre
 */
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "./config.js";

const [relayerUrl, endpoint] = process.argv.slice(2);
if (!relayerUrl || !endpoint) {
  console.error("usage: subscribe <relayer-base-url> <webhook-endpoint>");
  process.exit(1);
}

const config = await loadConfig();
const account = privateKeyToAccount(config.ownerPrivateKey);

// Random 16-byte nonce — replay protection against the same signed payload
// being reused. The relayer doesn't currently track nonces (subscriptions are
// idempotent set/replace), but we still include one so the signed message
// isn't fully deterministic.
const nonce = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex")}`;

const message = [
  "Spectre subscribe",
  `agent: ${account.address.toLowerCase()}`,
  `endpoint: ${endpoint}`,
  `nonce: ${nonce}`,
].join("\n");

const signature = await account.signMessage({ message });

const resp = await fetch(`${relayerUrl}/subscribe`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    agentOwner: account.address,
    endpoint,
    nonce,
    signature,
  }),
});

const body = await resp.json();
if (!resp.ok) {
  console.error(`subscribe failed (${resp.status}):`, body);
  process.exit(1);
}
console.log(`subscribed ${account.address} → ${endpoint}`);
