// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Script.sol";
import "../src/Verifier.sol";
import "../src/SpectreRegistry.sol";
import "../src/MockWorldID.sol";
import "../src/DKIMRegistry.sol";

/// @notice Deploys HonkVerifier + MockWorldID + DKIMRegistry + SpectreRegistry
///         for local / testnet E2E testing.
///
/// The DKIMRegistry uses the deployer as the updater and a 60-second proposal
/// timelock — short enough to iterate quickly, long enough to exercise the flow.
/// You'll still need to propose+confirm gmail's DKIM key before recovery works.
///
/// Required env vars:
///   DEPLOYER_PRIVATE_KEY  — deployer private key (0x-prefixed)
contract DeployMock is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        HonkVerifier verifier = new HonkVerifier();
        console.log("Verifier deployed at:        ", address(verifier));

        MockWorldID mockWorldId = new MockWorldID();
        console.log("MockWorldID deployed at:     ", address(mockWorldId));

        DKIMRegistry dkimRegistry = new DKIMRegistry(deployer, 60);
        console.log("DKIMRegistry deployed at:    ", address(dkimRegistry));

        // groupId = 1, externalNullifier = 1 (arbitrary — MockWorldID ignores proofs)
        // 100 blocks default+minimum — local/testnet only
        SpectreRegistry registry = new SpectreRegistry(
            address(verifier),
            address(mockWorldId),
            address(dkimRegistry),
            1,
            1,
            100
        );
        console.log("SpectreRegistry deployed at: ", address(registry));

        vm.stopBroadcast();
    }
}
