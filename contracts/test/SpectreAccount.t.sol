// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "forge-std/Test.sol";
import "../src/SpectreRegistry.sol";
import "../src/SpectreAccount.sol";
import "../src/WorldIDPersonhoodAdapter.sol";
import "../src/PersonhoodRegistry.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract MockVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }
}

contract MockWorldID {
    function verifyProof(
        uint256, uint256, uint256, uint256, uint256, uint256[8] calldata
    ) external pure {}
}

contract MockDKIMRegistry {
    function isKnown(bytes32) external pure returns (bool) {
        return true;
    }
}

/// @dev Target that returns data, used to assert execute() forwards return data.
contract Echo {
    function ping(uint256 x) external pure returns (uint256) {
        return x + 1;
    }
}

/// @dev Target that always reverts with a known reason.
contract Boom {
    error Banged();
    function go() external pure {
        revert Banged();
    }
}

contract SpectreAccountTest is Test {
    SpectreRegistry registry;
    SpectreAccount account;

    address agentId = address(0xA11CE); // registrant + initial controller
    address newOwner = address(0xB0B);
    address backup = address(0xBACC);
    address stranger = address(0x5747);
    address payable sink = payable(address(0xD00D));

    bytes32 emailHash = keccak256("owner@example.com");
    uint64 constant TIMELOCK = 10;

    function setUp() public {
        WorldIDPersonhoodAdapter personhood =
            new WorldIDPersonhoodAdapter(address(new MockWorldID()), 1, 1);
        PersonhoodRegistry personhoodReg =
            new PersonhoodRegistry(address(this), 1 days);
        SpectreRegistry impl = new SpectreRegistry();
        bytes memory initData = abi.encodeCall(
            SpectreRegistry.initialize,
            (
                address(this),
                address(this),
                address(new MockVerifier()),
                address(personhood),
                address(personhoodReg),
                address(new MockDKIMRegistry()),
                TIMELOCK
            )
        );
        registry = SpectreRegistry(address(new ERC1967Proxy(address(impl), initData)));

        vm.prank(agentId);
        registry.register(emailHash);

        account = new SpectreAccount(registry, agentId);
        vm.deal(address(account), 10 ether);
    }

    // ── construction ──────────────────────────────────────────────────────

    function test_constructor_rejects_zero_args() public {
        vm.expectRevert(SpectreAccount.ZeroArgument.selector);
        new SpectreAccount(SpectreRegistry(address(0)), agentId);

        vm.expectRevert(SpectreAccount.ZeroArgument.selector);
        new SpectreAccount(registry, address(0));
    }

    function test_controller_is_initial_owner() public view {
        assertEq(account.controller(), agentId);
        assertEq(account.isRecoveryPending(), false);
        assertEq(account.agentId(), agentId);
        assertEq(address(account.registry()), address(registry));
    }

    // ── controller gating ─────────────────────────────────────────────────

    function test_current_owner_can_execute() public {
        vm.prank(agentId);
        account.execute(sink, 1 ether, "");
        assertEq(sink.balance, 1 ether);
        assertEq(address(account).balance, 9 ether);
    }

    function test_execute_forwards_return_data() public {
        Echo echo = new Echo();
        vm.prank(agentId);
        bytes memory ret = account.execute(
            address(echo),
            0,
            abi.encodeCall(Echo.ping, (41))
        );
        assertEq(abi.decode(ret, (uint256)), 42);
    }

    function test_non_controller_cannot_execute() public {
        vm.prank(stranger);
        vm.expectRevert(SpectreAccount.NotController.selector);
        account.execute(sink, 1 ether, "");

        // newOwner is not the controller *yet* (no recovery executed)
        vm.prank(newOwner);
        vm.expectRevert(SpectreAccount.NotController.selector);
        account.execute(sink, 1 ether, "");
    }

    function test_unregistered_agent_reverts() public {
        SpectreAccount orphan = new SpectreAccount(registry, address(0xDEAD));
        vm.deal(address(orphan), 1 ether);
        vm.prank(address(0xDEAD));
        vm.expectRevert(SpectreAccount.AgentNotRegistered.selector);
        orphan.execute(sink, 1, "");
    }

    function test_execute_bubbles_target_revert() public {
        Boom boom = new Boom();
        vm.prank(agentId);
        vm.expectRevert(Boom.Banged.selector);
        account.execute(address(boom), 0, abi.encodeCall(Boom.go, ()));
    }

    function test_receives_eth() public {
        (bool ok, ) = address(account).call{value: 2 ether}("");
        assertTrue(ok);
        assertEq(address(account).balance, 12 ether);
    }

    // ── the freeze: theft-during-window is blocked ────────────────────────

    function _stagePendingRecovery() internal {
        vm.prank(agentId);
        registry.setBackupWallet(backup);
        vm.prank(backup);
        registry.initiateBackupRecovery(agentId, newOwner);
    }

    function test_frozen_while_recovery_pending() public {
        _stagePendingRecovery();
        assertTrue(account.isRecoveryPending());

        // Even the CURRENT owner (possibly the compromised key) cannot move
        // funds during the timelock window. This is the core property.
        vm.prank(agentId);
        vm.expectRevert(SpectreAccount.AccountFrozen.selector);
        account.execute(sink, 1 ether, "");
        assertEq(address(account).balance, 10 ether);
    }

    function test_owner_rotation_follows_recovery() public {
        _stagePendingRecovery();
        vm.roll(block.number + TIMELOCK);
        registry.executeRecovery(agentId); // callable by anyone

        assertEq(account.controller(), newOwner);
        assertFalse(account.isRecoveryPending());

        // New owner controls a still-funded account.
        vm.prank(newOwner);
        account.execute(sink, 3 ether, "");
        assertEq(sink.balance, 3 ether);

        // Old owner is now powerless.
        vm.prank(agentId);
        vm.expectRevert(SpectreAccount.NotController.selector);
        account.execute(sink, 1 ether, "");
    }

    function test_cancel_lifts_freeze() public {
        _stagePendingRecovery();
        assertTrue(account.isRecoveryPending());

        // Current owner cancels at the registry (false-alarm path).
        vm.prank(agentId);
        registry.cancelRecovery(agentId);

        assertFalse(account.isRecoveryPending());
        vm.prank(agentId);
        account.execute(sink, 1 ether, "");
        assertEq(sink.balance, 1 ether);
    }
}
