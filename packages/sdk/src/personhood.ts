import {
  keccak256,
  encodeAbiParameters,
  type Address,
  type Hex,
} from "viem";

/**
 * Helpers for building the personhood side of an Email + Personhood recovery
 * initiation against a Spectre registry that uses ZKPassportAdapter.
 *
 * These are integrator-facing: any product that embeds Spectre recovery calls
 * these to package the browser-side ZK Passport SDK output into the exact
 * bytes SpectreRegistry.initiateRecovery expects.
 *
 * The encodings here MUST match ZKPassportAdapter.sol byte-for-byte. If either
 * side changes, both change together in the same PR.
 */

/**
 * Reconstructs the `signal` value SpectreRegistry passes to the personhood
 * adapter for a given recovery attempt. Useful for UI display and for
 * cross-checking a proof off-chain before submitting.
 *
 * Contract equivalent: `uint256(keccak256(abi.encode(agentOwner, newOwner, nonce)))`
 */
export function computeSignal(
  agentOwner: Address,
  newOwner: Address,
  nonce: bigint,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
      ],
      [agentOwner, newOwner, nonce],
    ),
  );
}

/**
 * Builds the `customData` string an integrator passes to ZK Passport's
 * SDK via `.bind("custom_data", ...)`. The adapter re-decodes this on-chain
 * to reconstruct the signal and confirm the proof is bound to THIS recovery.
 *
 * Format: `"0x" || hex(abi.encode(address newOwner, uint256 nonce))`.
 * Length: always 130 characters (2 prefix + 128 hex).
 *
 * Contract equivalent: `ZKPassportAdapter._hexStringToBytes` -> `abi.decode(..., (address, uint256))`.
 */
export function encodeBindCustomData(newOwner: Address, nonce: bigint): string {
  return encodeAbiParameters(
    [
      { type: "address" },
      { type: "uint256" },
    ],
    [newOwner, nonce],
  );
}

/**
 * Shape mirrors ZK Passport's `ProofVerificationParams` struct from
 * `zkpassport/zkpassport-packages/packages/registry-contracts/src/lib/Types.sol`.
 * The SDK returns this shape (or a JSON-serialized version of it) after a
 * successful `zkPassport.request({ mode: "compressed-evm" })` call.
 */
export interface ZKPassportProofVerificationParams {
  version: Hex;
  proofVerificationData: {
    vkeyHash: Hex;
    proof: Hex;
    publicInputs: Hex[];
  };
  committedInputs: Hex;
  serviceConfig: {
    validityPeriodInSeconds: bigint;
    domain: string;
    scope: string;
    devMode: boolean;
  };
}

/**
 * Packages a ZK Passport proof into the `personhoodProof` bytes blob
 * SpectreRegistry passes to the adapter. This is straight ABI encoding of
 * the struct, matching the `abi.decode(proofData, (ProofVerificationParams))`
 * call at the top of `ZKPassportAdapter.verifyPersonhood`.
 */
export function encodeProofData(
  params: ZKPassportProofVerificationParams,
): Hex {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "version", type: "bytes32" },
          {
            name: "proofVerificationData",
            type: "tuple",
            components: [
              { name: "vkeyHash", type: "bytes32" },
              { name: "proof", type: "bytes" },
              { name: "publicInputs", type: "bytes32[]" },
            ],
          },
          { name: "committedInputs", type: "bytes" },
          {
            name: "serviceConfig",
            type: "tuple",
            components: [
              { name: "validityPeriodInSeconds", type: "uint256" },
              { name: "domain", type: "string" },
              { name: "scope", type: "string" },
              { name: "devMode", type: "bool" },
            ],
          },
        ],
      },
    ],
    [params],
  );
}

/**
 * Converts ZK Passport's `uniqueIdentifier` (bytes32) into the `uint256`
 * SpectreRegistry expects for `personhoodNullifier`. Registry stores it in
 * `usedNullifiers` for replay protection.
 */
export function toPersonhoodNullifier(uniqueIdentifier: Hex): bigint {
  return BigInt(uniqueIdentifier);
}

/**
 * Convenience: the exact ZK Passport SDK `bind()` calls an integrator makes
 * for a Spectre recovery. Returned as a data object so callers can spread it
 * into their own `queryBuilder` chain. Kept close to `encodeBindCustomData` so
 * both stay in sync when the adapter's expectations change.
 */
export function bindFieldsForRecovery(
  agentOwner: Address,
  newOwner: Address,
  nonce: bigint,
  chainSlug: string,
): { user_address: Address; chain: string; custom_data: string } {
  return {
    user_address: agentOwner,
    chain: chainSlug,
    custom_data: encodeBindCustomData(newOwner, nonce),
  };
}

/**
 * Renders a copy-pasteable JavaScript snippet showing the exact ZK Passport
 * SDK invocation for a given recovery. Useful for the demo page's "run this
 * elsewhere" flow while ZK Passport's on-chain verifier is not yet live on
 * a given chain. Also useful in docs.
 */
export function renderZKPassportSnippet(
  agentOwner: Address,
  newOwner: Address,
  nonce: bigint,
  chainSlug: string,
  scope: string,
): string {
  const bd = bindFieldsForRecovery(agentOwner, newOwner, nonce, chainSlug);
  return [
    `import { ZKPassport } from "@zkpassport/sdk";`,
    ``,
    `const zkp = new ZKPassport();`,
    `const { url, onResult } = zkp`,
    `  .request({ scope: ${JSON.stringify(scope)}, mode: "compressed-evm", evmChain: ${JSON.stringify(chainSlug)} })`,
    `  .bind("user_address", ${JSON.stringify(bd.user_address)})`,
    `  .bind("chain", ${JSON.stringify(bd.chain)})`,
    `  .bind("custom_data", ${JSON.stringify(bd.custom_data)})`,
    `  .done();`,
    ``,
    `// Render \`url\` as a QR code; scan with the ZK Passport mobile app.`,
    `onResult(({ proofs, uniqueIdentifier }) => {`,
    `  console.log("proofs:", proofs);`,
    `  console.log("uniqueIdentifier:", uniqueIdentifier);`,
    `});`,
  ].join("\n");
}

