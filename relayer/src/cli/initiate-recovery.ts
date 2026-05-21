/**
 * Initiate recovery on SpectreRegistry.
 *
 * Flow:
 *   1. Parse email, fetch DKIM key, build witness
 *   2. Generate UltraHonk proof via nargo + bb
 *   3. Verify proof off-chain
 *   4. Call SpectreRegistry.initiateRecovery() with email proof + World ID proof
 */
import { readFile } from "fs/promises";
import { encodeAbiParameters } from "viem";
import { loadConfig } from "./config.js";
import { buildClients } from "./network.js";
import { REGISTRY_ABI } from "./abi.js";
import { parseEmail } from "../email/parser.js";
import { fetchDKIMPublicKey } from "../email/dkim.js";
import { buildWitness } from "../prover/witness.js";
import { generateProof, verifyProof } from "../prover/prover.js";

const [emlPath, newOwner, worldIdPath] = process.argv.slice(2);
if (!emlPath || !newOwner || !worldIdPath) {
  console.error("error: email path, new-owner address, and worldid-proof.json are required");
  process.exit(1);
}

const config = await loadConfig();
if (!config.agentOwnerAddress) {
  console.error("no agentOwnerAddress in config — run register first");
  process.exit(1);
}

const { publicClient, walletClient } = await buildClients(config);

// Fetch current nonce from registry
const record = (await publicClient.readContract({
  address: config.registryAddress,
  abi: REGISTRY_ABI,
  functionName: "getRecord",
  args: [config.agentOwnerAddress],
})) as { nonce: bigint };

const nonce = record.nonce;
console.log("current nonce:", nonce.toString());

// Build and generate email proof
const rawEml = await readFile(emlPath);
const parsed = await parseEmail(rawEml);
const dkimKey = await fetchDKIMPublicKey(
  parsed.dkim.selector,
  parsed.dkim.domain
);
const witness = buildWitness(parsed, dkimKey, BigInt(newOwner), nonce);

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
const publicInputs = Array.from(
  { length: proofResult.publicInputs.length / 32 },
  (_, i) =>
    ("0x" +
      proofResult.publicInputs
        .subarray(i * 32, (i + 1) * 32)
        .toString("hex")) as `0x${string}`
);

// Load World ID proof (generated externally via World ID SDK or World App)
const worldId = JSON.parse(await readFile(worldIdPath, "utf-8"));

// Encode the World ID proof into the opaque bytes the WorldIDPersonhoodAdapter
// decodes: abi.encode(uint256 root, uint256[8] proof). The nullifier is passed
// alongside because SpectreRegistry tracks it outside the adapter call.
const wIdProof = (worldId.proof as string[]).map((p) => BigInt(p)) as unknown as readonly [
  bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint
];
const personhoodProof = encodeAbiParameters(
  [{ type: "uint256" }, { type: "uint256[8]" }],
  [BigInt(worldId.root), wIdProof]
);

const hash = await walletClient.writeContract({
  address: config.registryAddress,
  abi: REGISTRY_ABI,
  functionName: "initiateRecovery",
  args: [
    config.agentOwnerAddress,
    newOwner as `0x${string}`,
    proofBytes,
    publicInputs,
    BigInt(worldId.nullifier_hash),
    personhoodProof,
  ],
});

console.log("recovery initiated. tx:", hash);
await publicClient.waitForTransactionReceipt({ hash });
console.log("pending recovery written on-chain. timelock started.");
