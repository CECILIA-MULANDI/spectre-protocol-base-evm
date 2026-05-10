/**
 * Propose a DKIM RSA key to Spectre's DKIMRegistry.
 *
 * Usage:
 *   tsx dkim-propose.ts <domain> <selector>
 *   tsx dkim-propose.ts gmail.com 20230601
 *
 * Steps:
 *   1. Resolve `<selector>._domainkey.<domain>` via DNS
 *   2. Extract the RSA modulus
 *   3. Split into 18 × 120-bit limbs (matches circuit + contract layout)
 *   4. keccak256(packed limbs) → keyHash
 *   5. Call DKIMRegistry.propose(keyHash)
 *
 * After proposalTimelock seconds, run dkim-confirm.ts <keyHash>.
 */
import { encodeAbiParameters, keccak256, type Hash } from "viem";
import { loadConfig } from "./config.js";
import { buildClients } from "./network.js";
import { fetchDKIMPublicKey } from "../email/dkim.js";

const DKIM_REGISTRY_ABI = [
  {
    type: "function",
    name: "propose",
    inputs: [{ name: "keyHash", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "confirmAfter",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const LIMB_BITS = 120n;
const NUM_LIMBS = 18;
const LIMB_MASK = (1n << LIMB_BITS) - 1n;

function modulusToLimbs(modulus: bigint): bigint[] {
  const limbs: bigint[] = [];
  let r = modulus;
  for (let i = 0; i < NUM_LIMBS; i++) {
    limbs.push(r & LIMB_MASK);
    r >>= LIMB_BITS;
  }
  return limbs;
}

/**
 * Mirror SpectreRegistry._hashDkimKey: keccak256 over the 18 modulus limbs as
 * 18 × bytes32, packed in calldata order. We reproduce that with abi.encode of
 * a fixed-size bytes32 tuple — same memory layout, no padding.
 */
function hashKey(modulus: bigint): Hash {
  const limbs = modulusToLimbs(modulus);
  const types = Array(NUM_LIMBS).fill({ type: "bytes32" });
  const values = limbs.map(
    (l) => `0x${l.toString(16).padStart(64, "0")}` as Hash
  );
  return keccak256(encodeAbiParameters(types, values));
}

const [domain, selector] = process.argv.slice(2);
if (!domain || !selector) {
  console.error("usage: dkim-propose <domain> <selector>");
  console.error("example: dkim-propose gmail.com 20230601");
  process.exit(1);
}

const config = await loadConfig();
if (!config.dkimRegistryAddress) {
  console.error("dkimRegistryAddress missing from config.json");
  process.exit(1);
}

const { publicClient, walletClient } = buildClients(config);

console.log(`Resolving ${selector}._domainkey.${domain} ...`);
const pubkey = await fetchDKIMPublicKey(selector, domain);

const keyHash = hashKey(pubkey.modulus);
console.log("modulus (hex):", pubkey.modulus.toString(16));
console.log("keyHash:      ", keyHash);

// Check current state
const existing = (await publicClient.readContract({
  address: config.dkimRegistryAddress,
  abi: DKIM_REGISTRY_ABI,
  functionName: "confirmAfter",
  args: [keyHash],
})) as bigint;

if (existing > 0n) {
  console.log(
    `key already proposed; confirmAfter = ${existing} (unix seconds)`
  );
  process.exit(0);
}

const hash = await walletClient.writeContract({
  address: config.dkimRegistryAddress,
  abi: DKIM_REGISTRY_ABI,
  functionName: "propose",
  args: [keyHash],
});
console.log("propose tx:", hash);
await publicClient.waitForTransactionReceipt({ hash });
console.log("proposed. Run dkim-confirm.ts after the registry's timelock.");
