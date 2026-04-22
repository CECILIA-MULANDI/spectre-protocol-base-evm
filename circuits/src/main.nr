use SHA256::sha256_var;
use zkemail::{
    dkim::RSAPubkey,
    headers::{body_hash::get_body_hash, email_address::get_email_address},
    Sequence,
};

global KEY_LIMBS_2048: u32 = 18;
global MAX_EMAIL_HEADER_LENGTH: u32 = 2048;
/// Body must be small: "{new_public_key_decimal}:{nonce_decimal}\r\n"
/// Max Field decimal = 77 digits, max nonce = 20 digits, colon + CRLF = 3 -> 102 bytes max.
global MAX_BODY_LENGTH: u32 = 128;

// -- Helpers ---------------------------------------------------------------------

fn check_email_hash<let N: u32>(from_address: BoundedVec<u8, N>, email_hash: [u8; 32]) {
    let hashed = sha256_var(from_address.storage(), from_address.len() as u32);
    assert(hashed == email_hash, "This is not the correct hash");
}

/// Verifies the body SHA256 matches the `bh=` commitment in the DKIM header.
fn check_body_hash<let MAX_HEADER_LEN: u32, let MAX_BODY_LEN: u32>(
    header: BoundedVec<u8, MAX_HEADER_LEN>,
    body: BoundedVec<u8, MAX_BODY_LEN>,
    dkim_header_sequence: Sequence,
    body_hash_index: u32,
) {
    let bh = get_body_hash(header, dkim_header_sequence, body_hash_index);
    let computed = sha256_var(body.storage(), body.len() as u32);
    assert(computed == bh, "body hash does not match DKIM commitment");
}

/// Parses a body with format `{key_decimal}:{nonce_decimal}\r\n` (or `\n`).
/// Returns (new_public_key, nonce) as Fields.
fn parse_recovery_body<let N: u32>(body: BoundedVec<u8, N>) -> (Field, Field) {
    let COLON: u8 = 58;
    let CR: u8 = 13;
    let LF: u8 = 10;
    let ASCII_ZERO: u8 = 48;

    let mut key: Field = 0;
    let mut nonce_val: Field = 0;
    let mut past_colon: bool = false;

    for i in 0..N {
        if i < body.len() {
            let b = body.get(i);
            if (b != CR) & (b != LF) & (b != COLON) {
                let digit = (b - ASCII_ZERO) as Field;
                if !past_colon {
                    key = key * 10 + digit;
                } else {
                    nonce_val = nonce_val * 10 + digit;
                }
            }
            if b == COLON {
                past_colon = true;
            }
        }
    }

    assert(past_colon, "body must contain ':' separator between key and nonce");
    (key, nonce_val)
}

// -- Main circuit --------------------------------------------------------------

/// Public inputs:
///   pubkey              - RSA-2048 DKIM public key (committed from DNS)
///   email_hash          - SHA256 of the owner's FROM address (stored on-chain)
///   new_public_key      - recovery key to rotate to
///   nonce               - replay protection (must match AgentRecord.nonce on-chain)
///
/// Private inputs:
///   header              - canonicalized DKIM header bytes
///   signature           - RSA-2048 DKIM signature
///   from_header_sequence / from_address_sequence - byte offsets of FROM in header
///   body                - DKIM relaxed-canonicalized body: "{key}:{nonce}\r\n"
///   dkim_header_sequence - byte offset of the dkim-signature field in header
///   body_hash_index     - byte offset of the base64 bh= value inside the header
///
/// The circuit:
///   1. Verifies the DKIM signature over the header.
///   2. Extracts the FROM address and checks its SHA256 hash matches email_hash.
///   3. Verifies the body SHA256 matches bh= committed in the DKIM header.
///   4. Parses new_public_key and nonce from the body, asserting they equal the
///      public inputs - binding the recovery params to the DKIM-signed email body.
fn main(
    // Public inputs
    pubkey: pub RSAPubkey<KEY_LIMBS_2048>,
    email_hash: pub [u8; 32],
    new_public_key: pub Field,
    nonce: pub Field,
    // Private inputs
    header: BoundedVec<u8, MAX_EMAIL_HEADER_LENGTH>,
    signature: [Field; KEY_LIMBS_2048],
    from_header_sequence: Sequence,
    from_address_sequence: Sequence,
    body: BoundedVec<u8, MAX_BODY_LENGTH>,
    dkim_header_sequence: Sequence,
    body_hash_index: u32,
) {
    // 1. Verify DKIM signature
    let _ = pubkey.verify_dkim_signature(header, signature);

    // 2. Verify FROM address hash
    let from_field = comptime { "from".as_bytes() };
    let from_address = get_email_address(header, from_header_sequence, from_address_sequence, from_field);
    check_email_hash(from_address, email_hash);

    // 3. Verify body is DKIM-committed (bh= matches SHA256 of body)
    check_body_hash(header, body, dkim_header_sequence, body_hash_index);

    // 4. Extract new_public_key and nonce from body, assert they match public inputs
    let (extracted_key, extracted_nonce) = parse_recovery_body(body);
    assert(extracted_key == new_public_key, "new_public_key not found in email body");
    assert(extracted_nonce == nonce, "nonce not found in email body");

    // 5. Sanity: both must be non-zero
    assert(new_public_key != 0, "new_public_key must be non-zero");
    assert(nonce != 0, "nonce must be non-zero");
}

