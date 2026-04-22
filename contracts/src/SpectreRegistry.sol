// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "./IWorldID.sol";

interface IUltraVerifier {
    function verify(
        bytes calldata proof,
        bytes32[] calldata publicInputs
    ) external view returns (bool);
}

/// @title SpectreRegistry
/// @notice ZK key recovery protocol for AI agents.
///         Recovery requires two proofs: DKIM email proof (Noir/UltraHonk) + World ID proof.
///         Recovery is time-locked so the real owner can cancel a fraudulent attempt.
contract SpectreRegistry {
    // Errors
    error AlreadyRegistered();
    error NotRegistered();
    error RecoveryPending();
    error NoRecoveryPending();
    error TimelockNotElapsed();
    error InvalidEmailHash();
    error InvalidProof();
    error NullifierAlreadyUsed();
    error TimelockTooShort();
    error NotOwner();
    error ZeroAddress();

    //Events

    event AgentRegistered(address indexed owner, bytes32 emailHash);
    event RecoveryInitiated(
        address indexed owner,
        address indexed newOwner,
        uint64 executeAfterBlock
    );
    event RecoveryCancelled(address indexed owner);
    event RecoveryExecuted(address indexed owner, address indexed newOwner);

    struct AgentRecord {
        bytes32 emailHash;
        address owner;
        // staged during timelock (zero if no pending recovery)
        address pendingOwner;
        // cancel window in blocks (min 7200 ≈ 24h on Base)
        uint64 timelockBlocks;
        uint64 recoveryInitBlock;
        uint256 nonce;
    }

    // owner address → AgentRecord
    mapping(address => AgentRecord) public records;

    // World ID nullifier hash → used (prevents proof reuse across recoveries)
    mapping(uint256 => bool) public usedNullifiers;
    // uint64 public constant MIN_TIMELOCK_BLOCKS = 7200;
    uint64 public constant MIN_TIMELOCK_BLOCKS = 10;
    // External contracts
    IUltraVerifier public immutable verifier;
    IWorldID public immutable worldId;
    uint256 public immutable worldIdGroupId;

    // Scoped nullifier — prevents World ID proof reuse across different apps
    uint256 public immutable externalNullifier;

    constructor(address _verifier, address _worldId, uint256 _worldIdGroupId) {
        if (_verifier == address(0) || _worldId == address(0))
            revert ZeroAddress();
        verifier = IUltraVerifier(_verifier);
        worldId = IWorldID(_worldId);
        worldIdGroupId = _worldIdGroupId;
        externalNullifier = uint256(
            keccak256(abi.encodePacked("spectre.recovery.v1"))
        );
    }

    /// @notice Register an agent recovery config for msg.sender.
    /// @param emailHash     SHA256 of the owner's recovery email address.
    /// @param timelockBlocks Number of blocks for the cancel window (min 7200).
    function register(bytes32 emailHash, uint64 timelockBlocks) external {
        if (records[msg.sender].owner != address(0)) revert AlreadyRegistered();
        if (timelockBlocks < MIN_TIMELOCK_BLOCKS) revert TimelockTooShort();
        if (emailHash == bytes32(0)) revert InvalidEmailHash();

        records[msg.sender] = AgentRecord({
            emailHash: emailHash,
            owner: msg.sender,
            pendingOwner: address(0),
            timelockBlocks: timelockBlocks,
            recoveryInitBlock: 0,
            nonce: 1
        });

        emit AgentRegistered(msg.sender, emailHash);
    }

    /// @notice Initiate recovery. Verifies DKIM email proof + World ID proof.
    ///         Starts the timelock. Owner can cancel within timelockBlocks.
    /// @param agentOwner     Address of the agent being recovered.
    /// @param newOwner       Address to rotate control to.
    /// @param emailProof     UltraHonk proof bytes from the Noir circuit.
    /// @param emailPublicInputs Public inputs for the email proof (pubkey limbs, email_hash, new_owner_key, nonce).
    /// @param worldIdRoot    World ID merkle root.
    /// @param worldIdNullifier World ID nullifier hash (prevents double-use).
    /// @param worldIdProof   World ID Semaphore proof.
    function initiateRecovery(
        address agentOwner,
        address newOwner,
        bytes calldata emailProof,
        bytes32[] calldata emailPublicInputs,
        uint256 worldIdRoot,
        uint256 worldIdNullifier,
        uint256[8] calldata worldIdProof
    ) external {
        AgentRecord storage record = records[agentOwner];
        if (record.owner == address(0)) revert NotRegistered();
        if (record.pendingOwner != address(0)) revert RecoveryPending();
        if (newOwner == address(0)) revert ZeroAddress();
        if (usedNullifiers[worldIdNullifier]) revert NullifierAlreadyUsed();

        // Verify DKIM email proof
        if (!verifier.verify(emailProof, emailPublicInputs))
            revert InvalidProof();

        // Verify World ID proof — signal is keccak256(agentOwner, newOwner, nonce)
        uint256 signal = uint256(
            keccak256(abi.encodePacked(agentOwner, newOwner, record.nonce))
        );
        worldId.verifyProof(
            worldIdRoot,
            worldIdGroupId,
            signal,
            worldIdNullifier,
            externalNullifier,
            worldIdProof
        );

        usedNullifiers[worldIdNullifier] = true;

        record.pendingOwner = newOwner;
        record.recoveryInitBlock = uint64(block.number);

        emit RecoveryInitiated(
            agentOwner,
            newOwner,
            uint64(block.number) + record.timelockBlocks
        );
    }

    /// @notice Cancel a pending recovery. Only callable by the current owner.
    function cancelRecovery(address agentOwner) external {
        AgentRecord storage record = records[agentOwner];
        if (record.owner == address(0)) revert NotRegistered();
        if (record.pendingOwner == address(0)) revert NoRecoveryPending();
        if (msg.sender != record.owner) revert NotOwner();

        record.pendingOwner = address(0);
        record.recoveryInitBlock = 0;
        record.nonce += 1;

        emit RecoveryCancelled(agentOwner);
    }

    /// @notice Execute a recovery after the timelock has elapsed. Callable by anyone.
    function executeRecovery(address agentOwner) external {
        AgentRecord storage record = records[agentOwner];
        if (record.owner == address(0)) revert NotRegistered();
        if (record.pendingOwner == address(0)) revert NoRecoveryPending();
        if (block.number < record.recoveryInitBlock + record.timelockBlocks)
            revert TimelockNotElapsed();

        address newOwner = record.pendingOwner;
        record.owner = newOwner;
        record.pendingOwner = address(0);
        record.recoveryInitBlock = 0;
        record.nonce += 1;

        emit RecoveryExecuted(agentOwner, newOwner);
    }

    function getRecord(
        address owner
    ) external view returns (AgentRecord memory) {
        return records[owner];
    }

    function recoveryStatus(
        address owner
    )
        external
        view
        returns (bool pending, address pendingOwner, uint64 executeAfterBlock)
    {
        AgentRecord storage record = records[owner];
        pending = record.pendingOwner != address(0);
        pendingOwner = record.pendingOwner;
        executeAfterBlock = pending
            ? record.recoveryInitBlock + record.timelockBlocks
            : 0;
    }
}
