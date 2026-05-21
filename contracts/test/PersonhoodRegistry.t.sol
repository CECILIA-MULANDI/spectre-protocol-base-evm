// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "forge-std/Test.sol";
import "../src/PersonhoodRegistry.sol";

contract PersonhoodRegistryTest is Test {
    PersonhoodRegistry registry;

    address updater   = address(0xA);
    address other     = address(0xB);
    address newUpdate = address(0xC);

    address adapter  = address(0xAD1);
    address adapter2 = address(0xAD2);
    uint256 constant TIMELOCK = 24 hours;

    event AdapterProposed(address indexed adapter, uint256 confirmAfter);
    event AdapterConfirmed(address indexed adapter);
    event AdapterRevoked(address indexed adapter);
    event UpdaterTransferStarted(address indexed current, address indexed pending);
    event UpdaterTransferCancelled(address indexed current, address indexed pending);
    event UpdaterTransferred(address indexed previous, address indexed next);

    function setUp() public {
        registry = new PersonhoodRegistry(updater, TIMELOCK);
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    function test_constructor_revert_zero_updater() public {
        vm.expectRevert(PersonhoodRegistry.ZeroAddress.selector);
        new PersonhoodRegistry(address(0), TIMELOCK);
    }

    function test_constructor_revert_zero_timelock() public {
        vm.expectRevert(PersonhoodRegistry.InvalidTimelock.selector);
        new PersonhoodRegistry(updater, 0);
    }

    function test_constructor_state() public view {
        assertEq(registry.updater(), updater);
        assertEq(registry.proposalTimelock(), TIMELOCK);
    }

    // ── propose ──────────────────────────────────────────────────────────────

    function test_propose_sets_confirm_after() public {
        vm.prank(updater);
        vm.expectEmit(true, false, false, true);
        emit AdapterProposed(adapter, block.timestamp + TIMELOCK);
        registry.propose(adapter);

        assertEq(registry.confirmAfter(adapter), block.timestamp + TIMELOCK);
        assertFalse(registry.isApproved(adapter));
    }

    function test_propose_revert_zero_adapter() public {
        vm.prank(updater);
        vm.expectRevert(PersonhoodRegistry.ZeroAddress.selector);
        registry.propose(address(0));
    }

    function test_propose_revert_not_updater() public {
        vm.prank(other);
        vm.expectRevert(PersonhoodRegistry.NotUpdater.selector);
        registry.propose(adapter);
    }

    function test_propose_revert_already_proposed() public {
        vm.startPrank(updater);
        registry.propose(adapter);
        vm.expectRevert(PersonhoodRegistry.AlreadyProposed.selector);
        registry.propose(adapter);
        vm.stopPrank();
    }

    function test_propose_revert_already_approved() public {
        vm.startPrank(updater);
        registry.propose(adapter);
        vm.warp(block.timestamp + TIMELOCK);
        registry.confirm(adapter);
        vm.expectRevert(PersonhoodRegistry.AlreadyApproved.selector);
        registry.propose(adapter);
        vm.stopPrank();
    }

    // ── confirm ──────────────────────────────────────────────────────────────

    function test_confirm_after_timelock_succeeds() public {
        vm.prank(updater);
        registry.propose(adapter);

        vm.warp(block.timestamp + TIMELOCK);

        // Anyone can confirm — explicit non-updater caller proves it.
        vm.prank(other);
        vm.expectEmit(true, false, false, false);
        emit AdapterConfirmed(adapter);
        registry.confirm(adapter);

        assertTrue(registry.isApproved(adapter));
        assertEq(registry.confirmAfter(adapter), 0);
    }

    function test_confirm_revert_no_proposal() public {
        vm.expectRevert(PersonhoodRegistry.NoProposal.selector);
        registry.confirm(adapter);
    }

    function test_confirm_revert_timelock_not_elapsed() public {
        vm.prank(updater);
        registry.propose(adapter);

        vm.warp(block.timestamp + TIMELOCK - 1);
        vm.expectRevert(PersonhoodRegistry.TimelockNotElapsed.selector);
        registry.confirm(adapter);
    }

    // ── revoke ───────────────────────────────────────────────────────────────

    function test_revoke_approved_adapter() public {
        vm.startPrank(updater);
        registry.propose(adapter);
        vm.warp(block.timestamp + TIMELOCK);
        registry.confirm(adapter);
        assertTrue(registry.isApproved(adapter));

        vm.expectEmit(true, false, false, false);
        emit AdapterRevoked(adapter);
        registry.revoke(adapter);
        assertFalse(registry.isApproved(adapter));
        vm.stopPrank();
    }

    function test_revoke_pending_proposal() public {
        vm.startPrank(updater);
        registry.propose(adapter);
        registry.revoke(adapter);
        assertEq(registry.confirmAfter(adapter), 0);
        vm.stopPrank();
    }

    function test_revoke_revert_not_updater() public {
        vm.prank(updater);
        registry.propose(adapter);

        vm.prank(other);
        vm.expectRevert(PersonhoodRegistry.NotUpdater.selector);
        registry.revoke(adapter);
    }

    function test_revoke_revert_nothing_to_revoke() public {
        vm.prank(updater);
        vm.expectRevert(PersonhoodRegistry.NothingToRevoke.selector);
        registry.revoke(adapter);
    }

    function test_revoked_adapter_can_be_reproposed() public {
        vm.startPrank(updater);
        registry.propose(adapter);
        vm.warp(block.timestamp + TIMELOCK);
        registry.confirm(adapter);
        registry.revoke(adapter);
        registry.propose(adapter); // ok again — back in pending state
        vm.stopPrank();
        assertEq(registry.confirmAfter(adapter), block.timestamp + TIMELOCK);
    }

    // ── two-step transferUpdater ─────────────────────────────────────────────

    function test_transfer_updater_two_step() public {
        vm.prank(updater);
        vm.expectEmit(true, true, false, false);
        emit UpdaterTransferStarted(updater, newUpdate);
        registry.transferUpdater(newUpdate);

        assertEq(registry.updater(), updater);
        assertEq(registry.pendingUpdater(), newUpdate);

        // Old updater still has power until acceptance...
        vm.prank(updater);
        registry.propose(adapter);
        // ...pending updater does not.
        vm.prank(newUpdate);
        vm.expectRevert(PersonhoodRegistry.NotUpdater.selector);
        registry.propose(adapter2);

        vm.prank(newUpdate);
        vm.expectEmit(true, true, false, false);
        emit UpdaterTransferred(updater, newUpdate);
        registry.acceptUpdater();

        assertEq(registry.updater(), newUpdate);
        assertEq(registry.pendingUpdater(), address(0));

        vm.prank(updater);
        vm.expectRevert(PersonhoodRegistry.NotUpdater.selector);
        registry.propose(adapter2);
        vm.prank(newUpdate);
        registry.propose(adapter2);
    }

    function test_transfer_updater_revert_zero() public {
        vm.prank(updater);
        vm.expectRevert(PersonhoodRegistry.ZeroAddress.selector);
        registry.transferUpdater(address(0));
    }

    function test_transfer_updater_revert_not_updater() public {
        vm.prank(other);
        vm.expectRevert(PersonhoodRegistry.NotUpdater.selector);
        registry.transferUpdater(newUpdate);
    }

    function test_accept_updater_revert_not_pending() public {
        vm.prank(updater);
        registry.transferUpdater(newUpdate);

        vm.prank(other);
        vm.expectRevert(PersonhoodRegistry.NotPendingUpdater.selector);
        registry.acceptUpdater();

        assertEq(registry.updater(), updater);
    }

    function test_cancel_updater_transfer() public {
        vm.prank(updater);
        registry.transferUpdater(newUpdate);

        vm.prank(updater);
        vm.expectEmit(true, true, false, false);
        emit UpdaterTransferCancelled(updater, newUpdate);
        registry.cancelUpdaterTransfer();

        assertEq(registry.pendingUpdater(), address(0));

        vm.prank(newUpdate);
        vm.expectRevert(PersonhoodRegistry.NotPendingUpdater.selector);
        registry.acceptUpdater();
    }

    function test_cancel_updater_transfer_revert_no_pending() public {
        vm.prank(updater);
        vm.expectRevert(PersonhoodRegistry.NoPendingTransfer.selector);
        registry.cancelUpdaterTransfer();
    }
}
