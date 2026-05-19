// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {SpectreRegistry} from "./SpectreRegistry.sol";

/// @title  SpectreAccount
/// @notice Smart account whose controller is read from SpectreRegistry, not
///         stored locally — so a Spectre recovery actually binds over funds.
/// @dev    agentId = registry registrant (permanent handle). controller() =
///         registry.getRecord(agentId).owner; recovery rotates it, this
///         account follows next block. Freeze: while a recovery is pending,
///         execute() reverts (derived from registry state, not stored) — stops
///         a thief with the current key draining during the timelock. Binary,
///         no carve-outs. Preview primitive; ERC-4337/7579 module is next.
contract SpectreAccount {
    /// @notice The Spectre registry this account derives its controller from.
    SpectreRegistry public immutable registry;

    /// @notice The permanent identity handle in the registry (the address that
    ///         called `register()`). Controller = registry record's `owner`.
    address public immutable agentId;

    event Executed(address indexed target, uint256 value, bytes data);

    /// @notice Caller is not the current controller for `agentId`.
    error NotController();
    /// @notice No agent is registered under `agentId` (controller is zero).
    error AgentNotRegistered();
    /// @notice A recovery is pending for `agentId`; the account is frozen.
    error AccountFrozen();
    /// @notice Constructor arguments must be non-zero.
    error ZeroArgument();

    constructor(SpectreRegistry _registry, address _agentId) {
        if (address(_registry) == address(0) || _agentId == address(0)) {
            revert ZeroArgument();
        }
        registry = _registry;
        agentId = _agentId;
    }

    /// @notice The address currently authorized to control this account.
    /// @dev    Reads through to the registry; rotates when recovery executes.
    function controller() public view returns (address) {
        return registry.getRecord(agentId).owner;
    }

    /// @notice True while a recovery is staged for `agentId` (account frozen).
    function isRecoveryPending() public view returns (bool pending) {
        (pending, , , ) = registry.recoveryStatus(agentId);
    }

    modifier onlyController() {
        address c = controller();
        if (c == address(0)) revert AgentNotRegistered();
        if (msg.sender != c) revert NotController();
        _;
    }

    /// @notice Execute a call from the account. Reverts while a recovery is
    ///         pending; bubbles the target's revert data on failure.
    function execute(
        address target,
        uint256 value,
        bytes calldata data
    ) external onlyController returns (bytes memory ret) {
        if (isRecoveryPending()) revert AccountFrozen();

        bool ok;
        (ok, ret) = target.call{value: value}(data);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }

        emit Executed(target, value, data);
        return ret;
    }

    /// @notice Accept plain ETH transfers.
    receive() external payable {}
}
