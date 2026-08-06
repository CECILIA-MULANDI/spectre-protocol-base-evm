// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "forge-std/Test.sol";
import {ZKPassportAdapter} from "../src/ZKPassportAdapter.sol";
import {IRootVerifier, IVerifierHelper} from "../src/vendored/IRootVerifier.sol";
import {
    ProofVerificationParams,
    ProofVerificationData,
    ServiceConfig,
    BoundData
} from "../src/vendored/ZKPassportTypes.sol";

/// @dev Configurable stub for ZK Passport's RootVerifier. Implements IRootVerifier so it
///      can be passed to the adapter constructor. Returns whatever the test previously set.
contract MockZKPassportRootVerifier is IRootVerifier {
    bool public valid;
    bytes32 public uniqueId;
    IVerifierHelper public helperRef;

    function set(bool _valid, bytes32 _uniqueId, IVerifierHelper _helper) external {
        valid = _valid;
        uniqueId = _uniqueId;
        helperRef = _helper;
    }

    function verify(ProofVerificationParams calldata) external view override returns (bool, bytes32, IVerifierHelper) {
        return (valid, uniqueId, helperRef);
    }
}

/// @dev Stub helper. NOT declared as `IVerifierHelper` on purpose: the interface's
///      `getBoundData` is `pure` (matching ZK Passport's source) and we need to store test
///      configuration in state, which requires `view`. Since Solidity does not allow
///      loosening interface mutability, we implement the same ABI signature without formal
///      inheritance and cast the address to `IVerifierHelper` at the call site. EVM dispatch
///      does not care about declared mutability.
contract MockZKPassportVerifierHelper {
    BoundData private _bd;

    function set(address senderAddress, uint256 chainId, string calldata customData) external {
        _bd = BoundData({senderAddress: senderAddress, chainId: chainId, customData: customData});
    }

    function getBoundData(bytes calldata) external view returns (BoundData memory) {
        return _bd;
    }
}

