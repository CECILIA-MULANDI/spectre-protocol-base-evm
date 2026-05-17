// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/// @title DKIMRegistry
/// @notice Registry of trusted DKIM RSA-key hashes for Spectre's email recovery.
///
/// The registry stores `keccak256(modulus_limbs[18])` — i.e. a hash over the
/// 18 × 120-bit limbs the Noir circuit uses to represent an RSA-2048 modulus.
/// SpectreRegistry consults `isKnown(keyHash)` after binding the email proof,
/// rejecting any recovery whose proof was signed by a key not in the registry.
///
/// Workflow:
///   1. Updater calls `propose(keyHash)`             → starts proposalTimelock
///   2. After timelock elapses, anyone calls `confirm(keyHash)` → key becomes trusted
///   3. Updater can call `revoke(keyHash)` instantly → key removed (compromise response)
///
/// The two-step propose/confirm window gives observers time to detect a
/// malicious or buggy proposal before it goes live.
contract DKIMRegistry {
    error NotUpdater();
    error AlreadyKnown();
    error AlreadyProposed();
    error NoProposal();
    error TimelockNotElapsed();
    error NothingToRevoke();
    error ZeroAddress();
    error InvalidTimelock();
    error NotPendingUpdater();
    error NoPendingTransfer();

    event KeyProposed(bytes32 indexed keyHash, uint256 confirmAfter);
    event KeyConfirmed(bytes32 indexed keyHash);
    event KeyRevoked(bytes32 indexed keyHash);
    event UpdaterTransferStarted(address indexed current, address indexed pending);
    event UpdaterTransferCancelled(address indexed current, address indexed pending);
    event UpdaterTransferred(address indexed previous, address indexed next);

    address public updater;
    /// @dev Proposed next updater, pending its own acceptance. Zero when no
    ///      transfer is in flight. Two-step transfer (S6): a mistyped address
    ///      can no longer brick the role, because only an address that can
    ///      itself call `acceptUpdater` ever becomes the updater.
    address public pendingUpdater;
    uint256 public immutable proposalTimelock;

    /// @dev Trusted-key set. `true` means the key may be used for recovery.
    mapping(bytes32 => bool) public isKnown;

    /// @dev Pending proposals. Stores `block.timestamp + proposalTimelock`
    ///      (i.e. the earliest block-timestamp at which `confirm` may run).
    ///      A non-zero value means a proposal is in-flight.
    mapping(bytes32 => uint256) public confirmAfter;

    constructor(address _updater, uint256 _proposalTimelock) {
        if (_updater == address(0)) revert ZeroAddress();
        // S7: a zero timelock would let propose()+confirm() run in the same
        // block, silently disabling the observation window the registry exists
        // to provide.
        if (_proposalTimelock == 0) revert InvalidTimelock();
        updater = _updater;
        proposalTimelock = _proposalTimelock;
    }

    modifier onlyUpdater() {
        if (msg.sender != updater) revert NotUpdater();
        _;
    }

    /// @notice Propose a new trusted DKIM key. Starts the proposal timelock.
    function propose(bytes32 keyHash) external onlyUpdater {
        if (isKnown[keyHash]) revert AlreadyKnown();
        if (confirmAfter[keyHash] != 0) revert AlreadyProposed();
        uint256 ready = block.timestamp + proposalTimelock;
        confirmAfter[keyHash] = ready;
        emit KeyProposed(keyHash, ready);
    }

    /// @notice Promote a proposed key to trusted. Callable by anyone once the
    ///         timelock elapses — keeps the path live even if the updater is gone.
    function confirm(bytes32 keyHash) external {
        uint256 ready = confirmAfter[keyHash];
        if (ready == 0) revert NoProposal();
        if (block.timestamp < ready) revert TimelockNotElapsed();
        isKnown[keyHash] = true;
        delete confirmAfter[keyHash];
        emit KeyConfirmed(keyHash);
    }

    /// @notice Instantly revoke a key — either trusted or pending. Updater only.
    ///         No timelock: revocation is the response to a known compromise.
    function revoke(bytes32 keyHash) external onlyUpdater {
        bool wasKnown = isKnown[keyHash];
        bool wasProposed = confirmAfter[keyHash] != 0;
        if (!wasKnown && !wasProposed) revert NothingToRevoke();
        if (wasKnown) delete isKnown[keyHash];
        if (wasProposed) delete confirmAfter[keyHash];
        emit KeyRevoked(keyHash);
    }

    /// @notice Begin transferring the updater role (step 1 of 2). Use to move
    ///         from an EOA to a multisig once one is provisioned. The transfer
    ///         only completes when `newUpdater` calls `acceptUpdater`, so a
    ///         mistyped or uncontrolled address cannot brick key management.
    /// @dev    Overwrites any in-flight proposal.
    function transferUpdater(address newUpdater) external onlyUpdater {
        if (newUpdater == address(0)) revert ZeroAddress();
        pendingUpdater = newUpdater;
        emit UpdaterTransferStarted(updater, newUpdater);
    }

    /// @notice Abort an in-flight updater transfer. Updater only.
    function cancelUpdaterTransfer() external onlyUpdater {
        if (pendingUpdater == address(0)) revert NoPendingTransfer();
        emit UpdaterTransferCancelled(updater, pendingUpdater);
        pendingUpdater = address(0);
    }

    /// @notice Complete the updater transfer (step 2 of 2). Must be called by
    ///         the pending updater, proving it controls that address.
    function acceptUpdater() external {
        if (msg.sender != pendingUpdater) revert NotPendingUpdater();
        emit UpdaterTransferred(updater, pendingUpdater);
        updater = pendingUpdater;
        pendingUpdater = address(0);
    }
}
