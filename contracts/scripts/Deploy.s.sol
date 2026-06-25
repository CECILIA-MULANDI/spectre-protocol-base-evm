// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Script.sol";
import "../src/Verifier.sol";
import "../src/SpectreRegistry.sol";
import "../src/DKIMRegistry.sol";
import "../src/MockPersonhoodAdapter.sol";
import "../src/PersonhoodRegistry.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

/// @notice Deploys Verifier + DKIMRegistry + Personhood adapter +
///         PersonhoodRegistry + SpectreRegistry (Transparent proxy).
///
/// The personhood adapter is MockPersonhoodAdapter — Spectre's personhood
/// scheme is pluggable via PersonhoodRegistry, and the testnet path uses
/// the mock so dev iteration doesn't require an external identity provider.
/// For mainnet, deploy a production adapter (e.g. ZK Passport) and either
/// pass it as the default at init time or propose+confirm it through
/// PersonhoodRegistry as an additional approved adapter.
///
/// Required env vars:
///   DEPLOYER_PRIVATE_KEY   — deployer private key (0x-prefixed)
///   DKIM_UPDATER           — address allowed to propose/revoke DKIM keys
///                            and personhood adapters
///   DKIM_PROPOSAL_TIMELOCK — seconds between propose() and confirm()
///   DEFAULT_TIMELOCK_BLOCKS — registry default + minimum cancel window in blocks
///
/// Optional env vars (default to deployer if unset):
///   SPECTRE_OWNER, PAUSE_GUARDIAN, PROXY_ADMIN_OWNER
contract Deploy is Script {
    function run() external {
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));

        HonkVerifier verifier = new HonkVerifier();
        console.log("Verifier:                    ", address(verifier));

        DKIMRegistry dkimRegistry = new DKIMRegistry(
            vm.envAddress("DKIM_UPDATER"),
            vm.envUint("DKIM_PROPOSAL_TIMELOCK")
        );
        console.log("DKIMRegistry:                ", address(dkimRegistry));

        MockPersonhoodAdapter personhood = new MockPersonhoodAdapter();
        console.log("MockPersonhoodAdapter:       ", address(personhood));

        PersonhoodRegistry personhoodRegistry = new PersonhoodRegistry(
            vm.envAddress("DKIM_UPDATER"),
            vm.envUint("DKIM_PROPOSAL_TIMELOCK")
        );
        console.log(
            "PersonhoodRegistry:          ",
            address(personhoodRegistry)
        );

        address registry = _deployRegistryProxy(
            address(verifier),
            address(personhood),
            address(personhoodRegistry),
            address(dkimRegistry)
        );
        console.log("SpectreRegistry (proxy):     ", registry);

        vm.stopBroadcast();
    }

    function _deployRegistryProxy(
        address verifier,
        address personhood,
        address personhoodRegistry,
        address dkim
    ) internal returns (address) {
        address deployer = vm.addr(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        SpectreRegistry impl = new SpectreRegistry();
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
        return
            address(
                new TransparentUpgradeableProxy(
                    address(impl),
                    vm.envOr("PROXY_ADMIN_OWNER", deployer),
                    initData
                )
            );
    }
}
