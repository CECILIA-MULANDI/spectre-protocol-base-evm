/**
 * Generate the recovery email body and mailto link for a user.
 *
 * Usage:
 *   npm run recover-link [newOwnerAddress]
 *
 * If newOwnerAddress is omitted, uses agentOwnerAddress from config (recover to self).
 * Reads the current nonce from chain so the body is always valid.
 *
 * Output:
 *   - The exact email body the user must send
 *   - A mailto link that pre-fills the body (paste into any email client link)
 */
import { loadConfig } from "./config.js";
import { buildClients } from "./network.js";
import { REGISTRY_ABI } from "./abi.js";

const [newOwner] = process.argv.slice(2);

const config = await loadConfig();
if (!config.agentOwnerAddress) {
  console.error("no agentOwnerAddress in config — run register first");
  process.exit(1);
}

const { publicClient } = buildClients(config);

const record = (await publicClient.readContract({
  address: config.registryAddress,
  abi: REGISTRY_ABI,
  functionName: "getRecord",
  args: [config.agentOwnerAddress],
})) as { nonce: bigint };

const targetOwner = (newOwner ?? config.agentOwnerAddress) as string;
const newPublicKey = BigInt(targetOwner).toString();
const nonce = record.nonce.toString();
const body = `${newPublicKey}:${nonce}`;

console.log("=== Recovery Email ===");
console.log("From:    your registered email address");
console.log("To:      recover@spectre.xyz");
console.log("Subject: (anything)");
console.log("Body (must be exactly this, plain text):");
console.log();
console.log(body);
console.log();
console.log("=== Mailto Link (opens email client with body pre-filled) ===");
console.log(`mailto:recover@spectre.xyz?subject=recovery&body=${encodeURIComponent(body + "\r\n")}`);
