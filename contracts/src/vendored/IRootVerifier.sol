// SPDX-License-Identifier: Apache-2.0
// Hand-written minimal interfaces for ZK Passport's RootVerifier and VerifierHelper.
// Derived from zkpassport/zkpassport-packages@943f15cae2404955019ef764ebcad709014d9c9d,
// paths packages/registry-contracts/src/{RootVerifier.sol,VerifierHelper.sol}.
//
// ZK Passport ships RootVerifier and VerifierHelper as concrete contracts with no
// published interface files. Spectre's adapter only integrates against two functions:
// RootVerifier.verify(...) and VerifierHelper.getBoundData(...). These interfaces
// capture just those signatures.
//
// Regenerate if ZK Passport changes either signature.
pragma solidity ^0.8.21;

import {ProofVerificationParams, BoundData} from "./ZKPassportTypes.sol";

interface IVerifierHelper {
    function getBoundData(bytes calldata committedInputs) external pure returns (BoundData memory boundData);
}

interface IRootVerifier {
    function verify(ProofVerificationParams calldata params)
        external
        view
        returns (bool valid, bytes32 uniqueIdentifier, IVerifierHelper helper);
}
