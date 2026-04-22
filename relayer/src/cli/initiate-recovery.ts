/**
 * Initiate recovery on SpectreRegistry.
 *
 * Usage: tsx initiate-recovery.ts <email.eml> <new-owner-address> <worldid-proof.json>
 *
 * Flow:
 *   1. Parse email, fetch DKIM key, build witness
 *   2. Generate UltraHonk proof via nargo + bb
 *   3. Verify proof off-chain
 *   4. Call SpectreRegistry.initiateRecovery() with email proof + World ID proof
 */
import { readFile } from "fs/promises";
import { loadConfig } from "./config.js";
import { buildClients } from "./network.js";
import { REGISTRY_ABI } from "./abi.js";
import { parseEmail } from "../email/parser.js";
import { fetchDKIMPublicKey } from "../email/dkim.js";
import { buildWitness } from "../prover/witness.js";
import { generateProof, verifyProof } from "../prover/prover.js";

const [emlPath, newOwner, worldIdPath] = process.argv.slice(2);
if (!emlPath || !newOwner || !worldIdPath) {
  console.error("usage: initiate-recovery.ts <email.eml> <new-owner-address> <worldid-proof.json>");
  process.exit(1);
}

const config = await loadConfig();
if (!config.agentOwnerAddress) {
  console.error("no agentOwnerAddress in config — run register first");
  process.exit(1);
}

const { publicClient, walletClient } = buildClients(config);

// Fetch current nonce from registry
const record = await publicClient.readContract({
  address: config.registryAddress,
  abi: REGISTRY_ABI,
  functionName: "getRecord",
  args: [config.agentOwnerAddress],
}) as { nonce: bigint };

const nonce = record.nonce;
console.log("current nonce:", nonce.toString());

// Build and generate email proof
const rawEml = await readFile(emlPath);
const parsed = await parseEmail(rawEml);
const dkimKey = await fetchDKIMPublicKey(parsed.domain, parsed.selector);
const witness = buildWitness(parsed, dkimKey, newOwner as `0x${string}`, nonce);

console.log("generating proof...");
const proofResult = await generateProof(witness);

console.log("verifying proof off-chain...");
const valid = await verifyProof(proofResult);
if (!valid) {
  console.error("proof verification failed — aborting");
  process.exit(1);
}
console.log("proof valid");

// Format proof for Solidity verifier
const proofBytes = ("0x" + proofResult.proof.toString("hex")) as `0x${string}`;
const publicInputs = Array.from({ length: proofResult.publicInputs.length / 32 }, (_, i) =>
  ("0x" + proofResult.publicInputs.subarray(i * 32, (i + 1) * 32).toString("hex")) as `0x${string}`
);

// Load World ID proof (generated externally via World ID SDK or World App)
const worldId = JSON.parse(await readFile(worldIdPath, "utf-8"));

const hash = await walletClient.writeContract({
  address: config.registryAddress,
  abi: REGISTRY_ABI,
  functionName: "initiateRecovery",
  args: [
    config.agentOwnerAddress,
    newOwner as `0x${string}`,
    proofBytes,
    publicInputs,
    BigInt(worldId.root),
    BigInt(worldId.nullifier_hash),
    worldId.proof as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint],
  ],
});

console.log("recovery initiated. tx:", hash);
await publicClient.waitForTransactionReceipt({ hash });
console.log("pending recovery written on-chain. timelock started.");
