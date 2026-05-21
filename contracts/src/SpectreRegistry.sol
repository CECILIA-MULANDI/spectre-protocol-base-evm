// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {IPersonhoodVerifier} from "./IPersonhoodVerifier.sol";

interface IUltraVerifier {
    function verify(
        bytes calldata proof,
        bytes32[] calldata publicInputs
    ) external view returns (bool);
}

interface IDKIMRegistry {
    function isKnown(bytes32 keyHash) external view returns (bool);
}

interface IPersonhoodRegistry {
    function isApproved(address adapter) external view returns (bool);
}

/// @title SpectreRegistry
/// @notice ZK key recovery protocol for AI agents.
///         Supports three recovery modes:
///           1. EmailPersonhood — DKIM email proof + pluggable personhood proof
///           2. Backup          — pre-registered backup wallet initiates
///           3. Social          — M-of-N guardian approvals
///         All modes are time-locked so the real owner can cancel a fraudulent attempt.
contract SpectreRegistry {
    enum RecoveryMode {
        None,
        EmailPersonhood,
        Social,
        Backup
    }

    // Errors

    error AlreadyRegistered();
    error NotRegistered();
    error RecoveryPending();
    error NoRecoveryPending();
    error TimelockNotElapsed();
    error InvalidEmailHash();
    error InvalidProof();
    error NullifierAlreadyUsed();
    error AdapterNotApproved();
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
        // personhood adapter this agent recovers through; the protocol default
        // unless a different approved adapter was chosen at register time
        address personhoodAdapter;
        // Personhood nullifier staged with the current pending EmailPersonhood
        // recovery; zero unless one is in flight. Stored so cancelRecovery can
        // release it (S4) — without this, a cancelled attempt would burn the
        // identity's nullifier forever and brick EmailPersonhood recovery.
        uint256 pendingPersonhoodNullifier;
    }

    uint8 public constant MAX_GUARDIANS = 10;

    // Public-input layout produced by circuits/src/main.nr (70 fields total):
    //   [0..17]  pubkey.modulus limbs (18 fields)
    //   [18..35] pubkey.redc limbs    (18 fields)
    //   [36..67] email_hash bytes     (32 fields, low byte of each)
    //   [68]     new_public_key       (Field — encoded address)
    //   [69]     nonce                (Field)
    uint256 internal constant PUB_INPUTS_LENGTH = 70;
    uint256 internal constant EMAIL_HASH_OFFSET = 36;
    uint256 internal constant NEW_KEY_OFFSET = 68;
    uint256 internal constant NONCE_OFFSET = 69;

    // owner → record
    mapping(address => AgentRecord) public records;

    // Personhood nullifier hash → used
    mapping(uint256 => bool) public usedNullifiers;

    // guardian storage
    mapping(address => address[]) private _guardianList;
    mapping(address => mapping(address => bool)) public isGuardian;

    // approval key = keccak256(agentOwner, newOwner, nonce) — nonce increment auto-invalidates stale votes
    mapping(bytes32 => mapping(address => bool)) public guardianVotes;
    mapping(bytes32 => uint8) public approvalCounts;

    // External contracts
    IUltraVerifier public immutable verifier;
    IPersonhoodVerifier public immutable defaultPersonhood;
    IPersonhoodRegistry public immutable personhoodRegistry;
    IDKIMRegistry public immutable dkimRegistry;

    // Default timelock — set per deployment, immutable.
    // Acts as both the protocol default AND the minimum any user can pick.
    uint64 public immutable defaultTimelockBlocks;

    constructor(
        address _verifier,
        address _defaultPersonhood,
        address _personhoodRegistry,
        address _dkimRegistry,
        uint64 _defaultTimelockBlocks
    ) {
        if (
            _verifier == address(0) ||
            _defaultPersonhood == address(0) ||
            _personhoodRegistry == address(0) ||
            _dkimRegistry == address(0)
        ) revert ZeroAddress();
        if (_defaultTimelockBlocks == 0) revert TimelockTooShort();
        verifier = IUltraVerifier(_verifier);
        defaultPersonhood = IPersonhoodVerifier(_defaultPersonhood);
        personhoodRegistry = IPersonhoodRegistry(_personhoodRegistry);
        dkimRegistry = IDKIMRegistry(_dkimRegistry);
        defaultTimelockBlocks = _defaultTimelockBlocks;
    }

    /// @notice Register an agent recovery config using the protocol's default timelock.
    /// @param emailHash SHA256 of the owner's recovery email address.
    function register(bytes32 emailHash) external {
        _register(emailHash, defaultTimelockBlocks, address(defaultPersonhood));
    }

    /// @notice Register an agent with a longer-than-default timelock.
    /// @param emailHash      SHA256 of the owner's recovery email address.
    /// @param timelockBlocks Cancel window in blocks; must be ≥ defaultTimelockBlocks.
    function registerWithCustomTimelock(bytes32 emailHash, uint64 timelockBlocks) external {
        if (timelockBlocks < defaultTimelockBlocks) revert TimelockTooShort();
        _register(emailHash, timelockBlocks, address(defaultPersonhood));
    }

    /// @notice Register choosing a specific personhood adapter. The adapter must
    ///         be the protocol default or currently approved in PersonhoodRegistry.
    function registerWith(
        bytes32 emailHash,
        address adapter,
        uint64 timelockBlocks
    ) external {
        if (timelockBlocks < defaultTimelockBlocks) revert TimelockTooShort();
        _requireApprovedAdapter(adapter);
        _register(emailHash, timelockBlocks, adapter);
    }

    /// @dev The default adapter is always valid (a deploy-time trust anchor,
    ///      like the verifier); any other must be currently approved.
    function _requireApprovedAdapter(address adapter) internal view {
        if (adapter == address(0)) revert ZeroAddress();
        if (
            adapter != address(defaultPersonhood) &&
            !personhoodRegistry.isApproved(adapter)
        ) revert AdapterNotApproved();
    }

    function _register(
        bytes32 emailHash,
        uint64 timelockBlocks,
        address adapter
    ) internal {
        if (records[msg.sender].owner != address(0)) revert AlreadyRegistered();
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
            pendingRecoveryMode: RecoveryMode.None,
            personhoodAdapter: adapter,
            pendingPersonhoodNullifier: 0
        });

        emit AgentRegistered(msg.sender, emailHash);
    }

    // Mode 1: EmailPersonhood recovery
    /// @notice Initiate recovery: DKIM email proof + a personhood proof.
    /// @param personhoodNullifier Per-identity dedup primitive (tracked here).
    /// @param personhoodProof     Opaque blob the configured IPersonhoodVerifier decodes.
    function initiateRecovery(
        address agentOwner,
        address newOwner,
        bytes calldata emailProof,
        bytes32[] calldata emailPublicInputs,
        uint256 personhoodNullifier,
        bytes calldata personhoodProof
    ) external {
        AgentRecord storage record = records[agentOwner];
        if (record.owner == address(0)) revert NotRegistered();
        if (record.pendingOwner != address(0)) revert RecoveryPending();
        if (newOwner == address(0)) revert ZeroAddress();
        if (usedNullifiers[personhoodNullifier]) revert NullifierAlreadyUsed();

        // Bind the email proof's public inputs to this recovery before checking the proof.
        // The circuit guarantees the inputs reflect a real DKIM-signed email; here we
        // assert those inputs target the correct agent, new owner, and nonce.
        if (emailPublicInputs.length != PUB_INPUTS_LENGTH) revert InvalidProof();
        if (_extractEmailHash(emailPublicInputs) != record.emailHash) revert InvalidProof();
        if (uint256(emailPublicInputs[NEW_KEY_OFFSET]) != uint256(uint160(newOwner))) revert InvalidProof();
        if (uint256(emailPublicInputs[NONCE_OFFSET]) != record.nonce) revert InvalidProof();

        // Pin the DKIM key to a known-good entry in the registry. Without this,
        // an attacker could sign with their own RSA key and pass the proof check.
        if (!dkimRegistry.isKnown(_hashDkimKey(emailPublicInputs)))
            revert InvalidProof();

        // ── Effects (before external calls — checks-effects-interactions, S5) ──
        // Reserve the nullifier and stage the recovery now, so even a reentrant
        // verifier/personhood adapter sees the consumed state. The nullifier
        // stays reserved until executeRecovery finalizes it or cancelRecovery
        // (S4) releases it.
        usedNullifiers[personhoodNullifier] = true;
        record.pendingPersonhoodNullifier = personhoodNullifier;
        record.pendingOwner = newOwner;
        record.recoveryInitBlock = uint64(block.number);
        record.pendingRecoveryMode = RecoveryMode.EmailPersonhood;

        // ── Interactions ──────────────────────────────────────────────────────
        if (!verifier.verify(emailProof, emailPublicInputs))
            revert InvalidProof();

        // signal binds agentOwner, newOwner, and nonce — prevents replay
        uint256 signal = uint256(
            keccak256(abi.encodePacked(agentOwner, newOwner, record.nonce))
        );
        // Dispatch to the agent's chosen personhood adapter. The default is
        // always valid; a non-default must still be approved (revocation of a
        // compromised adapter blocks recovery, mirroring DKIM revocation).
        address adapter = record.personhoodAdapter;
        if (
            adapter != address(defaultPersonhood) &&
            !personhoodRegistry.isApproved(adapter)
        ) revert AdapterNotApproved();
        IPersonhoodVerifier(adapter).verifyPersonhood(
            signal,
            personhoodNullifier,
            personhoodProof
        );

        emit RecoveryInitiated(
            agentOwner,
            newOwner,
            uint64(block.number) + record.timelockBlocks,
            RecoveryMode.EmailPersonhood
        );
    }

    //  Mode 2: Backup wallet recovery

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

    // Mode 3: Social / guardian recovery

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

        // S4: release the personhood nullifier staged by an EmailPersonhood
        // recovery. Cancel is owner-only, so only the legitimate owner can
        // trigger this release — an attacker cannot abuse it to recycle a
        // nullifier. Without this, a single cancelled attempt would burn the
        // identity's nullifier forever and brick EmailPersonhood recovery for
        // it. Backup/Social leave pendingPersonhoodNullifier == 0.
        if (record.pendingPersonhoodNullifier != 0) {
            delete usedNullifiers[record.pendingPersonhoodNullifier];
            record.pendingPersonhoodNullifier = 0;
        }

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
        // Recovery finalized: drop the staged pointer but KEEP
        // usedNullifiers[...] = true so the nullifier stays permanently spent.
        record.pendingPersonhoodNullifier = 0;
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

    /// @dev Reconstruct the SHA-256 email hash from the 32 byte-per-field public-input slots.
    function _extractEmailHash(
        bytes32[] calldata pubInputs
    ) internal pure returns (bytes32) {
        bytes32 result;
        for (uint256 i = 0; i < 32; i++) {
            uint256 b = uint256(pubInputs[EMAIL_HASH_OFFSET + i]) & 0xff;
            result |= bytes32(b << ((31 - i) * 8));
        }
        return result;
    }

    /// @dev Hash the 18 RSA-modulus limbs at the start of the public-inputs blob.
    ///      This is the key Spectre uses to look up trust in DKIMRegistry.
    ///      Off-chain key publishers MUST hash limbs the same way.
    function _hashDkimKey(
        bytes32[] calldata pubInputs
    ) internal pure returns (bytes32 result) {
        assembly {
            // pubInputs[0..17] starts at calldata offset pubInputs.offset.
            // 18 slots × 32 bytes = 0x240 bytes.
            let ptr := mload(0x40)
            calldatacopy(ptr, pubInputs.offset, 0x240)
            result := keccak256(ptr, 0x240)
        }
    }
}
