// Smoke test: sanity-check the ZKPassport personhood helpers against
// known-good inputs. Verifies encoding shape and roundtrip decode.
import { decodeAbiParameters } from "viem";
import {
  computeSignal,
  encodeBindCustomData,
  encodeProofData,
  toPersonhoodNullifier,
  bindFieldsForRecovery,
  renderZKPassportSnippet,
} from "../dist/personhood.js";

const agentOwner = "0xa626a611cde2e9895B1604862691EB446c8Bd49B";
const newOwner = "0x6992C2eC202426E6407d9ec27D7b84E6Ae0cC0c4";
const nonce = 42n;
const chainSlug = "base-sepolia";
const scope = "spectre-recovery-v1";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

// computeSignal
const signal = computeSignal(agentOwner, newOwner, nonce);
assert(signal.startsWith("0x"), "signal should be 0x-prefixed");
assert(signal.length === 66, `signal should be 66 chars (bytes32 hex), got ${signal.length}`);
console.log("signal:            ", signal);

// encodeBindCustomData
const customData = encodeBindCustomData(newOwner, nonce);
assert(customData.startsWith("0x"), "customData should be 0x-prefixed");
assert(customData.length === 130, `customData should be 130 chars, got ${customData.length}`);
console.log("customData:        ", customData);

// Roundtrip: decoding customData should yield the original (newOwner, nonce)
const [decodedNewOwner, decodedNonce] = decodeAbiParameters(
  [{ type: "address" }, { type: "uint256" }],
  customData,
);
assert(
  decodedNewOwner.toLowerCase() === newOwner.toLowerCase(),
  `roundtrip newOwner mismatch: ${decodedNewOwner} vs ${newOwner}`,
);
assert(decodedNonce === nonce, `roundtrip nonce mismatch: ${decodedNonce} vs ${nonce}`);
console.log("customData roundtrip OK");

// bindFieldsForRecovery
const bd = bindFieldsForRecovery(agentOwner, newOwner, nonce, chainSlug);
assert(bd.user_address === agentOwner, "bind user_address should equal agentOwner");
assert(bd.chain === chainSlug, "bind chain should equal chainSlug");
assert(bd.custom_data === customData, "bind custom_data should equal encodeBindCustomData output");
console.log("bindFieldsForRecovery OK");

// encodeProofData: give it a minimal fixture
const proofParams = {
  version: "0x0000000000000000000000000000000000000000000000000000000000000001",
  proofVerificationData: {
    vkeyHash: "0x0000000000000000000000000000000000000000000000000000000000000002",
    proof: "0xabcdef",
    publicInputs: ["0x0000000000000000000000000000000000000000000000000000000000000003"],
  },
  committedInputs: "0x1234",
  serviceConfig: {
    validityPeriodInSeconds: 3600n,
    domain: "spectre-test.example",
    scope,
    devMode: false,
  },
};
const proofBytes = encodeProofData(proofParams);
assert(proofBytes.startsWith("0x"), "encodeProofData should return 0x-prefixed hex");
console.log("proofBytes len:    ", proofBytes.length);

// toPersonhoodNullifier
const uniqueId = "0xdeadbeefcafedeadbeefcafedeadbeefcafedeadbeefcafedeadbeefcafebabe";
const nullifier = toPersonhoodNullifier(uniqueId);
assert(nullifier === BigInt(uniqueId), "nullifier should equal BigInt(uniqueId)");
console.log("nullifier:         ", nullifier.toString());

// renderZKPassportSnippet: sanity check output contains the expected bind() lines
const snippet = renderZKPassportSnippet(agentOwner, newOwner, nonce, chainSlug, scope);
assert(snippet.includes(`.bind("user_address", "${agentOwner}")`), "snippet missing user_address bind");
assert(snippet.includes(`.bind("chain", "${chainSlug}")`), "snippet missing chain bind");
assert(snippet.includes(`.bind("custom_data", "${customData}")`), "snippet missing custom_data bind");
console.log("snippet render OK");

console.log("\nAll personhood helper checks passed.");
