// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Script.sol";
import "../src/Verifier.sol";
import "../src/SpectreRegistry.sol";
import "../src/DKIMRegistry.sol";
import "../src/MockPersonhoodAdapter.sol";
import "../src/PersonhoodRegistry.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

/// @notice Same as Deploy.s.sol but swaps in MockPersonhoodAdapter for the
///         default personhood verifier. For testnet E2E only.
contract DeployMockE2E is Script {
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
        console.log("PersonhoodRegistry:          ", address(personhoodRegistry));

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
        return address(
            new TransparentUpgradeableProxy(
                address(impl),
                vm.envOr("PROXY_ADMIN_OWNER", deployer),
                initData
            )
        );
    }
}
