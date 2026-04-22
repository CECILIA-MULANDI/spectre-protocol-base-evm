// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "./IWorldID.sol";

/// @notice Test stub — accepts every World ID proof without verification.
///         Deploy only on testnets. Never use in production.
contract MockWorldID is IWorldID {
    function verifyProof(
        uint256,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256[8] calldata
    ) external pure override {}
}
