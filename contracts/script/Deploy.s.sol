// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Script.sol";
import "../src/Verifier.sol";
import "../src/SpectreRegistry.sol";

/// @notice Deploys UltraVerifier then SpectreRegistry.
///
/// Required env vars:
///   DEPLOYER_PRIVATE_KEY  — deployer private key (0x-prefixed)
///   WORLD_ID_ROUTER       — World ID router address on the target network
///   WORLD_ID_GROUP_ID     — World ID group ID (1 for Orb-verified on testnet)
///
/// Base Sepolia World ID router: 0x42FF98C4E85212a5D31358ACbFe76a621b784Fac
///
/// Usage (dry-run):
///   forge script script/Deploy.s.sol --rpc-url base_sepolia
///
/// Usage (broadcast):
///   forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address worldIdRouter = vm.envAddress("WORLD_ID_ROUTER");
        uint256 worldIdGroupId = vm.envUint("WORLD_ID_GROUP_ID");

        vm.startBroadcast(deployerKey);

        // 1. Deploy the auto-generated UltraHonk verifier
        HonkVerifier verifier = new HonkVerifier();
        console.log("Verifier deployed at:        ", address(verifier));

        // 2. Deploy SpectreRegistry
        SpectreRegistry registry = new SpectreRegistry(
            address(verifier),
            worldIdRouter,
            worldIdGroupId
        );
        console.log("SpectreRegistry deployed at: ", address(registry));
        console.log("externalNullifier:           ", registry.externalNullifier());

        vm.stopBroadcast();
    }
}
