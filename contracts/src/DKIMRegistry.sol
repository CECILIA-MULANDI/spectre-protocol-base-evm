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

    event KeyProposed(bytes32 indexed keyHash, uint256 confirmAfter);
    event KeyConfirmed(bytes32 indexed keyHash);
    event KeyRevoked(bytes32 indexed keyHash);
    event UpdaterTransferred(address indexed previous, address indexed next);

    address public updater;
    uint256 public immutable proposalTimelock;

    /// @dev Trusted-key set. `true` means the key may be used for recovery.
    mapping(bytes32 => bool) public isKnown;

    /// @dev Pending proposals. Stores `block.timestamp + proposalTimelock`
    ///      (i.e. the earliest block-timestamp at which `confirm` may run).
    ///      A non-zero value means a proposal is in-flight.
    mapping(bytes32 => uint256) public confirmAfter;

    constructor(address _updater, uint256 _proposalTimelock) {
        if (_updater == address(0)) revert ZeroAddress();
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

    /// @notice Transfer the updater role. Use to atomically move from an EOA
    ///         to a multisig once one is provisioned.
    /// @dev    Instant — assumes the caller (current updater) verifies the
    ///         destination address out-of-band before calling.
    function transferUpdater(address newUpdater) external onlyUpdater {
        if (newUpdater == address(0)) revert ZeroAddress();
        emit UpdaterTransferred(updater, newUpdater);
        updater = newUpdater;
    }
}
