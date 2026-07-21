// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {IPersonhoodVerifier} from "./IPersonhoodVerifier.sol";
import {IRootVerifier, IVerifierHelper} from "./vendored/IRootVerifier.sol";
import {ProofVerificationParams, BoundData} from "./vendored/ZKPassportTypes.sol";

/// @title  ZKPassportAdapter
/// @notice IPersonhoodVerifier adapter backed by ZK Passport's RootVerifier. Binds each
///         recovery to a specific (agentOwner, newOwner, nonce) tuple through ZK Passport's
///         SDK `bind()` fields so the proof cannot be replayed for a different action.
/// @dev    Off-chain SDK expectations, in strict sync with this contract:
///           - bind("user_address", agentOwner)   -> BoundData.senderAddress
///           - bind("chain", <chain-name>)        -> BoundData.chainId  (must equal block.chainid)
///           - bind("custom_data", "0x" || hex(abi.encode(address newOwner, uint256 nonce)))
///                                                -> BoundData.customData
///
///         The domain and scope pinned in the constructor also gate the proof. ZK Passport's
///         uniqueIdentifier is deterministic per (passport, domain, scope); fixing both across
///         all Spectre recoveries lets SpectreRegistry.usedNullifiers use it as a stable
///         per-passport nullifier.
///
///         Trust model: the ICAO CSCA / issuer root set is managed by ZK Passport's own
///         registry contracts, not by Spectre. This adapter inherits their root governance
///         the same way Spectre's DKIM path inherits Google's DKIM key rotation.
///
///         Operational dependency: RootVerifier is pausable by ZK Passport's admin. If they
///         pause, verifyPersonhood reverts (internally, inside RootVerifier.verify due to
///         whenNotPaused). Backup and Guardian recovery modes are unaffected.
contract ZKPassportAdapter is IPersonhoodVerifier {
    error ZeroAddress();
    error EmptyDomain();
    error EmptyScope();
    error InvalidProof();
    error WrongChain();
    error SignalMismatch();
    error NullifierMismatch();
    error WrongScope();
    error MalformedCustomData();

    IRootVerifier public immutable verifier;
    bytes32 public immutable expectedDomainHash;
    bytes32 public immutable expectedScopeHash;

    /// @param _verifier         ZK Passport's RootVerifier deployment on this chain.
    /// @param _expectedDomain   Domain string ZK Passport proofs must commit to (SDK-side
    ///                          "scope"; typically the DNS name serving the recovery UI).
    /// @param _expectedScope    Scope string ZK Passport proofs must commit to (SDK-side
    ///                          "subscope"; Spectre uses a protocol-wide constant so the
    ///                          returned uniqueIdentifier is stable across all recoveries).
    constructor(IRootVerifier _verifier, string memory _expectedDomain, string memory _expectedScope) {
        if (address(_verifier) == address(0)) revert ZeroAddress();
        if (bytes(_expectedDomain).length == 0) revert EmptyDomain();
        if (bytes(_expectedScope).length == 0) revert EmptyScope();
        verifier = _verifier;
        expectedDomainHash = keccak256(bytes(_expectedDomain));
        expectedScopeHash = keccak256(bytes(_expectedScope));
    }

    /// @inheritdoc IPersonhoodVerifier
    /// @dev  Revert reasons:
    ///         InvalidProof         - RootVerifier said the SNARK proof is invalid.
    ///         WrongChain           - Proof-committed chainId does not equal block.chainid.
    ///         SignalMismatch       - Reconstructed (agentOwner, newOwner, nonce) hash does
    ///                                not equal the signal SpectreRegistry passed in.
    ///         NullifierMismatch    - uniqueIdentifier does not equal the nullifierHash
    ///                                SpectreRegistry passed in.
    ///         WrongScope           - Proof-committed domain or scope does not equal what
    ///                                the adapter was deployed with.
    ///         MalformedCustomData  - customData is not "0x"-prefixed hex, or does not
    ///                                decode into exactly abi.encode(address, uint256).
    function verifyPersonhood(uint256 signal, uint256 nullifierHash, bytes calldata proofData) external view override {
        ProofVerificationParams memory params = abi.decode(proofData, (ProofVerificationParams));

        (bool valid, bytes32 uniqueIdentifier, IVerifierHelper helper) = verifier.verify(params);
        if (!valid) revert InvalidProof();

        BoundData memory bd = helper.getBoundData(params.committedInputs);

        if (bd.chainId != block.chainid) revert WrongChain();

        bytes memory decoded = _hexStringToBytes(bd.customData);
        if (decoded.length != 64) revert MalformedCustomData();
        (address newOwner, uint256 nonce) = abi.decode(decoded, (address, uint256));

        uint256 reconstructed = uint256(keccak256(abi.encode(bd.senderAddress, newOwner, nonce)));
        if (reconstructed != signal) revert SignalMismatch();

        if (uint256(uniqueIdentifier) != nullifierHash) revert NullifierMismatch();

        if (
            keccak256(bytes(params.serviceConfig.domain)) != expectedDomainHash
                || keccak256(bytes(params.serviceConfig.scope)) != expectedScopeHash
        ) revert WrongScope();
    }

    /// @dev Decodes a "0x"-prefixed hex string into raw bytes. Reverts MalformedCustomData
    ///      on missing prefix, odd length, or non-hex characters.
    function _hexStringToBytes(string memory s) internal pure returns (bytes memory result) {
        bytes memory ss = bytes(s);
        if (ss.length < 2 || ss[0] != "0" || ss[1] != "x") revert MalformedCustomData();
        uint256 hexLen = ss.length - 2;
        if (hexLen % 2 != 0) revert MalformedCustomData();
        uint256 byteLen = hexLen / 2;
        result = new bytes(byteLen);
        for (uint256 i = 0; i < byteLen; i++) {
            uint8 hi = _fromHexChar(uint8(ss[2 + i * 2]));
            uint8 lo = _fromHexChar(uint8(ss[3 + i * 2]));
            result[i] = bytes1(hi * 16 + lo);
        }
    }

    /// @dev Returns the integer value of an ASCII hex character. Reverts MalformedCustomData
    ///      on non-hex input.
    function _fromHexChar(uint8 c) internal pure returns (uint8) {
        // '0'-'9' (48-57), 'a'-'f' (97-102), 'A'-'F' (65-70)
        if (c >= 48 && c <= 57) return c - 48;
        if (c >= 97 && c <= 102) return c - 87;
        if (c >= 65 && c <= 70) return c - 55;
        revert MalformedCustomData();
    }
}
