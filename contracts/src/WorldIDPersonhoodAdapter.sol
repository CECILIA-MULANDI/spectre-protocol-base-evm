// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {IPersonhoodVerifier} from "./IPersonhoodVerifier.sol";
import {IWorldID} from "./IWorldID.sol";

/// @title  WorldIDPersonhoodAdapter
/// @notice v0 IPersonhoodVerifier — wraps a deployed World ID router and
///         holds the Worldcoin-specific immutables (groupId, externalNullifier).
/// @dev    proofData layout: abi.encode(uint256 root, uint256[8] proof).
contract WorldIDPersonhoodAdapter is IPersonhoodVerifier {
    error ZeroAddress();

    IWorldID public immutable worldId;
    uint256 public immutable groupId;
    uint256 public immutable externalNullifier;

    constructor(address _worldId, uint256 _groupId, uint256 _externalNullifier) {
        if (_worldId == address(0)) revert ZeroAddress();
        worldId = IWorldID(_worldId);
        groupId = _groupId;
        externalNullifier = _externalNullifier;
    }

    function verifyPersonhood(
        uint256 signal,
        uint256 nullifierHash,
        bytes calldata proofData
    ) external view override {
        (uint256 root, uint256[8] memory proof) =
            abi.decode(proofData, (uint256, uint256[8]));
        worldId.verifyProof(
            root,
            groupId,
            signal,
            nullifierHash,
            externalNullifier,
            proof
        );
    }
}
