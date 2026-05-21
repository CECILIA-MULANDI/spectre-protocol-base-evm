// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/// @title  PersonhoodRegistry
/// @notice Allowlist of approved IPersonhoodVerifier adapters. SpectreRegistry
///         only lets an agent register/recover with an adapter that `isApproved`
///         here — so adding a new personhood scheme (zkpassport, etc.) is a
///         governed propose/confirm, not a code change.
/// @dev    Same shape and trust model as DKIMRegistry, keyed by adapter address.
///         propose (updater) → timelock → confirm (anyone) → approved;
///         revoke (updater, instant); two-step updater transfer.
contract PersonhoodRegistry {
    error NotUpdater();
    error AlreadyApproved();
    error AlreadyProposed();
    error NoProposal();
    error TimelockNotElapsed();
    error NothingToRevoke();
    error ZeroAddress();
    error InvalidTimelock();
    error NotPendingUpdater();
    error NoPendingTransfer();

    event AdapterProposed(address indexed adapter, uint256 confirmAfter);
    event AdapterConfirmed(address indexed adapter);
    event AdapterRevoked(address indexed adapter);
    event UpdaterTransferStarted(address indexed current, address indexed pending);
    event UpdaterTransferCancelled(address indexed current, address indexed pending);
    event UpdaterTransferred(address indexed previous, address indexed next);

    address public updater;
    address public pendingUpdater;
    uint256 public immutable proposalTimelock;

    /// @dev Approved adapter set. `true` means it may back recoveries.
    mapping(address => bool) public isApproved;
    /// @dev Pending proposals: earliest timestamp `confirm` may run. Non-zero = in-flight.
    mapping(address => uint256) public confirmAfter;

    constructor(address _updater, uint256 _proposalTimelock) {
        if (_updater == address(0)) revert ZeroAddress();
        if (_proposalTimelock == 0) revert InvalidTimelock();
        updater = _updater;
        proposalTimelock = _proposalTimelock;
    }

    modifier onlyUpdater() {
        if (msg.sender != updater) revert NotUpdater();
        _;
    }

    /// @notice Propose a new adapter. Starts the proposal timelock.
    function propose(address adapter) external onlyUpdater {
        if (adapter == address(0)) revert ZeroAddress();
        if (isApproved[adapter]) revert AlreadyApproved();
        if (confirmAfter[adapter] != 0) revert AlreadyProposed();
        uint256 ready = block.timestamp + proposalTimelock;
        confirmAfter[adapter] = ready;
        emit AdapterProposed(adapter, ready);
    }

    /// @notice Promote a proposed adapter to approved. Anyone, once the timelock elapses.
    function confirm(address adapter) external {
        uint256 ready = confirmAfter[adapter];
        if (ready == 0) revert NoProposal();
        if (block.timestamp < ready) revert TimelockNotElapsed();
        isApproved[adapter] = true;
        delete confirmAfter[adapter];
        emit AdapterConfirmed(adapter);
    }

    /// @notice Instantly revoke an adapter — approved or pending. Updater only.
    function revoke(address adapter) external onlyUpdater {
        bool wasApproved = isApproved[adapter];
        bool wasProposed = confirmAfter[adapter] != 0;
        if (!wasApproved && !wasProposed) revert NothingToRevoke();
        if (wasApproved) delete isApproved[adapter];
        if (wasProposed) delete confirmAfter[adapter];
        emit AdapterRevoked(adapter);
    }

    /// @notice Begin transferring the updater role (step 1 of 2).
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

    /// @notice Complete the updater transfer (step 2 of 2). Called by the pending updater.
    function acceptUpdater() external {
        if (msg.sender != pendingUpdater) revert NotPendingUpdater();
        emit UpdaterTransferred(updater, pendingUpdater);
        updater = pendingUpdater;
        pendingUpdater = address(0);
    }
}
