// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Script.sol";
import "../src/Verifier.sol";
import "../src/SpectreRegistry.sol";
import "../src/DKIMRegistry.sol";
import "../src/WorldIDPersonhoodAdapter.sol";
import "../src/PersonhoodRegistry.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

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
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));

        // 1. Auto-generated UltraHonk verifier
        HonkVerifier verifier = new HonkVerifier();
        console.log("Verifier deployed at:        ", address(verifier));

        // 2. DKIM key registry
        DKIMRegistry dkimRegistry = new DKIMRegistry(
            vm.envAddress("DKIM_UPDATER"),
            vm.envUint("DKIM_PROPOSAL_TIMELOCK")
        );
        console.log("DKIMRegistry deployed at:    ", address(dkimRegistry));

        // 3. Personhood adapter (World ID v0) — the deploy-time default
        WorldIDPersonhoodAdapter personhood = new WorldIDPersonhoodAdapter(
            vm.envAddress("WORLD_ID_ROUTER"),
            vm.envUint("WORLD_ID_GROUP_ID"),
            vm.envUint("WORLD_ID_EXTERNAL_NULLIFIER")
        );
        console.log("PersonhoodAdapter deployed:  ", address(personhood));

        // 4. Personhood-adapter allowlist (governs additional adapters; the
        //    default adapter above is a deploy-time trust anchor)
        PersonhoodRegistry personhoodRegistry = new PersonhoodRegistry(
            vm.envAddress("DKIM_UPDATER"),
            vm.envUint("DKIM_PROPOSAL_TIMELOCK")
        );
        console.log("PersonhoodRegistry deployed: ", address(personhoodRegistry));

        // 5. SpectreRegistry implementation + Transparent proxy
        address registry = _deployRegistryProxy(
            address(verifier),
            address(personhood),
            address(personhoodRegistry),
            address(dkimRegistry)
        );
        console.log("SpectreRegistry (proxy) at:  ", registry);

        vm.stopBroadcast();
    }

    /// @dev Isolated in its own frame to keep `run()` under the stack limit.
    ///      Governance roles default to the deployer (testnet); set
    ///      SPECTRE_OWNER / PAUSE_GUARDIAN / PROXY_ADMIN_OWNER to a
    ///      multisig/timelock for mainnet — no code change, just env vars.
    function _deployRegistryProxy(
        address verifier,
        address personhood,
        address personhoodRegistry,
        address dkim
    ) internal returns (address) {
        address deployer = vm.addr(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        SpectreRegistry impl = new SpectreRegistry();
        console.log("SpectreRegistry impl at:     ", address(impl));
        bytes memory initData = abi.encodeCall(
            SpectreRegistry.initialize,
            (
                vm.envOr("SPECTRE_OWNER", deployer),
                vm.envOr("PAUSE_GUARDIAN", deployer),
                verifier,
                personhood,
                personhoodRegistry,
                dkim,
                uint64(vm.envUint("DEFAULT_TIMELOCK_BLOCKS"))
            )
        );
        return address(
            new TransparentUpgradeableProxy(
                address(impl),
                vm.envOr("PROXY_ADMIN_OWNER", deployer),
                initData
            )
        );
    }
}
