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

/// @dev World ID mock that enforces checks-effects-interactions (S5).
///      IWorldID.verifyProof is `view`, so the registry STATICCALLs it — the
///      probe can only read. It reverts if, at the moment the external World
///      ID call runs, the nullifier is not already reserved and the recovery
///      not already staged. A CEI regression (effects after the call) makes
///      any initiateRecovery through this probe revert.
contract OrderingProbeWorldID {
    SpectreRegistry public reg;
    address public agent;
    uint256 public nullifier;

    function arm(SpectreRegistry r, address a, uint256 n) external {
        reg = r; agent = a; nullifier = n;
    }

    function verifyProof(
        uint256, uint256, uint256, uint256, uint256, uint256[8] calldata
    ) external view {
        SpectreRegistry.AgentRecord memory rec = reg.getRecord(agent);
        require(
            reg.usedNullifiers(nullifier) &&
                rec.pendingOwner != address(0) &&
                rec.pendingWorldIdNullifier == nullifier,
            "S5: effects must precede interactions"
        );
    }
}

/// @dev Permissive DKIM registry — every key is "known".
///      Use for tests that don't exercise the registry gate itself.
contract MockDKIMRegistry {
    function isKnown(bytes32) external pure returns (bool) { return true; }
}

/// @dev Restrictive DKIM registry — every key is "unknown".
///      Use for the negative test that confirms unknown keys are rejected.
contract DenyAllDKIMRegistry {
    function isKnown(bytes32) external pure returns (bool) { return false; }
}

