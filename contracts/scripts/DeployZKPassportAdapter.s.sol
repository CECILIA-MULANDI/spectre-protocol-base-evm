// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Script.sol";
import {ZKPassportAdapter} from "../src/ZKPassportAdapter.sol";
import {IRootVerifier} from "../src/vendored/IRootVerifier.sol";

/// @notice Deploys ZKPassportAdapter and prints its address. Does NOT propose it on the
///         PersonhoodRegistry; that is a separate governance step run by the updater key
///         via cast, so this script never needs the updater key.
///
/// Do not run with --broadcast until Slice 6's Base Sepolia deployment path is picked.
/// Dry-run is fine anytime for gas estimation and byte-size checks.
///
/// Required env vars:
///   DEPLOYER_PRIVATE_KEY      - deployer private key (0x-prefixed)
///   ZKPASSPORT_ROOT_VERIFIER  - address of ZK Passport's RootVerifier on the target chain
///                               (deterministic address is 0x1D000001000EFD9a6371f4d90bB8920D5431c0D8)
///   EXPECTED_DOMAIN           - domain string the adapter will enforce on every proof
///   EXPECTED_SCOPE            - scope string the adapter will enforce on every proof
contract DeployZKPassportAdapter is Script {
    function run() external {
        address rootVerifier = vm.envAddress("ZKPASSPORT_ROOT_VERIFIER");
        string memory expectedDomain = vm.envString("EXPECTED_DOMAIN");
        string memory expectedScope = vm.envString("EXPECTED_SCOPE");

        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));

        ZKPassportAdapter adapter = new ZKPassportAdapter(IRootVerifier(rootVerifier), expectedDomain, expectedScope);

        vm.stopBroadcast();

        console.log("ZKPassportAdapter:       ", address(adapter));
        console.log("RootVerifier:            ", rootVerifier);
        console.log("expectedDomainHash:      ");
        console.logBytes32(adapter.expectedDomainHash());
        console.log("expectedScopeHash:       ");
        console.logBytes32(adapter.expectedScopeHash());
    }
}
