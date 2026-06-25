// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/// @title  IPersonhoodVerifier
/// @notice Spectre's pluggable second factor. The registry binds a recovery to
///         `signal = keccak256(agentOwner, newOwner, nonce)` and tracks
///         `nullifierHash` in `usedNullifiers`; the verifier proves a real
///         person, distinct under `nullifierHash`, authorized `signal`.
/// @dev    Reverts on failure. Vendor-specific fields (ZK Passport scope/domain,
///         Self.xyz scope, ICAO trust roots, …) live inside the adapter as
///         immutables; `proofData` is opaque, decoded by the adapter.
interface IPersonhoodVerifier {
    function verifyPersonhood(
        uint256 signal,
        uint256 nullifierHash,
        bytes calldata proofData
    ) external view;
}