contract SpectreRegistryTest is Test {
    SpectreRegistry  registry;
    MockVerifier     mockVerifier;
    MockWorldID      mockWorldId;
    MockDKIMRegistry mockDkim;

    address owner    = address(0x1);
    address newOwner = address(0x2);
    bytes32 emailHash = keccak256("owner@example.com");

    uint64 constant DEFAULT_TL = 7200;

    // helpers
    bytes      proof  = hex"00";
    bytes32[]  inputs;
    uint256[8] wIdProof;

    function setUp() public {
        mockVerifier = new MockVerifier();
        mockWorldId  = new MockWorldID();
        mockDkim     = new MockDKIMRegistry();
        registry     = new SpectreRegistry(
            address(mockVerifier),
            address(mockWorldId),
            address(mockDkim),
            1,
            1,
            DEFAULT_TL
        );
        inputs = _buildInputs(emailHash, newOwner, 1);
    }

    /// Build the 70-field public-input array the contract now requires.
    /// Slots [0..35] (pubkey limbs) are left zero — the mock verifier ignores them.
    function _buildInputs(bytes32 emailHash_, address newOwner_, uint256 nonce_)
        internal pure returns (bytes32[] memory pi)
    {
        pi = new bytes32[](70);
        for (uint256 i = 0; i < 32; i++) {
            pi[36 + i] = bytes32(uint256(uint8(emailHash_[i])));
        }
        pi[68] = bytes32(uint256(uint160(newOwner_)));
        pi[69] = bytes32(nonce_);
    }

    // ── Registration ─────────────────────────────────────────────────────────

    function test_register() public {
        vm.prank(owner);
        registry.register(emailHash);

        SpectreRegistry.AgentRecord memory r = registry.getRecord(owner);
        assertEq(r.owner, owner);
        assertEq(r.emailHash, emailHash);
        assertEq(r.nonce, 1);
    }

    function test_register_revert_already_registered() public {
        vm.startPrank(owner);
        registry.register(emailHash);
        vm.expectRevert(SpectreRegistry.AlreadyRegistered.selector);
        registry.register(emailHash);
        vm.stopPrank();
    }

    function test_register_revert_timelock_too_short() public {
        vm.prank(owner);
        vm.expectRevert(SpectreRegistry.TimelockTooShort.selector);
        registry.registerWithCustomTimelock(emailHash, 5);
    }

    // ── EmailWorldID recovery ────────────────────────────────────────────────

    function test_initiate_recovery() public {
        vm.prank(owner);
        registry.register(emailHash);

        registry.initiateRecovery(owner, newOwner, proof, inputs, 1, 999, wIdProof);

        (bool pending, address pendingOwner,,) = registry.recoveryStatus(owner);
        assertTrue(pending);
        assertEq(pendingOwner, newOwner);
    }

    function test_cancel_recovery() public {
        vm.prank(owner);
        registry.register(emailHash);

        registry.initiateRecovery(owner, newOwner, proof, inputs, 1, 999, wIdProof);

        vm.prank(owner);
        registry.cancelRecovery(owner);

        (bool pending,,,) = registry.recoveryStatus(owner);
        assertFalse(pending);
    }

    function test_execute_recovery_after_timelock() public {
        vm.prank(owner);
        registry.register(emailHash);

        registry.initiateRecovery(owner, newOwner, proof, inputs, 1, 999, wIdProof);

        vm.roll(block.number + 7201);
        registry.executeRecovery(owner);

        SpectreRegistry.AgentRecord memory r = registry.getRecord(owner);
        assertEq(r.owner, newOwner);
        assertEq(r.nonce, 2);
    }

    function test_execute_revert_timelock_not_elapsed() public {
        vm.prank(owner);
        registry.register(emailHash);

        registry.initiateRecovery(owner, newOwner, proof, inputs, 1, 999, wIdProof);

        vm.expectRevert(SpectreRegistry.TimelockNotElapsed.selector);
        registry.executeRecovery(owner);
    }

    function test_revert_nullifier_reuse() public {
        vm.prank(owner);
        registry.register(emailHash);

        registry.initiateRecovery(owner, newOwner, proof, inputs, 1, 999, wIdProof);
        vm.roll(block.number + 7201);
        registry.executeRecovery(owner);

        vm.prank(newOwner);
        registry.register(keccak256("new@example.com"));

        vm.expectRevert(SpectreRegistry.NullifierAlreadyUsed.selector);
        registry.initiateRecovery(newOwner, owner, proof, inputs, 1, 999, wIdProof);
    }

    function test_non_owner_cannot_cancel() public {
        vm.prank(owner);
        registry.register(emailHash);

        registry.initiateRecovery(owner, newOwner, proof, inputs, 1, 999, wIdProof);

        vm.prank(address(0x3));
        vm.expectRevert(SpectreRegistry.NotOwner.selector);
        registry.cancelRecovery(owner);
    }

    // ── Backup wallet recovery ────────────────────────────────────────────────

    function test_set_backup_wallet() public {
        address backup = address(0xB);
        vm.prank(owner);
        registry.register(emailHash);

        vm.prank(owner);
        registry.setBackupWallet(backup);

        SpectreRegistry.AgentRecord memory r = registry.getRecord(owner);
        assertEq(r.backupWallet, backup);
    }

    function test_backup_recovery_full_flow() public {
        address backup = address(0xB);
        vm.startPrank(owner);
        registry.register(emailHash);
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
        registry.register(emailHash);
        registry.setBackupWallet(backup);
        vm.stopPrank();

        vm.prank(address(0xC)); // wrong caller
        vm.expectRevert(SpectreRegistry.NotBackupWallet.selector);
        registry.initiateBackupRecovery(owner, newOwner);
    }

    function test_backup_recovery_revert_no_backup_set() public {
        vm.prank(owner);
        registry.register(emailHash);

        vm.expectRevert(SpectreRegistry.BackupWalletNotSet.selector);
        registry.initiateBackupRecovery(owner, newOwner);
    }

    function test_owner_can_cancel_backup_recovery() public {
        address backup = address(0xB);
        vm.startPrank(owner);
        registry.register(emailHash);
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
        registry.register(emailHash);
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
        registry.register(emailHash);
        address[] memory gs = new address[](2);
        gs[0] = guardian1; gs[1] = guardian2;

        vm.prank(owner);
        vm.expectRevert(SpectreRegistry.InvalidThreshold.selector);
        registry.setGuardians(gs, 3); // threshold > count
    }

    function test_set_guardians_revert_too_many() public {
        vm.prank(owner);
        registry.register(emailHash);
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

    // ── Edge cases ────────────────────────────────────────────────────────────

    function test_initiate_revert_zero_new_owner() public {
        vm.prank(owner);
        registry.register(emailHash);

        vm.expectRevert(SpectreRegistry.ZeroAddress.selector);
        registry.initiateRecovery(owner, address(0), proof, inputs, 1, 999, wIdProof);
    }

    function test_initiate_revert_not_registered() public {
        vm.expectRevert(SpectreRegistry.NotRegistered.selector);
        registry.initiateRecovery(address(0x99), newOwner, proof, inputs, 1, 999, wIdProof);
    }

    function test_initiate_revert_recovery_already_pending() public {
        vm.prank(owner);
        registry.register(emailHash);

        registry.initiateRecovery(owner, newOwner, proof, inputs, 1, 999, wIdProof);

        vm.expectRevert(SpectreRegistry.RecoveryPending.selector);
        registry.initiateRecovery(owner, address(0x5), proof, inputs, 1, 888, wIdProof);
    }

    function test_execute_revert_no_recovery_pending() public {
        vm.prank(owner);
        registry.register(emailHash);

        vm.expectRevert(SpectreRegistry.NoRecoveryPending.selector);
        registry.executeRecovery(owner);
    }

    function test_double_execute_reverts() public {
        vm.prank(owner);
        registry.register(emailHash);

        registry.initiateRecovery(owner, newOwner, proof, inputs, 1, 999, wIdProof);
        vm.roll(block.number + 7201);
        registry.executeRecovery(owner);

        // second execute should fail — no longer pending
        vm.expectRevert(SpectreRegistry.NoRecoveryPending.selector);
        registry.executeRecovery(owner);
    }

    function test_cancel_revert_no_recovery_pending() public {
        vm.prank(owner);
        registry.register(emailHash);

        vm.prank(owner);
        vm.expectRevert(SpectreRegistry.NoRecoveryPending.selector);
        registry.cancelRecovery(owner);
    }

    function test_register_revert_zero_email_hash() public {
        vm.prank(owner);
        vm.expectRevert(SpectreRegistry.InvalidEmailHash.selector);
        registry.register(bytes32(0));
    }

    function test_backup_revert_zero_new_owner() public {
        address backup = address(0xB);
        vm.startPrank(owner);
        registry.register(emailHash);
        registry.setBackupWallet(backup);
        vm.stopPrank();

        vm.prank(backup);
        vm.expectRevert(SpectreRegistry.ZeroAddress.selector);
        registry.initiateBackupRecovery(owner, address(0));
    }

    function test_guardian_revert_zero_new_owner() public {
        _registerWithGuardians(2);

        vm.prank(guardian1);
        vm.expectRevert(SpectreRegistry.ZeroAddress.selector);
        registry.approveGuardianRecovery(owner, address(0));
    }

    function test_nonce_increments_on_execute() public {
        vm.prank(owner);
        registry.register(emailHash);
        assertEq(registry.getRecord(owner).nonce, 1);

        registry.initiateRecovery(owner, newOwner, proof, inputs, 1, 999, wIdProof);
        vm.roll(block.number + 7201);
        registry.executeRecovery(owner);
        assertEq(registry.getRecord(owner).nonce, 2);
    }

    function test_nonce_increments_on_cancel() public {
        vm.prank(owner);
        registry.register(emailHash);

        registry.initiateRecovery(owner, newOwner, proof, inputs, 1, 999, wIdProof);

        vm.prank(owner);
        registry.cancelRecovery(owner);
        assertEq(registry.getRecord(owner).nonce, 2);
    }

    function test_constructor_revert_zero_verifier() public {
        vm.expectRevert(SpectreRegistry.ZeroAddress.selector);
        new SpectreRegistry(address(0), address(mockWorldId), address(mockDkim), 1, 1, DEFAULT_TL);
    }

    function test_constructor_revert_zero_worldid() public {
        vm.expectRevert(SpectreRegistry.ZeroAddress.selector);
        new SpectreRegistry(address(mockVerifier), address(0), address(mockDkim), 1, 1, DEFAULT_TL);
    }

    function test_constructor_revert_zero_dkim_registry() public {
        vm.expectRevert(SpectreRegistry.ZeroAddress.selector);
        new SpectreRegistry(address(mockVerifier), address(mockWorldId), address(0), 1, 1, DEFAULT_TL);
    }

    function test_constructor_revert_zero_default_timelock() public {
        vm.expectRevert(SpectreRegistry.TimelockTooShort.selector);
        new SpectreRegistry(address(mockVerifier), address(mockWorldId), address(mockDkim), 1, 1, 0);
    }

    // ── A4: default timelock ─────────────────────────────────────────────────

    function test_register_default_uses_default_timelock() public {
        vm.prank(owner);
        registry.register(emailHash);

        SpectreRegistry.AgentRecord memory r = registry.getRecord(owner);
        assertEq(r.timelockBlocks, DEFAULT_TL);
    }

    function test_registerWithCustomTimelock_at_default_succeeds() public {
        vm.prank(owner);
        registry.registerWithCustomTimelock(emailHash, DEFAULT_TL);
        assertEq(registry.getRecord(owner).timelockBlocks, DEFAULT_TL);
    }

    function test_registerWithCustomTimelock_above_default_succeeds() public {
        vm.prank(owner);
        registry.registerWithCustomTimelock(emailHash, DEFAULT_TL + 1);
        assertEq(registry.getRecord(owner).timelockBlocks, DEFAULT_TL + 1);
    }

    function test_registerWithCustomTimelock_below_default_reverts() public {
        vm.prank(owner);
        vm.expectRevert(SpectreRegistry.TimelockTooShort.selector);
        registry.registerWithCustomTimelock(emailHash, DEFAULT_TL - 1);
    }

    // ── A1: emailPublicInputs binding ────────────────────────────────────────

    function test_initiate_revert_wrong_email_hash() public {
        vm.prank(owner);
        registry.register(emailHash);

        bytes32[] memory bad = _buildInputs(keccak256("attacker@evil.com"), newOwner, 1);
        vm.expectRevert(SpectreRegistry.InvalidProof.selector);
        registry.initiateRecovery(owner, newOwner, proof, bad, 1, 999, wIdProof);
    }

    function test_initiate_revert_wrong_new_owner_in_inputs() public {
        vm.prank(owner);
        registry.register(emailHash);

        // inputs claim new owner is 0xDEAD but the call passes newOwner
        bytes32[] memory bad = _buildInputs(emailHash, address(0xDEAD), 1);
        vm.expectRevert(SpectreRegistry.InvalidProof.selector);
        registry.initiateRecovery(owner, newOwner, proof, bad, 1, 999, wIdProof);
    }

    function test_initiate_revert_wrong_nonce_in_inputs() public {
        vm.prank(owner);
        registry.register(emailHash);

        // record.nonce starts at 1; proof claims nonce 99
        bytes32[] memory bad = _buildInputs(emailHash, newOwner, 99);
        vm.expectRevert(SpectreRegistry.InvalidProof.selector);
        registry.initiateRecovery(owner, newOwner, proof, bad, 1, 999, wIdProof);
    }

    function test_initiate_revert_wrong_input_length() public {
        vm.prank(owner);
        registry.register(emailHash);

        bytes32[] memory tooShort = new bytes32[](69);
        vm.expectRevert(SpectreRegistry.InvalidProof.selector);
        registry.initiateRecovery(owner, newOwner, proof, tooShort, 1, 999, wIdProof);
    }

    function test_initiate_after_cancel_uses_new_nonce_binding() public {
        // After cancel, nonce -> 2. Old inputs (nonce=1) must no longer work.
        vm.prank(owner);
        registry.register(emailHash);

        registry.initiateRecovery(owner, newOwner, proof, inputs, 1, 999, wIdProof);
        vm.prank(owner);
        registry.cancelRecovery(owner);
        assertEq(registry.getRecord(owner).nonce, 2);

        // stale inputs (nonce=1) should now fail the binding check
        vm.expectRevert(SpectreRegistry.InvalidProof.selector);
        registry.initiateRecovery(owner, newOwner, proof, inputs, 1, 1000, wIdProof);

        // fresh inputs (nonce=2) succeed
        bytes32[] memory fresh = _buildInputs(emailHash, newOwner, 2);
        registry.initiateRecovery(owner, newOwner, proof, fresh, 1, 1000, wIdProof);
        (bool pending,,,) = registry.recoveryStatus(owner);
        assertTrue(pending);
    }

    // ── A2: DKIM key gate ────────────────────────────────────────────────────

    function test_initiate_revert_when_dkim_key_unknown() public {
        // Deploy a registry that rejects every key, point a fresh SpectreRegistry at it.
        DenyAllDKIMRegistry deny = new DenyAllDKIMRegistry();
        SpectreRegistry strict = new SpectreRegistry(
            address(mockVerifier),
            address(mockWorldId),
            address(deny),
            1,
            1,
            DEFAULT_TL
        );

        vm.prank(owner);
        strict.register(emailHash);

        bytes32[] memory pi = _buildInputs(emailHash, newOwner, 1);
        vm.expectRevert(SpectreRegistry.InvalidProof.selector);
        strict.initiateRecovery(owner, newOwner, proof, pi, 1, 999, wIdProof);
    }

    // ── S4: nullifier lifecycle (release on cancel) ──────────────────────────

    function test_initiate_stages_nullifier() public {
        vm.prank(owner);
        registry.register(emailHash);

        registry.initiateRecovery(owner, newOwner, proof, inputs, 1, 999, wIdProof);

        assertTrue(registry.usedNullifiers(999));
        assertEq(registry.getRecord(owner).pendingWorldIdNullifier, 999);
    }

    function test_cancel_releases_nullifier() public {
        vm.prank(owner);
        registry.register(emailHash);

        registry.initiateRecovery(owner, newOwner, proof, inputs, 1, 999, wIdProof);

        vm.prank(owner);
        registry.cancelRecovery(owner);

        // S4: the cancelled attempt must NOT permanently burn the nullifier.
        assertFalse(registry.usedNullifiers(999));
        assertEq(registry.getRecord(owner).pendingWorldIdNullifier, 0);

        // Same World ID identity (same nullifier) can recover again — pre-fix
        // this reverted NullifierAlreadyUsed and bricked the mode forever.
        bytes32[] memory fresh = _buildInputs(emailHash, newOwner, 2);
        registry.initiateRecovery(owner, newOwner, proof, fresh, 1, 999, wIdProof);
        (bool pending,,,) = registry.recoveryStatus(owner);
        assertTrue(pending);
    }

    function test_execute_keeps_nullifier_consumed() public {
        vm.prank(owner);
        registry.register(emailHash);

        registry.initiateRecovery(owner, newOwner, proof, inputs, 1, 999, wIdProof);
        vm.roll(block.number + 7201);
        registry.executeRecovery(owner);

        // Finalized recovery: nullifier stays spent, staged pointer cleared.
        assertTrue(registry.usedNullifiers(999));
        assertEq(registry.getRecord(owner).pendingWorldIdNullifier, 0);
    }

    function test_backup_recovery_does_not_stage_nullifier() public {
        address backup = address(0xB);
        vm.startPrank(owner);
        registry.register(emailHash);
        registry.setBackupWallet(backup);
        vm.stopPrank();

        vm.prank(backup);
        registry.initiateBackupRecovery(owner, newOwner);

        // Non-Email modes never touch the nullifier; cancel must be a no-op
        // on it (the != 0 guard) and not revert.
        assertEq(registry.getRecord(owner).pendingWorldIdNullifier, 0);
        vm.prank(owner);
        registry.cancelRecovery(owner);
        (bool pending,,,) = registry.recoveryStatus(owner);
        assertFalse(pending);
    }

    // ── S5: checks-effects-interactions ordering ─────────────────────────────

    function test_effects_applied_before_external_worldid_call() public {
        OrderingProbeWorldID probe = new OrderingProbeWorldID();
        SpectreRegistry reg = new SpectreRegistry(
            address(mockVerifier),
            address(probe),
            address(mockDkim),
            1,
            1,
            DEFAULT_TL
        );
        probe.arm(reg, owner, 999);

        vm.prank(owner);
        reg.register(emailHash);
        // The probe (running inside the external World ID staticcall) reverts
        // unless the nullifier is reserved and the recovery staged. A CEI
        // regression would make this initiate revert.
        reg.initiateRecovery(owner, newOwner, proof, inputs, 1, 999, wIdProof);

        (bool pending,,,) = reg.recoveryStatus(owner);
        assertTrue(pending);
    }
}
