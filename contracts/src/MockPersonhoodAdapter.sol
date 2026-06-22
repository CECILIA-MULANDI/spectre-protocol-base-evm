// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {IPersonhoodVerifier} from "./IPersonhoodVerifier.sol";

/// @title  MockPersonhoodAdapter
/// @notice Test-only adapter that accepts any proof. NEVER deploy to mainnet.
/// @dev    Used to validate the rest of the recovery flow without depending on
///         an external personhood network's testnet state.
contract MockPersonhoodAdapter is IPersonhoodVerifier {
    function verifyPersonhood(uint256, uint256, bytes calldata) external pure override {
        // accept any input
    }
}
