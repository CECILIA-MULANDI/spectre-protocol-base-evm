// SPDX-License-Identifier: Apache-2.0
// Vendored from zkpassport/zkpassport-packages@943f15cae2404955019ef764ebcad709014d9c9d,
// path packages/registry-contracts/src/lib/Types.sol.
//
// Only the four structs the ZKPassportAdapter integrates against are copied here;
// the enums and other structs in the upstream Types.sol are not needed by Spectre.
//
// Pragma downshifted from ^0.8.30 to ^0.8.21 to match Spectre's project solc (foundry.toml
// pins 0.8.27); no other changes. Do not edit; regenerate on ZK Passport version bump.
pragma solidity ^0.8.21;

struct ProofVerificationParams {
    bytes32 version;
    ProofVerificationData proofVerificationData;
    bytes committedInputs;
    ServiceConfig serviceConfig;
}

struct ProofVerificationData {
    bytes32 vkeyHash;
    bytes proof;
    bytes32[] publicInputs;
}

struct ServiceConfig {
    uint256 validityPeriodInSeconds;
    string domain;
    string scope;
    bool devMode;
}

struct BoundData {
    address senderAddress;
    uint256 chainId;
    string customData;
}
