// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Script.sol";
import "../src/Verifier.sol";
import "../src/SpectreRegistry.sol";
import "../src/MockWorldID.sol";

/// @notice Deploys HonkVerifier + MockWorldID + SpectreRegistry for local / testnet E2E testing.
///
/// Required env vars:
///   DEPLOYER_PRIVATE_KEY  — deployer private key (0x-prefixed)
contract DeployMock is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        HonkVerifier verifier = new HonkVerifier();
        console.log("Verifier deployed at:        ", address(verifier));

        MockWorldID mockWorldId = new MockWorldID();
        console.log("MockWorldID deployed at:     ", address(mockWorldId));

        // groupId = 1, externalNullifier = 1 (arbitrary — MockWorldID ignores proofs)
        SpectreRegistry registry = new SpectreRegistry(
            address(verifier),
            address(mockWorldId),
            1,
            1
        );
        console.log("SpectreRegistry deployed at: ", address(registry));

        vm.stopBroadcast();
    }
}
