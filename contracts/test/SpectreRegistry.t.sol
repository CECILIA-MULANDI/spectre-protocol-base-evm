// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "forge-std/Test.sol";
import "../src/SpectreRegistry.sol";

/// @dev Stub verifier — always returns true.
contract MockVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }
}

/// @dev Stub World ID — always passes.
contract MockWorldID {
    function verifyProof(
        uint256, uint256, uint256, uint256, uint256, uint256[8] calldata
    ) external pure {}
}

contract SpectreRegistryTest is Test {
    SpectreRegistry registry;
    MockVerifier    mockVerifier;
    MockWorldID     mockWorldId;

    address owner    = address(0x1);
    address newOwner = address(0x2);
    bytes32 emailHash = keccak256("owner@example.com");

    // helpers
    bytes      proof  = hex"00";
    bytes32[]  inputs;
    uint256[8] wIdProof;

    function setUp() public {
        mockVerifier = new MockVerifier();
        mockWorldId  = new MockWorldID();
        registry     = new SpectreRegistry(address(mockVerifier), address(mockWorldId), 1, 1);
    }

    // ── Registration ─────────────────────────────────────────────────────────

    function test_register() public {
        vm.prank(owner);
        registry.register(emailHash, 7200);

        SpectreRegistry.AgentRecord memory r = registry.getRecord(owner);
        assertEq(r.owner, owner);
        assertEq(r.emailHash, emailHash);
        assertEq(r.nonce, 1);
    }

    function test_register_revert_already_registered() public {
        vm.startPrank(owner);
        registry.register(emailHash, 7200);
        vm.expectRevert(SpectreRegistry.AlreadyRegistered.selector);
        registry.register(emailHash, 7200);
        vm.stopPrank();
    }

    function test_register_revert_timelock_too_short() public {
        vm.prank(owner);
        vm.expectRevert(SpectreRegistry.TimelockTooShort.selector);
        registry.register(emailHash, 5);
    }

    // ── EmailWorldID recovery ────────────────────────────────────────────────

    function test_initiate_recovery() public {
        vm.prank(owner);
        registry.register(emailHash, 7200);

        registry.initiateRecovery(owner, newOwner, proof, inputs, 1, 999, wIdProof);

        (bool pending, address pendingOwner,,) = registry.recoveryStatus(owner);
        assertTrue(pending);
        assertEq(pendingOwner, newOwner);
    }

    function test_cancel_recovery() public {
        vm.prank(owner);
        registry.register(emailHash, 7200);

        registry.initiateRecovery(owner, newOwner, proof, inputs, 1, 999, wIdProof);

        vm.prank(owner);
        registry.cancelRecovery(owner);

        (bool pending,,,) = registry.recoveryStatus(owner);
        assertFalse(pending);
    }

    function test_execute_recovery_after_timelock() public {
        vm.prank(owner);
        registry.register(emailHash, 7200);

        registry.initiateRecovery(owner, newOwner, proof, inputs, 1, 999, wIdProof);

        vm.roll(block.number + 7201);
        registry.executeRecovery(owner);

        SpectreRegistry.AgentRecord memory r = registry.getRecord(owner);
        assertEq(r.owner, newOwner);
        assertEq(r.nonce, 2);
    }

    function test_execute_revert_timelock_not_elapsed() public {
        vm.prank(owner);
        registry.register(emailHash, 7200);

        registry.initiateRecovery(owner, newOwner, proof, inputs, 1, 999, wIdProof);

        vm.expectRevert(SpectreRegistry.TimelockNotElapsed.selector);
        registry.executeRecovery(owner);
    }

    function test_revert_nullifier_reuse() public {
        vm.prank(owner);
        registry.register(emailHash, 7200);

        registry.initiateRecovery(owner, newOwner, proof, inputs, 1, 999, wIdProof);
        vm.roll(block.number + 7201);
        registry.executeRecovery(owner);

        vm.prank(newOwner);
        registry.register(keccak256("new@example.com"), 7200);

        vm.expectRevert(SpectreRegistry.NullifierAlreadyUsed.selector);
        registry.initiateRecovery(newOwner, owner, proof, inputs, 1, 999, wIdProof);
    }

    function test_non_owner_cannot_cancel() public {
        vm.prank(owner);
        registry.register(emailHash, 7200);

        registry.initiateRecovery(owner, newOwner, proof, inputs, 1, 999, wIdProof);

        vm.prank(address(0x3));
        vm.expectRevert(SpectreRegistry.NotOwner.selector);
        registry.cancelRecovery(owner);
    }

    // ── Backup wallet recovery ────────────────────────────────────────────────

    function test_set_backup_wallet() public {
        address backup = address(0xB);
        vm.prank(owner);
        registry.register(emailHash, 7200);

        vm.prank(owner);
        registry.setBackupWallet(backup);

        SpectreRegistry.AgentRecord memory r = registry.getRecord(owner);
        assertEq(r.backupWallet, backup);
    }

    function test_backup_recovery_full_flow() public {
        address backup = address(0xB);
        vm.startPrank(owner);
        registry.register(emailHash, 7200);
        registry.setBackupWallet(backup);
        vm.stopPrank();

        vm.prank(backup);
        registry.initiateBackupRecovery(owner, newOwner);

        (bool pending, address pendingOwner,, SpectreRegistry.RecoveryMode mode) =
            registry.recoveryStatus(owner);
        assertTrue(pending);
        assertEq(pendingOwner, newOwner);
        assertEq(uint8(mode), uint8(SpectreRegistry.RecoveryMode.Backup));

        vm.roll(block.number + 7201);
        registry.executeRecovery(owner);
        assertEq(registry.getRecord(owner).owner, newOwner);
    }

    function test_backup_recovery_revert_not_backup_wallet() public {
        address backup = address(0xB);
        vm.startPrank(owner);
        registry.register(emailHash, 7200);
        registry.setBackupWallet(backup);
        vm.stopPrank();

        vm.prank(address(0xC)); // wrong caller
        vm.expectRevert(SpectreRegistry.NotBackupWallet.selector);
        registry.initiateBackupRecovery(owner, newOwner);
    }

    function test_backup_recovery_revert_no_backup_set() public {
        vm.prank(owner);
        registry.register(emailHash, 7200);

        vm.expectRevert(SpectreRegistry.BackupWalletNotSet.selector);
        registry.initiateBackupRecovery(owner, newOwner);
    }

    function test_owner_can_cancel_backup_recovery() public {
        address backup = address(0xB);
        vm.startPrank(owner);
        registry.register(emailHash, 7200);
        registry.setBackupWallet(backup);
        vm.stopPrank();

        vm.prank(backup);
        registry.initiateBackupRecovery(owner, newOwner);

        vm.prank(owner);
        registry.cancelRecovery(owner);

        (bool pending,,,) = registry.recoveryStatus(owner);
        assertFalse(pending);
    }

    // ── Social / guardian recovery ────────────────────────────────────────────

    address guardian1 = address(0xA1);
    address guardian2 = address(0xA2);
    address guardian3 = address(0xA3);

    function _registerWithGuardians(uint8 threshold) internal {
        vm.startPrank(owner);
        registry.register(emailHash, 7200);
        address[] memory gs = new address[](3);
        gs[0] = guardian1; gs[1] = guardian2; gs[2] = guardian3;
        registry.setGuardians(gs, threshold);
        vm.stopPrank();
    }

    function test_set_guardians() public {
        _registerWithGuardians(2);
        SpectreRegistry.AgentRecord memory r = registry.getRecord(owner);
        assertEq(r.guardianThreshold, 2);
        assertEq(r.guardianCount, 3);
        assertTrue(registry.isGuardian(owner, guardian1));
        assertTrue(registry.isGuardian(owner, guardian2));
    }

    function test_set_guardians_revert_invalid_threshold() public {
        vm.prank(owner);
        registry.register(emailHash, 7200);
        address[] memory gs = new address[](2);
        gs[0] = guardian1; gs[1] = guardian2;

        vm.prank(owner);
        vm.expectRevert(SpectreRegistry.InvalidThreshold.selector);
        registry.setGuardians(gs, 3); // threshold > count
    }

    function test_set_guardians_revert_too_many() public {
        vm.prank(owner);
        registry.register(emailHash, 7200);
        address[] memory gs = new address[](11); // > MAX_GUARDIANS
        for (uint256 i = 0; i < 11; i++) gs[i] = address(uint160(0xD000 + i));

        vm.prank(owner);
        vm.expectRevert(SpectreRegistry.TooManyGuardians.selector);
        registry.setGuardians(gs, 1);
    }

    function test_guardian_recovery_reaches_threshold() public {
        _registerWithGuardians(2);

        vm.prank(guardian1);
        registry.approveGuardianRecovery(owner, newOwner);
        assertEq(registry.getApprovalCount(owner, newOwner), 1);
        (bool pending,,,) = registry.recoveryStatus(owner);
        assertFalse(pending); // threshold not yet met

        vm.prank(guardian2);
        registry.approveGuardianRecovery(owner, newOwner);
        assertEq(registry.getApprovalCount(owner, newOwner), 2);

        (bool p, address po,, SpectreRegistry.RecoveryMode mode) = registry.recoveryStatus(owner);
        assertTrue(p);
        assertEq(po, newOwner);
        assertEq(uint8(mode), uint8(SpectreRegistry.RecoveryMode.Social));
    }

    function test_guardian_recovery_full_flow() public {
        _registerWithGuardians(2);

        vm.prank(guardian1);
        registry.approveGuardianRecovery(owner, newOwner);
        vm.prank(guardian2);
        registry.approveGuardianRecovery(owner, newOwner);

        vm.roll(block.number + 7201);
        registry.executeRecovery(owner);

        assertEq(registry.getRecord(owner).owner, newOwner);
    }

    function test_guardian_revert_not_guardian() public {
        _registerWithGuardians(2);

        vm.prank(address(0xDEAD));
        vm.expectRevert(SpectreRegistry.NotGuardian.selector);
        registry.approveGuardianRecovery(owner, newOwner);
    }

    function test_guardian_revert_already_voted() public {
        _registerWithGuardians(2);

        vm.prank(guardian1);
        registry.approveGuardianRecovery(owner, newOwner);

        vm.prank(guardian1);
        vm.expectRevert(SpectreRegistry.AlreadyVoted.selector);
        registry.approveGuardianRecovery(owner, newOwner);
    }

    function test_cancel_invalidates_guardian_votes() public {
        _registerWithGuardians(3); // threshold = 3

        vm.prank(guardian1);
        registry.approveGuardianRecovery(owner, newOwner);
        vm.prank(guardian2);
        registry.approveGuardianRecovery(owner, newOwner);

        // Third guardian tips threshold → pending
        vm.prank(guardian3);
        registry.approveGuardianRecovery(owner, newOwner);

        // Owner cancels (nonce increments)
        vm.prank(owner);
        registry.cancelRecovery(owner);

        // Old votes are gone (new nonce means new key)
        assertEq(registry.getApprovalCount(owner, newOwner), 0);

        (bool pending,,,) = registry.recoveryStatus(owner);
        assertFalse(pending);
    }

    function test_update_guardians_clears_old() public {
        _registerWithGuardians(2);
        assertTrue(registry.isGuardian(owner, guardian1));

        address newGuard = address(0xBB);
        address[] memory gs2 = new address[](1);
        gs2[0] = newGuard;

        vm.prank(owner);
        registry.setGuardians(gs2, 1);

        assertFalse(registry.isGuardian(owner, guardian1)); // cleared
        assertTrue(registry.isGuardian(owner, newGuard));
    }

    function test_get_guardians() public {
        _registerWithGuardians(2);
        address[] memory gs = registry.getGuardians(owner);
        assertEq(gs.length, 3);
        assertEq(gs[0], guardian1);
        assertEq(gs[1], guardian2);
        assertEq(gs[2], guardian3);
    }
}
