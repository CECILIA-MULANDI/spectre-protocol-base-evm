// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Script.sol";
import "../src/Verifier.sol";
import "../src/SpectreRegistry.sol";
import "../src/DKIMRegistry.sol";

/// @notice Deploys UltraVerifier, DKIMRegistry, then SpectreRegistry.
///
/// Required env vars:
///   DEPLOYER_PRIVATE_KEY          — deployer private key (0x-prefixed)
///   WORLD_ID_ROUTER               — World ID router address on the target network
///   WORLD_ID_GROUP_ID             — World ID group ID (1 for Device tier)
///   WORLD_ID_EXTERNAL_NULLIFIER   — derived from app_id + action via IDKit SDK
///                                   run: cd world-id-ui && npx tsx src/nullifier.ts
///   DEFAULT_TIMELOCK_BLOCKS       — default + minimum cancel window in blocks
///                                   (e.g. 7200 ≈ 24h on Base mainnet)
///   DKIM_UPDATER                  — address allowed to propose/revoke DKIM keys.
///                                   Recommended: a multisig. EOA OK for v1 if you
///                                   plan to transferUpdater() to a multisig later.
///   DKIM_PROPOSAL_TIMELOCK        — seconds between propose() and confirm()
///                                   (e.g. 86400 = 24h on mainnet)
///
/// Base Sepolia World ID router: 0x42FF98C4E85212a5D31358ACbFe76a621b784Fac
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address worldIdRouter = vm.envAddress("WORLD_ID_ROUTER");
        uint256 worldIdGroupId = vm.envUint("WORLD_ID_GROUP_ID");
        uint256 externalNullifier = vm.envUint("WORLD_ID_EXTERNAL_NULLIFIER");
        uint64 defaultTimelock = uint64(vm.envUint("DEFAULT_TIMELOCK_BLOCKS"));
        address dkimUpdater = vm.envAddress("DKIM_UPDATER");
        uint256 dkimProposalTimelock = vm.envUint("DKIM_PROPOSAL_TIMELOCK");

        vm.startBroadcast(deployerKey);

        // 1. Deploy the auto-generated UltraHonk verifier
        HonkVerifier verifier = new HonkVerifier();
        console.log("Verifier deployed at:        ", address(verifier));

        // 2. Deploy the DKIM key registry
        DKIMRegistry dkimRegistry = new DKIMRegistry(dkimUpdater, dkimProposalTimelock);
        console.log("DKIMRegistry deployed at:    ", address(dkimRegistry));
        console.log("DKIMRegistry updater:        ", dkimRegistry.updater());
        console.log("DKIMRegistry timelock (sec): ", dkimRegistry.proposalTimelock());

        // 3. Deploy SpectreRegistry
        SpectreRegistry registry = new SpectreRegistry(
            address(verifier),
            worldIdRouter,
            address(dkimRegistry),
            worldIdGroupId,
            externalNullifier,
            defaultTimelock
        );
        console.log("SpectreRegistry deployed at: ", address(registry));
        console.log("externalNullifier:           ", registry.externalNullifier());
        console.log("defaultTimelockBlocks:       ", registry.defaultTimelockBlocks());

        vm.stopBroadcast();
    }
}
