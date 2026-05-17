// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "forge-std/Test.sol";
import "../src/DKIMRegistry.sol";

contract DKIMRegistryTest is Test {
    DKIMRegistry registry;

    address updater   = address(0xA);
    address other     = address(0xB);
    address newUpdate = address(0xC);

    bytes32 keyHash = keccak256("dkim-key-1");
    uint256 constant TIMELOCK = 24 hours;

    event KeyProposed(bytes32 indexed keyHash, uint256 confirmAfter);
    event KeyConfirmed(bytes32 indexed keyHash);
    event KeyRevoked(bytes32 indexed keyHash);
    event UpdaterTransferStarted(address indexed current, address indexed pending);
    event UpdaterTransferCancelled(address indexed current, address indexed pending);
    event UpdaterTransferred(address indexed previous, address indexed next);

    function setUp() public {
        registry = new DKIMRegistry(updater, TIMELOCK);
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    function test_constructor_revert_zero_updater() public {
        vm.expectRevert(DKIMRegistry.ZeroAddress.selector);
        new DKIMRegistry(address(0), TIMELOCK);
    }

    function test_constructor_state() public view {
        assertEq(registry.updater(), updater);
        assertEq(registry.proposalTimelock(), TIMELOCK);
    }

    // ── propose ──────────────────────────────────────────────────────────────

    function test_propose_sets_confirm_after() public {
        vm.prank(updater);
        vm.expectEmit(true, false, false, true);
        emit KeyProposed(keyHash, block.timestamp + TIMELOCK);
        registry.propose(keyHash);

        assertEq(registry.confirmAfter(keyHash), block.timestamp + TIMELOCK);
        assertFalse(registry.isKnown(keyHash));
    }

    function test_propose_revert_not_updater() public {
        vm.prank(other);
        vm.expectRevert(DKIMRegistry.NotUpdater.selector);
        registry.propose(keyHash);
    }

    function test_propose_revert_already_proposed() public {
        vm.startPrank(updater);
        registry.propose(keyHash);
        vm.expectRevert(DKIMRegistry.AlreadyProposed.selector);
        registry.propose(keyHash);
        vm.stopPrank();
    }

    function test_propose_revert_already_known() public {
        vm.startPrank(updater);
        registry.propose(keyHash);
        vm.warp(block.timestamp + TIMELOCK);
        registry.confirm(keyHash);
        vm.expectRevert(DKIMRegistry.AlreadyKnown.selector);
        registry.propose(keyHash);
        vm.stopPrank();
    }

    // ── confirm ──────────────────────────────────────────────────────────────

    function test_confirm_after_timelock_succeeds() public {
        vm.prank(updater);
        registry.propose(keyHash);

        vm.warp(block.timestamp + TIMELOCK);

        // Anyone can confirm — explicit non-updater caller proves it.
        vm.prank(other);
        vm.expectEmit(true, false, false, false);
        emit KeyConfirmed(keyHash);
        registry.confirm(keyHash);

        assertTrue(registry.isKnown(keyHash));
        assertEq(registry.confirmAfter(keyHash), 0);
    }

    function test_confirm_revert_no_proposal() public {
        vm.expectRevert(DKIMRegistry.NoProposal.selector);
        registry.confirm(keyHash);
    }

    function test_confirm_revert_timelock_not_elapsed() public {
        vm.prank(updater);
        registry.propose(keyHash);

        vm.warp(block.timestamp + TIMELOCK - 1);
        vm.expectRevert(DKIMRegistry.TimelockNotElapsed.selector);
        registry.confirm(keyHash);
    }

    // ── revoke ───────────────────────────────────────────────────────────────

    function test_revoke_known_key() public {
        vm.startPrank(updater);
        registry.propose(keyHash);
        vm.warp(block.timestamp + TIMELOCK);
        registry.confirm(keyHash);
        assertTrue(registry.isKnown(keyHash));

        vm.expectEmit(true, false, false, false);
        emit KeyRevoked(keyHash);
        registry.revoke(keyHash);
        assertFalse(registry.isKnown(keyHash));
        vm.stopPrank();
    }

    function test_revoke_pending_proposal() public {
        vm.startPrank(updater);
        registry.propose(keyHash);
        registry.revoke(keyHash);
        assertEq(registry.confirmAfter(keyHash), 0);
        vm.stopPrank();
    }

    function test_revoke_revert_not_updater() public {
        vm.prank(updater);
        registry.propose(keyHash);

        vm.prank(other);
        vm.expectRevert(DKIMRegistry.NotUpdater.selector);
        registry.revoke(keyHash);
    }

    function test_revoke_revert_nothing_to_revoke() public {
        vm.prank(updater);
        vm.expectRevert(DKIMRegistry.NothingToRevoke.selector);
        registry.revoke(keyHash);
    }

    function test_revoked_key_can_be_reproposed() public {
        vm.startPrank(updater);
        registry.propose(keyHash);
        vm.warp(block.timestamp + TIMELOCK);
        registry.confirm(keyHash);
        registry.revoke(keyHash);
        registry.propose(keyHash);  // ok again — back in pending state
        vm.stopPrank();
        assertEq(registry.confirmAfter(keyHash), block.timestamp + TIMELOCK);
    }

    // ── S7: constructor timelock guard ───────────────────────────────────────

    function test_constructor_revert_zero_timelock() public {
        vm.expectRevert(DKIMRegistry.InvalidTimelock.selector);
        new DKIMRegistry(updater, 0);
    }

    // ── S6: two-step transferUpdater ─────────────────────────────────────────

    function test_transfer_updater_two_step() public {
        // Step 1: propose. Role does NOT change yet.
        vm.prank(updater);
        vm.expectEmit(true, true, false, false);
        emit UpdaterTransferStarted(updater, newUpdate);
        registry.transferUpdater(newUpdate);

        assertEq(registry.updater(), updater);
        assertEq(registry.pendingUpdater(), newUpdate);

        // Until acceptance the old updater still has full power...
        vm.prank(updater);
        registry.propose(keyHash);
        // ...and the pending updater does not.
        vm.prank(newUpdate);
        vm.expectRevert(DKIMRegistry.NotUpdater.selector);
        registry.propose(keccak256("k2"));

        // Step 2: pending updater accepts.
        vm.prank(newUpdate);
        vm.expectEmit(true, true, false, false);
        emit UpdaterTransferred(updater, newUpdate);
        registry.acceptUpdater();

        assertEq(registry.updater(), newUpdate);
        assertEq(registry.pendingUpdater(), address(0));

        // Old updater is now powerless; new one can act.
        vm.prank(updater);
        vm.expectRevert(DKIMRegistry.NotUpdater.selector);
        registry.propose(keccak256("k3"));
        vm.prank(newUpdate);
        registry.propose(keccak256("k3"));
    }

    function test_transfer_updater_revert_zero() public {
        vm.prank(updater);
        vm.expectRevert(DKIMRegistry.ZeroAddress.selector);
        registry.transferUpdater(address(0));
    }

    function test_transfer_updater_revert_not_updater() public {
        vm.prank(other);
        vm.expectRevert(DKIMRegistry.NotUpdater.selector);
        registry.transferUpdater(newUpdate);
    }

    function test_accept_updater_revert_not_pending() public {
        vm.prank(updater);
        registry.transferUpdater(newUpdate);

        // A wrong-typed / uncontrolled address can never complete the
        // transfer, so it cannot brick the role (the S6 point).
        vm.prank(other);
        vm.expectRevert(DKIMRegistry.NotPendingUpdater.selector);
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

        // The previously-pending address can no longer accept.
        vm.prank(newUpdate);
        vm.expectRevert(DKIMRegistry.NotPendingUpdater.selector);
        registry.acceptUpdater();
    }

    function test_cancel_updater_transfer_revert_no_pending() public {
        vm.prank(updater);
        vm.expectRevert(DKIMRegistry.NoPendingTransfer.selector);
        registry.cancelUpdaterTransfer();
    }

    function test_cancel_updater_transfer_revert_not_updater() public {
        vm.prank(updater);
        registry.transferUpdater(newUpdate);

        vm.prank(other);
        vm.expectRevert(DKIMRegistry.NotUpdater.selector);
        registry.cancelUpdaterTransfer();
    }

    function test_transfer_updater_overwrites_pending() public {
        vm.startPrank(updater);
        registry.transferUpdater(newUpdate);
        registry.transferUpdater(other); // overwrite in-flight proposal
        vm.stopPrank();

        assertEq(registry.pendingUpdater(), other);

        vm.prank(newUpdate);
        vm.expectRevert(DKIMRegistry.NotPendingUpdater.selector);
        registry.acceptUpdater();

        vm.prank(other);
        registry.acceptUpdater();
        assertEq(registry.updater(), other);
    }
}
