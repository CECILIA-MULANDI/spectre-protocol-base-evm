/**
 * Initiate recovery on SpectreRegistry.
 *
 * Flow:
 *   1. Parse email, fetch DKIM key, build witness
 *   2. Generate UltraHonk proof via nargo + bb
 *   3. Verify proof off-chain
 *   4. Call SpectreRegistry.initiateRecovery() with email proof + personhood proof
 *
 * Personhood: the testnet deploy uses MockPersonhoodAdapter which ignores its
 * proofData. We still need a fresh, non-reused personhoodNullifier per attempt
 * (SpectreRegistry tracks usedNullifiers regardless of which adapter validated
 * the proof). We derive one from (agent, newOwner, nonce, block.timestamp) so
 * repeated demos don't trip NullifierAlreadyUsed. A production adapter (e.g.
 * ZK Passport) would supply both proofData and a real identity-derived
 * nullifier from its SDK output.
 */
import { readFile } from "fs/promises";
import { encodePacked, keccak256 } from "viem";
import { loadConfig } from "./config.js";
import { buildClients } from "./network.js";
import { REGISTRY_ABI } from "./abi.js";
import { parseEmail } from "../email/parser.js";
import { fetchDKIMPublicKey } from "../email/dkim.js";
import { buildWitness } from "../prover/witness.js";
import { generateProof, verifyProof } from "../prover/prover.js";

const [emlPath, newOwner] = process.argv.slice(2);
if (!emlPath || !newOwner) {
  console.error("error: email path and new-owner address are required");
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

// MockPersonhoodAdapter accepts any input — pass empty bytes.
const personhoodProof = "0x" as `0x${string}`;

// Fresh per-attempt nullifier (see top-of-file comment). The agent + new owner
// + nonce alone would collide if a cancel happens before the timestamp ticks,
// so block.timestamp via Date.now() keeps each attempt distinct.
const personhoodNullifier = BigInt(
  keccak256(
    encodePacked(
      ["address", "address", "uint256", "uint256"],
      [
        config.agentOwnerAddress,
        newOwner as `0x${string}`,
        nonce,
        BigInt(Math.floor(Date.now() / 1000)),
      ]
    )
  )
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
    personhoodNullifier,
    personhoodProof,
  ],
});

console.log("recovery initiated. tx:", hash);
await publicClient.waitForTransactionReceipt({ hash });
console.log("pending recovery written on-chain. timelock started.");
