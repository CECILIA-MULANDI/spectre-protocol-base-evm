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
///         Supports three recovery modes:
///           1. EmailWorldID — DKIM email proof + World ID Semaphore proof
///           2. Backup       — pre-registered backup wallet initiates
///           3. Social       — M-of-N guardian approvals
///         All modes are time-locked so the real owner can cancel a fraudulent attempt.
contract SpectreRegistry {
    enum RecoveryMode {
        None,
        EmailWorldID,
        Social,
        Backup
    }

    // ── Errors ───────────────────────────────────────────────────────────────

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
    error NotGuardian();
    error AlreadyVoted();
    error TooManyGuardians();
    error InvalidThreshold();
    error NotBackupWallet();
    error BackupWalletNotSet();

    event AgentRegistered(address indexed owner, bytes32 emailHash);
    event RecoveryInitiated(
        address indexed owner,
        address indexed newOwner,
        uint64 executeAfterBlock,
        RecoveryMode mode
    );
    event RecoveryCancelled(address indexed owner);
    event RecoveryExecuted(address indexed owner, address indexed newOwner);
    event BackupWalletSet(address indexed owner, address indexed backupWallet);
    event GuardiansSet(
        address indexed owner,
        address[] guardians,
        uint8 threshold
    );
    event GuardianApproved(
        address indexed agentOwner,
        address indexed guardian,
        address indexed newOwner,
        uint8 approvalCount
    );

    struct AgentRecord {
        bytes32 emailHash;
        address owner;
        // staged during timelock (zero if no pending recovery)
        address pendingOwner;
        // cancel window in blocks (min 10 for testnet, 7200 ≈ 24h on Base mainnet)
        uint64 timelockBlocks;
        uint64 recoveryInitBlock;
        uint256 nonce;
        // backup wallet recovery
        address backupWallet;
        // social / guardian recovery
        uint8 guardianThreshold;
        uint8 guardianCount;
        // which mode triggered the current pending recovery
        RecoveryMode pendingRecoveryMode;
    }

    // 10 blocks for testnet; set to 7200 (~24h on Base) before mainnet deployment
    uint64 public constant MIN_TIMELOCK_BLOCKS = 10;
    uint8 public constant MAX_GUARDIANS = 10;

    // owner → record
    mapping(address => AgentRecord) public records;

    // World ID nullifier hash → used
    mapping(uint256 => bool) public usedNullifiers;

    // guardian storage
    mapping(address => address[]) private _guardianList;
    mapping(address => mapping(address => bool)) public isGuardian;

    // approval key = keccak256(agentOwner, newOwner, nonce) — nonce increment auto-invalidates stale votes
    mapping(bytes32 => mapping(address => bool)) public guardianVotes;
    mapping(bytes32 => uint8) public approvalCounts;

    // External contracts
    IUltraVerifier public immutable verifier;
    IWorldID public immutable worldId;
    uint256 public immutable worldIdGroupId;
    uint256 public immutable externalNullifier;

    constructor(
        address _verifier,
        address _worldId,
        uint256 _worldIdGroupId,
        uint256 _externalNullifier
    ) {
        if (_verifier == address(0) || _worldId == address(0))
            revert ZeroAddress();
        verifier = IUltraVerifier(_verifier);
        worldId = IWorldID(_worldId);
        worldIdGroupId = _worldIdGroupId;
        externalNullifier = _externalNullifier;
    }

    /// @notice Register an agent recovery config for msg.sender.
    /// @param emailHash      SHA256 of the owner's recovery email address.
    /// @param timelockBlocks Cancel window in blocks (min MIN_TIMELOCK_BLOCKS).
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
            nonce: 1,
            backupWallet: address(0),
            guardianThreshold: 0,
            guardianCount: 0,
            pendingRecoveryMode: RecoveryMode.None
        });

        emit AgentRegistered(msg.sender, emailHash);
    }

    // ── Mode 1: EmailWorldID recovery ────────────────────────────────────────

    /// @notice Initiate recovery using DKIM email proof + World ID Semaphore proof.
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

        if (!verifier.verify(emailProof, emailPublicInputs))
            revert InvalidProof();

        // signal binds agentOwner, newOwner, and nonce — prevents replay
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
        record.pendingRecoveryMode = RecoveryMode.EmailWorldID;

        emit RecoveryInitiated(
            agentOwner,
            newOwner,
            uint64(block.number) + record.timelockBlocks,
            RecoveryMode.EmailWorldID
        );
    }

    // ── Mode 2: Backup wallet recovery ───────────────────────────────────────

    /// @notice Set or update the backup wallet for msg.sender's agent.
    function setBackupWallet(address backupWallet) external {
        AgentRecord storage record = records[msg.sender];
        if (record.owner == address(0)) revert NotRegistered();
        record.backupWallet = backupWallet;
        emit BackupWalletSet(msg.sender, backupWallet);
    }

    /// @notice Initiate backup-wallet recovery. Must be called by the registered backup wallet.
    function initiateBackupRecovery(
        address agentOwner,
        address newOwner
    ) external {
        AgentRecord storage record = records[agentOwner];
        if (record.owner == address(0)) revert NotRegistered();
        if (record.pendingOwner != address(0)) revert RecoveryPending();
        if (record.backupWallet == address(0)) revert BackupWalletNotSet();
        if (msg.sender != record.backupWallet) revert NotBackupWallet();
        if (newOwner == address(0)) revert ZeroAddress();

        record.pendingOwner = newOwner;
        record.recoveryInitBlock = uint64(block.number);
        record.pendingRecoveryMode = RecoveryMode.Backup;

        emit RecoveryInitiated(
            agentOwner,
            newOwner,
            uint64(block.number) + record.timelockBlocks,
            RecoveryMode.Backup
        );
    }

    // ── Mode 3: Social / guardian recovery ───────────────────────────────────

    /// @notice Set or replace the guardian list for msg.sender's agent.
    /// @param newGuardians List of guardian addresses (max MAX_GUARDIANS).
    /// @param threshold    Minimum approvals required to start the timelock.
    function setGuardians(
        address[] calldata newGuardians,
        uint8 threshold
    ) external {
        AgentRecord storage record = records[msg.sender];
        if (record.owner == address(0)) revert NotRegistered();
        if (newGuardians.length > MAX_GUARDIANS) revert TooManyGuardians();
        if (threshold == 0 || threshold > newGuardians.length)
            revert InvalidThreshold();

        // Clear old guardians
        address[] storage old = _guardianList[msg.sender];
        for (uint256 i = 0; i < old.length; i++) {
            isGuardian[msg.sender][old[i]] = false;
        }
        delete _guardianList[msg.sender];

        for (uint256 i = 0; i < newGuardians.length; i++) {
            _guardianList[msg.sender].push(newGuardians[i]);
            isGuardian[msg.sender][newGuardians[i]] = true;
        }

        record.guardianThreshold = threshold;
        record.guardianCount = uint8(newGuardians.length);

        emit GuardiansSet(msg.sender, newGuardians, threshold);
    }

    /// @notice A guardian casts an approval vote for a proposed new owner.
    ///         Once the threshold is reached, the timelock starts automatically.
    function approveGuardianRecovery(
        address agentOwner,
        address newOwner
    ) external {
        AgentRecord storage record = records[agentOwner];
        if (record.owner == address(0)) revert NotRegistered();
        // Allow voting when no pending recovery, or when the same newOwner is already pending
        if (
            record.pendingOwner != address(0) && record.pendingOwner != newOwner
        ) revert RecoveryPending();
        if (!isGuardian[agentOwner][msg.sender]) revert NotGuardian();
        if (newOwner == address(0)) revert ZeroAddress();

        bytes32 key = keccak256(
            abi.encodePacked(agentOwner, newOwner, record.nonce)
        );
        if (guardianVotes[key][msg.sender]) revert AlreadyVoted();

        guardianVotes[key][msg.sender] = true;
        uint8 count = approvalCounts[key] + 1;
        approvalCounts[key] = count;

        emit GuardianApproved(agentOwner, msg.sender, newOwner, count);

        // Start timelock once threshold is reached (only if not already pending)
        if (
            count >= record.guardianThreshold &&
            record.pendingOwner == address(0)
        ) {
            record.pendingOwner = newOwner;
            record.recoveryInitBlock = uint64(block.number);
            record.pendingRecoveryMode = RecoveryMode.Social;
            emit RecoveryInitiated(
                agentOwner,
                newOwner,
                uint64(block.number) + record.timelockBlocks,
                RecoveryMode.Social
            );
        }
    }

    // ── Shared cancel / execute ───────────────────────────────────────────────

    /// @notice Cancel any pending recovery. Only callable by the current owner.
    ///         Increments nonce, which invalidates all stale guardian votes.
    function cancelRecovery(address agentOwner) external {
        AgentRecord storage record = records[agentOwner];
        if (record.owner == address(0)) revert NotRegistered();
        if (record.pendingOwner == address(0)) revert NoRecoveryPending();
        if (msg.sender != record.owner) revert NotOwner();

        record.pendingOwner = address(0);
        record.recoveryInitBlock = 0;
        record.pendingRecoveryMode = RecoveryMode.None;
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
        record.pendingRecoveryMode = RecoveryMode.None;
        record.nonce += 1;

        emit RecoveryExecuted(agentOwner, newOwner);
    }

    //View fns

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
        returns (
            bool pending,
            address pendingOwner,
            uint64 executeAfterBlock,
            RecoveryMode mode
        )
    {
        AgentRecord storage record = records[owner];
        pending = record.pendingOwner != address(0);
        pendingOwner = record.pendingOwner;
        executeAfterBlock = pending
            ? record.recoveryInitBlock + record.timelockBlocks
            : 0;
        mode = record.pendingRecoveryMode;
    }

    function getGuardians(
        address owner
    ) external view returns (address[] memory) {
        return _guardianList[owner];
    }

    /// @notice Current approval count for a proposed recovery (using the live nonce).
    function getApprovalCount(
        address agentOwner,
        address newOwner
    ) external view returns (uint8) {
        AgentRecord storage record = records[agentOwner];
        bytes32 key = keccak256(
            abi.encodePacked(agentOwner, newOwner, record.nonce)
        );
        return approvalCounts[key];
    }
}