// -- Tests -----------------------------------------------------------------------

#[test]
fn test_email_hash_round_trip() {
    let mut addr: BoundedVec<u8, MAX_EMAIL_HEADER_LENGTH> = BoundedVec::new();
    let bytes: [u8; 14] =
        [0x75, 0x73, 0x65, 0x72, 0x40, 0x67, 0x6d, 0x61, 0x69, 0x6c, 0x2e, 0x63, 0x6f, 0x6d];
    for byte in bytes { addr.push(byte); }
    let hash = sha256_var(addr.storage(), addr.len() as u32);
    check_email_hash(addr, hash);
}

#[test(should_fail_with = "This is not the correct hash")]
fn test_email_hash_zero_hash_fails() {
    let mut addr: BoundedVec<u8, MAX_EMAIL_HEADER_LENGTH> = BoundedVec::new();
    let bytes: [u8; 14] =
        [0x75, 0x73, 0x65, 0x72, 0x40, 0x67, 0x6d, 0x61, 0x69, 0x6c, 0x2e, 0x63, 0x6f, 0x6d];
    for byte in bytes { addr.push(byte); }
    check_email_hash(addr, [0; 32]);
}

#[test(should_fail_with = "This is not the correct hash")]
fn test_email_hash_wrong_email_fails() {
    let mut correct: BoundedVec<u8, MAX_EMAIL_HEADER_LENGTH> = BoundedVec::new();
    for b in [0x75u8, 0x73, 0x65, 0x72, 0x40, 0x67, 0x6d, 0x61, 0x69, 0x6c, 0x2e, 0x63, 0x6f, 0x6d] {
        correct.push(b);
    }
    let hash = sha256_var(correct.storage(), correct.len() as u32);
    let mut wrong: BoundedVec<u8, MAX_EMAIL_HEADER_LENGTH> = BoundedVec::new();
    for b in [0x61u8, 0x74, 0x74, 0x61, 0x63, 0x6b, 0x65, 0x72, 0x40, 0x65, 0x76, 0x69, 0x6c, 0x2e, 0x63, 0x6f, 0x6d] {
        wrong.push(b);
    }
    check_email_hash(wrong, hash);
}

#[test]
fn test_parse_recovery_body_basic() {
    // body = "123:45\r\n"
    let mut body: BoundedVec<u8, MAX_BODY_LENGTH> = BoundedVec::new();
    for b in [49u8, 50, 51, 58, 52, 53, 13, 10] { body.push(b); }
    let (key, nonce_val) = parse_recovery_body(body);
    assert(key == 123, "key should be 123");
    assert(nonce_val == 45, "nonce should be 45");
}

#[test]
fn test_parse_recovery_body_lf_only() {
    // body = "999:1\n"
    let mut body: BoundedVec<u8, MAX_BODY_LENGTH> = BoundedVec::new();
    for b in [57u8, 57, 57, 58, 49, 10] { body.push(b); }
    let (key, nonce_val) = parse_recovery_body(body);
    assert(key == 999, "key should be 999");
    assert(nonce_val == 1, "nonce should be 1");
}

#[test(should_fail_with = "body must contain ':' separator between key and nonce")]
fn test_parse_recovery_body_no_colon_fails() {
    let mut body: BoundedVec<u8, MAX_BODY_LENGTH> = BoundedVec::new();
    // "12345\r\n" - no colon
    for b in [49u8, 50, 51, 52, 53, 13, 10] { body.push(b); }
    let _ = parse_recovery_body(body);
}

#[test(should_fail_with = "new_public_key not found in email body")]
fn test_parse_wrong_key_fails() {
    // body = "100:1\r\n" but we claim new_public_key = 999
    let mut body: BoundedVec<u8, MAX_BODY_LENGTH> = BoundedVec::new();
    for b in [49u8, 48, 48, 58, 49, 13, 10] { body.push(b); }
    let (extracted_key, extracted_nonce) = parse_recovery_body(body);
    assert(extracted_key == 999, "new_public_key not found in email body");
    assert(extracted_nonce == 1, "nonce not found in email body");
}

#[test(should_fail_with = "nonce not found in email body")]
fn test_parse_wrong_nonce_fails() {
    // body = "100:1\r\n" but we claim nonce = 99
    let mut body: BoundedVec<u8, MAX_BODY_LENGTH> = BoundedVec::new();
    for b in [49u8, 48, 48, 58, 49, 13, 10] { body.push(b); }
    let (extracted_key, extracted_nonce) = parse_recovery_body(body);
    assert(extracted_key == 100, "new_public_key not found in email body");
    assert(extracted_nonce == 99, "nonce not found in email body");
}
