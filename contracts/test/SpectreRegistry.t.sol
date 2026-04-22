// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "forge-std/Test.sol";
import "../src/SpectreRegistry.sol";

/// @dev Stub verifier — always returns true. Replace with real verifier in integration tests.
contract MockVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }
}

/// @dev Stub World ID — always passes. Replace with real verifier in integration tests.
contract MockWorldID {
    function verifyProof(
        uint256, uint256, uint256, uint256, uint256, uint256[8] calldata
    ) external pure {}
}

contract SpectreRegistryTest is Test {
    SpectreRegistry registry;
    MockVerifier    mockVerifier;
    MockWorldID     mockWorldId;

    address owner   = address(0x1);
    address newOwner = address(0x2);
    bytes32 emailHash = keccak256("owner@example.com");

    function setUp() public {
        mockVerifier = new MockVerifier();
        mockWorldId  = new MockWorldID();
        registry     = new SpectreRegistry(address(mockVerifier), address(mockWorldId), 1);
    }

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
        registry.register(emailHash, 100);
    }

    function test_initiate_recovery() public {
        vm.prank(owner);
        registry.register(emailHash, 7200);

        bytes memory proof = hex"00";
        bytes32[] memory inputs = new bytes32[](0);
        uint256[8] memory wIdProof;

        registry.initiateRecovery(owner, newOwner, proof, inputs, 1, 999, wIdProof);

        (bool pending, address pending_owner,) = registry.recoveryStatus(owner);
        assertTrue(pending);
        assertEq(pending_owner, newOwner);
    }

    function test_cancel_recovery() public {
        vm.prank(owner);
        registry.register(emailHash, 7200);

        bytes memory proof = hex"00";
        bytes32[] memory inputs = new bytes32[](0);
        uint256[8] memory wIdProof;
        registry.initiateRecovery(owner, newOwner, proof, inputs, 1, 999, wIdProof);

        vm.prank(owner);
        registry.cancelRecovery(owner);

        (bool pending,,) = registry.recoveryStatus(owner);
        assertFalse(pending);
    }

    function test_execute_recovery_after_timelock() public {
        vm.prank(owner);
        registry.register(emailHash, 7200);

        bytes memory proof = hex"00";
        bytes32[] memory inputs = new bytes32[](0);
        uint256[8] memory wIdProof;
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

        bytes memory proof = hex"00";
        bytes32[] memory inputs = new bytes32[](0);
        uint256[8] memory wIdProof;
        registry.initiateRecovery(owner, newOwner, proof, inputs, 1, 999, wIdProof);

        vm.expectRevert(SpectreRegistry.TimelockNotElapsed.selector);
        registry.executeRecovery(owner);
    }

    function test_revert_nullifier_reuse() public {
        vm.prank(owner);
        registry.register(emailHash, 7200);

        bytes memory proof = hex"00";
        bytes32[] memory inputs = new bytes32[](0);
        uint256[8] memory wIdProof;
        registry.initiateRecovery(owner, newOwner, proof, inputs, 1, 999, wIdProof);

        vm.roll(block.number + 7201);
        registry.executeRecovery(owner);

        // Try to reuse the same nullifier on a new recovery
        vm.prank(newOwner);
        registry.register(keccak256("new@example.com"), 7200);

        vm.expectRevert(SpectreRegistry.NullifierAlreadyUsed.selector);
        registry.initiateRecovery(newOwner, owner, proof, inputs, 1, 999, wIdProof);
    }

    function test_non_owner_cannot_cancel() public {
        vm.prank(owner);
        registry.register(emailHash, 7200);

        bytes memory proof = hex"00";
        bytes32[] memory inputs = new bytes32[](0);
        uint256[8] memory wIdProof;
        registry.initiateRecovery(owner, newOwner, proof, inputs, 1, 999, wIdProof);

        vm.prank(address(0x3));
        vm.expectRevert(SpectreRegistry.NotOwner.selector);
        registry.cancelRecovery(owner);
    }
}
