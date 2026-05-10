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

    // ── transferUpdater ──────────────────────────────────────────────────────

    function test_transfer_updater_succeeds() public {
        vm.prank(updater);
        vm.expectEmit(true, true, false, false);
        emit UpdaterTransferred(updater, newUpdate);
        registry.transferUpdater(newUpdate);
        assertEq(registry.updater(), newUpdate);

        // old updater is now powerless
        vm.prank(updater);
        vm.expectRevert(DKIMRegistry.NotUpdater.selector);
        registry.propose(keyHash);

        // new updater can act
        vm.prank(newUpdate);
        registry.propose(keyHash);
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
}
