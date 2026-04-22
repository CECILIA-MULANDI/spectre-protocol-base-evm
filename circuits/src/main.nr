use SHA256::sha256_var;
use zkemail::{dkim::RSAPubkey, headers::email_address::get_email_address, Sequence};

global KEY_LIMBS_2048: u32 = 18;

/// Private inputs:
///   - header: raw canonicalized email header bytes (hidden from verifier)
///   - signature: RSA-2048 DKIM signature over the header
///   - from_header_sequence / from_address_sequence: byte positions of the FROM address in header
/// Public inputs:
///   - pubkey: RSA public key used to verify the DKIM signature (fetched from DNS, committed on-chain)
///   - email_hash: SHA256 of the FROM address, pre-stored in the EVM AgentRecord
///   - new_public_key: the recovery key to rotate to (bound to proof to prevent front-running)
///   - nonce: replay protection -- must match the nonce stored in the EVM AgentRecord
///
/// The circuit verifies the DKIM signature, extracts the FROM address, and asserts its
/// SHA256 hash matches the public email_hash commitment stored on-chain.
/// Since new_public_key is a public input, it is baked into the proof -- any attempt to
/// substitute a different key after proof generation will cause verification to fail.

// cap email to this to have fixed size at compile time
global MAX_EMAIL_HEADER_LENGTH: u32 = 2048;

//Helpers
fn check_email_hash<let N: u32>(from_address: BoundedVec<u8, N>, email_hash: [u8; 32]) {
    let hashed = sha256_var(from_address.storage(), from_address.len() as u32);
    assert(hashed == email_hash, "This is not the correct hash");
}

fn check_recovery_params(new_public_key: Field, nonce: Field) {
    assert(new_public_key != 0, "new_public key must be set");
    assert(nonce != 0, "Nonce must be set");
}

fn main(
    // --Public inputs
    pubkey: pub RSAPubkey<KEY_LIMBS_2048>,
    email_hash: pub [u8; 32],
    new_public_key: pub Field,
    nonce: pub Field,
    // --Private inputs
    header: BoundedVec<u8, MAX_EMAIL_HEADER_LENGTH>,
    signature: [Field; KEY_LIMBS_2048],
    from_header_sequence: Sequence,
    from_address_sequence: Sequence,
) {
    // 1. Verify the DKIM signature
    let _ = pubkey.verify_dkim_signature(header, signature);
    // 2. Extract the FROM address and check its hash
    let from = comptime { "from".as_bytes() };
    let from_address = get_email_address(header, from_header_sequence, from_address_sequence, from);
    check_email_hash(from_address, email_hash);
    check_recovery_params(new_public_key, nonce);
}

// These tests cover check_email_hash and check_recovery_params in isolation.
// All test emails are raw address bytes (no null-padding)-SHA256 is computed
// over exactly the bytes in the BoundedVec, matching what get_email_address returns.

// Round-trip: sha256_var("user@gmail.com") must equal itself.
#[test]
fn test_email_hash_round_trip() {
    let mut addr: BoundedVec<u8, MAX_EMAIL_HEADER_LENGTH> = BoundedVec::new();
    // "user@gmail.com" (14 bytes)
    let bytes: [u8; 14] =
        [0x75, 0x73, 0x65, 0x72, 0x40, 0x67, 0x6d, 0x61, 0x69, 0x6c, 0x2e, 0x63, 0x6f, 0x6d];
    for byte in bytes {
        addr.push(byte);
    }
    let hash = sha256_var(addr.storage(), addr.len() as u32);
    check_email_hash(addr, hash);
}

// An all-zero hash must not match any real email.
#[test(should_fail_with = "This is not the correct hash")]
fn test_email_hash_zero_hash_fails() {
    let mut addr: BoundedVec<u8, MAX_EMAIL_HEADER_LENGTH> = BoundedVec::new();
    let bytes: [u8; 14] =
        [0x75, 0x73, 0x65, 0x72, 0x40, 0x67, 0x6d, 0x61, 0x69, 0x6c, 0x2e, 0x63, 0x6f, 0x6d];
    for byte in bytes {
        addr.push(byte);
    }
    check_email_hash(addr, [0; 32]);
}

// Hash of email A must not verify email B (front-running / substitution resistance).
// Builds SHA256("user@gmail.com") then tries to verify "attacker@evil.com" against it.
#[test(should_fail_with = "This is not the correct hash")]
fn test_email_hash_wrong_email_fails() {
    let mut correct_addr: BoundedVec<u8, MAX_EMAIL_HEADER_LENGTH> = BoundedVec::new();
    let correct_bytes: [u8; 14] =
        [0x75, 0x73, 0x65, 0x72, 0x40, 0x67, 0x6d, 0x61, 0x69, 0x6c, 0x2e, 0x63, 0x6f, 0x6d];
    for byte in correct_bytes {
        correct_addr.push(byte);
    }
    let hash = sha256_var(correct_addr.storage(), correct_addr.len() as u32);

    let mut wrong_addr: BoundedVec<u8, MAX_EMAIL_HEADER_LENGTH> = BoundedVec::new();
    // "attacker@evil.com" (17 bytes)
    let wrong_bytes: [u8; 17] = [
        0x61, 0x74, 0x74, 0x61, 0x63, 0x6b, 0x65, 0x72, 0x40, 0x65, 0x76, 0x69, 0x6c, 0x2e, 0x63,
        0x6f, 0x6d,
    ];
    for byte in wrong_bytes {
        wrong_addr.push(byte);
    }
    check_email_hash(wrong_addr, hash);
}

// Two different emails must produce different hashes (collision sanity check).
#[test]
fn test_different_emails_produce_different_hashes() {
    let mut addr_a: BoundedVec<u8, MAX_EMAIL_HEADER_LENGTH> = BoundedVec::new();
    let bytes_a: [u8; 14] =
        [0x75, 0x73, 0x65, 0x72, 0x40, 0x67, 0x6d, 0x61, 0x69, 0x6c, 0x2e, 0x63, 0x6f, 0x6d];
    for byte in bytes_a {
        addr_a.push(byte);
    }

    let mut addr_b: BoundedVec<u8, MAX_EMAIL_HEADER_LENGTH> = BoundedVec::new();
    let bytes_b: [u8; 17] = [
        0x61, 0x74, 0x74, 0x61, 0x63, 0x6b, 0x65, 0x72, 0x40, 0x65, 0x76, 0x69, 0x6c, 0x2e, 0x63,
        0x6f, 0x6d,
    ];
    for byte in bytes_b {
        addr_b.push(byte);
    }

    let hash_a = sha256_var(addr_a.storage(), addr_a.len() as u32);
    let hash_b = sha256_var(addr_b.storage(), addr_b.len() as u32);
    assert(hash_a != hash_b, "distinct emails must not share a hash");
}

// --- recovery param tests ---

#[test]
fn test_valid_recovery_params() {
    check_recovery_params(1, 1);
}

#[test(should_fail_with = "new_public key must be set")]
fn test_zero_public_key_fails() {
    check_recovery_params(0, 1);
}

#[test(should_fail_with = "Nonce must be set")]
fn test_zero_nonce_fails() {
    check_recovery_params(1, 0);
}