contract ZKPassportAdapterTest is Test {
    ZKPassportAdapter adapter;
    MockZKPassportRootVerifier mockVerifier;
    MockZKPassportVerifierHelper mockHelper;

    string constant EXPECTED_DOMAIN = "spectre-test.example";
    string constant EXPECTED_SCOPE = "spectre-recovery-v1";

    address constant AGENT_OWNER = address(0x1111);
    address constant NEW_OWNER = address(0x2222);
    uint256 constant NONCE = 42;
    bytes32 constant UNIQUE_ID = bytes32(uint256(0xBEEFCAFE));

    function setUp() public {
        mockVerifier = new MockZKPassportRootVerifier();
        mockHelper = new MockZKPassportVerifierHelper();
        adapter = new ZKPassportAdapter(IRootVerifier(address(mockVerifier)), EXPECTED_DOMAIN, EXPECTED_SCOPE);
    }

    // ==================== Constructor tests ====================

    function test_constructor_stores_immutables() public view {
        assertEq(address(adapter.verifier()), address(mockVerifier));
        assertEq(adapter.expectedDomainHash(), keccak256(bytes(EXPECTED_DOMAIN)));
        assertEq(adapter.expectedScopeHash(), keccak256(bytes(EXPECTED_SCOPE)));
    }

    function test_constructor_revert_zero_verifier() public {
        vm.expectRevert(ZKPassportAdapter.ZeroAddress.selector);
        new ZKPassportAdapter(IRootVerifier(address(0)), EXPECTED_DOMAIN, EXPECTED_SCOPE);
    }

    function test_constructor_revert_empty_domain() public {
        vm.expectRevert(ZKPassportAdapter.EmptyDomain.selector);
        new ZKPassportAdapter(IRootVerifier(address(mockVerifier)), "", EXPECTED_SCOPE);
    }

    function test_constructor_revert_empty_scope() public {
        vm.expectRevert(ZKPassportAdapter.EmptyScope.selector);
        new ZKPassportAdapter(IRootVerifier(address(mockVerifier)), EXPECTED_DOMAIN, "");
    }

    // ==================== verifyPersonhood happy path ====================

    function test_verify_happy_path() public {
        _configureHappy();
        adapter.verifyPersonhood(_signal(), uint256(UNIQUE_ID), _proofData(EXPECTED_DOMAIN, EXPECTED_SCOPE));
    }

    // ==================== verifyPersonhood revert paths ====================

    function test_verify_revert_invalid_proof() public {
        _configureHappy();
        mockVerifier.set(false, UNIQUE_ID, IVerifierHelper(address(mockHelper)));

        vm.expectRevert(ZKPassportAdapter.InvalidProof.selector);
        adapter.verifyPersonhood(_signal(), uint256(UNIQUE_ID), _proofData(EXPECTED_DOMAIN, EXPECTED_SCOPE));
    }

    function test_verify_revert_wrong_chain() public {
        _configureHappy();
        // reconfigure helper with a chainId that isn't ours
        mockHelper.set(AGENT_OWNER, block.chainid + 1, _customData(NEW_OWNER, NONCE));

        vm.expectRevert(ZKPassportAdapter.WrongChain.selector);
        adapter.verifyPersonhood(_signal(), uint256(UNIQUE_ID), _proofData(EXPECTED_DOMAIN, EXPECTED_SCOPE));
    }

    function test_verify_revert_signal_mismatch_wrong_agent_owner() public {
        _configureHappy();
        // helper says senderAddress is a different agentOwner, so reconstructed signal won't match
        mockHelper.set(address(0xDEAD), block.chainid, _customData(NEW_OWNER, NONCE));

        vm.expectRevert(ZKPassportAdapter.SignalMismatch.selector);
        adapter.verifyPersonhood(_signal(), uint256(UNIQUE_ID), _proofData(EXPECTED_DOMAIN, EXPECTED_SCOPE));
    }

    function test_verify_revert_signal_mismatch_wrong_new_owner() public {
        _configureHappy();
        // customData binds to a DIFFERENT newOwner than the caller-supplied signal expects
        mockHelper.set(AGENT_OWNER, block.chainid, _customData(address(0xDEAD), NONCE));

        vm.expectRevert(ZKPassportAdapter.SignalMismatch.selector);
        adapter.verifyPersonhood(_signal(), uint256(UNIQUE_ID), _proofData(EXPECTED_DOMAIN, EXPECTED_SCOPE));
    }

    function test_verify_revert_signal_mismatch_wrong_nonce() public {
        _configureHappy();
        mockHelper.set(AGENT_OWNER, block.chainid, _customData(NEW_OWNER, NONCE + 1));

        vm.expectRevert(ZKPassportAdapter.SignalMismatch.selector);
        adapter.verifyPersonhood(_signal(), uint256(UNIQUE_ID), _proofData(EXPECTED_DOMAIN, EXPECTED_SCOPE));
    }

    function test_verify_revert_nullifier_mismatch() public {
        _configureHappy();

        // caller says nullifier should be X, but verifier returned UNIQUE_ID
        vm.expectRevert(ZKPassportAdapter.NullifierMismatch.selector);
        adapter.verifyPersonhood(_signal(), uint256(UNIQUE_ID) + 1, _proofData(EXPECTED_DOMAIN, EXPECTED_SCOPE));
    }

    function test_verify_revert_wrong_scope_bad_domain() public {
        _configureHappy();

        vm.expectRevert(ZKPassportAdapter.WrongScope.selector);
        adapter.verifyPersonhood(_signal(), uint256(UNIQUE_ID), _proofData("other-domain.example", EXPECTED_SCOPE));
    }

    function test_verify_revert_wrong_scope_bad_scope() public {
        _configureHappy();

        vm.expectRevert(ZKPassportAdapter.WrongScope.selector);
        adapter.verifyPersonhood(_signal(), uint256(UNIQUE_ID), _proofData(EXPECTED_DOMAIN, "spectre-recovery-v2"));
    }

    function test_verify_revert_malformed_no_0x_prefix() public {
        _configureHappy();
        // customData missing the "0x" prefix
        bytes memory payload = abi.encode(NEW_OWNER, NONCE);
        mockHelper.set(AGENT_OWNER, block.chainid, _hexNoPrefix(payload));

        vm.expectRevert(ZKPassportAdapter.MalformedCustomData.selector);
        adapter.verifyPersonhood(_signal(), uint256(UNIQUE_ID), _proofData(EXPECTED_DOMAIN, EXPECTED_SCOPE));
    }

    function test_verify_revert_malformed_odd_length() public {
        _configureHappy();
        mockHelper.set(AGENT_OWNER, block.chainid, "0xabc");

        vm.expectRevert(ZKPassportAdapter.MalformedCustomData.selector);
        adapter.verifyPersonhood(_signal(), uint256(UNIQUE_ID), _proofData(EXPECTED_DOMAIN, EXPECTED_SCOPE));
    }

    function test_verify_revert_malformed_non_hex_char() public {
        _configureHappy();
        // 128 chars after 0x, all valid hex except the last which is 'z'
        string memory bad = string(
            abi.encodePacked(
                "0x",
                "00000000000000000000000000000000000000000000000000000000000000",
                "00",
                "0000000000000000000000000000000000000000000000000000000000000",
                "0z"
            )
        );
        mockHelper.set(AGENT_OWNER, block.chainid, bad);

        vm.expectRevert(ZKPassportAdapter.MalformedCustomData.selector);
        adapter.verifyPersonhood(_signal(), uint256(UNIQUE_ID), _proofData(EXPECTED_DOMAIN, EXPECTED_SCOPE));
    }

    function test_verify_revert_malformed_wrong_byte_length() public {
        _configureHappy();
        // valid hex but decodes to 32 bytes instead of the required 64
        mockHelper.set(AGENT_OWNER, block.chainid, "0x0000000000000000000000000000000000000000000000000000000000000000");

        vm.expectRevert(ZKPassportAdapter.MalformedCustomData.selector);
        adapter.verifyPersonhood(_signal(), uint256(UNIQUE_ID), _proofData(EXPECTED_DOMAIN, EXPECTED_SCOPE));
    }

    // ==================== Helpers ====================

    /// @dev Sets up the mocks with all inputs matching a valid recovery attempt.
    function _configureHappy() internal {
        mockVerifier.set(true, UNIQUE_ID, IVerifierHelper(address(mockHelper)));
        mockHelper.set(AGENT_OWNER, block.chainid, _customData(NEW_OWNER, NONCE));
    }

    /// @dev Builds the proofData bytes the adapter decodes into ProofVerificationParams.
    ///      Only serviceConfig.domain and serviceConfig.scope are inspected by the adapter;
    ///      other fields are placeholders because the verifier is fully mocked.
    function _proofData(string memory domain, string memory scope) internal pure returns (bytes memory) {
        bytes32[] memory publicInputs = new bytes32[](0);
        ProofVerificationData memory pvd =
            ProofVerificationData({vkeyHash: bytes32(0), proof: bytes(""), publicInputs: publicInputs});
        ServiceConfig memory sc =
            ServiceConfig({validityPeriodInSeconds: 3600, domain: domain, scope: scope, devMode: false});
        ProofVerificationParams memory params = ProofVerificationParams({
            version: bytes32(0), proofVerificationData: pvd, committedInputs: bytes(""), serviceConfig: sc
        });
        return abi.encode(params);
    }

    /// @dev The signal SpectreRegistry passes to the adapter for the happy-path actors.
    function _signal() internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(AGENT_OWNER, NEW_OWNER, NONCE)));
    }

    /// @dev Builds the customData string the adapter expects: "0x" || hex(abi.encode(newOwner, nonce)).
    function _customData(address newOwner, uint256 nonce) internal pure returns (string memory) {
        return string(abi.encodePacked("0x", _toHexString(abi.encode(newOwner, nonce))));
    }

    /// @dev Same encoding as `_customData` but WITHOUT the "0x" prefix. For the negative test.
    function _hexNoPrefix(bytes memory data) internal pure returns (string memory) {
        return _toHexString(data);
    }

    /// @dev Lowercase-hex encodes raw bytes into an ASCII string.
    function _toHexString(bytes memory data) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory out = new bytes(data.length * 2);
        for (uint256 i = 0; i < data.length; i++) {
            out[i * 2] = alphabet[uint8(data[i]) >> 4];
            out[i * 2 + 1] = alphabet[uint8(data[i]) & 0x0f];
        }
        return string(out);
    }
}
