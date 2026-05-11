use SHA256::sha256_var;
use zkemail::{
    dkim::RSAPubkey,
    headers::email_address::get_email_address,
    Sequence,
};

global KEY_LIMBS_2048: u32 = 18;
global MAX_EMAIL_HEADER_LENGTH: u32 = 2048;
/// Maximum number of bytes we scan after the `spectre:` marker for the
/// `<bigint>:<nonce>` payload. 128 covers the worst-case 77-digit Field value
/// plus 20-digit nonce plus delimiters with slack.
global MAX_BINDING_PAYLOAD: u32 = 128;

// -- Helpers ---------------------------------------------------------------------

fn check_email_hash<let N: u32>(from_address: BoundedVec<u8, N>, email_hash: [u8; 32]) {
    let hashed = sha256_var(from_address.storage(), from_address.len() as u32);
    assert(hashed == email_hash, "from-address hash mismatch");
}

/// Validates that `subject_value_start` points immediately past a `subject:`
/// field-name in the canonical DKIM header (i.e. this is the first byte of the
/// subject value), and that the next CRLF is at `subject_value_end`. Returns
/// nothing - this is a pure constraint helper.
fn check_subject_field_bounds<let MAX_HEADER_LEN: u32>(
    header: BoundedVec<u8, MAX_HEADER_LEN>,
    subject_value_start: u32,
    subject_value_end: u32,
) {
    // Must have room for "subject:" prefix before the value.
    assert(subject_value_start >= 8, "subject_value_start too small for 'subject:' prefix");
    assert(
        subject_value_end + 2 <= header.len(),
        "subject_value_end + CRLF out of header bounds",
    );
    assert(subject_value_end >= subject_value_start, "subject_value_end before start");

    // The 8 bytes ending at subject_value_start must spell "subject:" (lower-cased
    // because the relaxed-header canonicalisation lowercases field names).
    let prefix = comptime { "subject:".as_bytes() };
    for i in 0..8 {
        assert(
            header.get_unchecked(subject_value_start - 8 + i) == prefix[i],
            "subject_value_start does not follow 'subject:' field name",
        );
    }

    // The field must start at the beginning of a canonical header line:
    // either offset 0, or the two bytes before "subject:" are CRLF.
    let field_start = subject_value_start - 8;
    if field_start != 0 {
        assert(field_start >= 2, "no room for preceding CRLF");
        assert(header.get_unchecked(field_start - 2) == 13, "subject field must follow CR");
        assert(header.get_unchecked(field_start - 1) == 10, "subject field must follow LF");
    }

    // The two bytes at subject_value_end must be CRLF (end of header line).
    // Unless subject is the final field, in which case there's no trailing CRLF
    // in the canonical header. Allow either.
    if subject_value_end != header.len() {
        assert(header.get_unchecked(subject_value_end) == 13, "subject must end with CR");
        assert(header.get_unchecked(subject_value_end + 1) == 10, "subject must end with LF");
    }
}

/// Parses `spectre:<key>:<nonce>` starting at `binding_offset` within the
/// canonical header, where `binding_offset` is constrained to lie inside the
/// subject value range.
fn parse_recovery_binding<let MAX_HEADER_LEN: u32>(
    header: BoundedVec<u8, MAX_HEADER_LEN>,
    subject_value_start: u32,
    subject_value_end: u32,
    binding_offset: u32,
) -> (Field, Field) {
    // Bound the binding marker inside the subject value.
    assert(binding_offset >= subject_value_start, "binding before subject value");
    assert(binding_offset + 8 <= subject_value_end, "binding extends past subject value");

    // Verify the literal "spectre:" prefix at binding_offset.
    let prefix = comptime { "spectre:".as_bytes() };
    for i in 0..8 {
        assert(
            header.get_unchecked(binding_offset + i) == prefix[i],
            "subject missing 'spectre:' marker at binding_offset",
        );
    }

    // Parse `<bigint>:<nonce>` starting after the prefix. Accepts:
    //   * decimal digits 0-9
    //   * exactly one ':' separator between key and nonce
    //   * trailing space (0x20) or end-of-subject as the terminator
    let COLON: u8 = 58;
    let SPACE: u8 = 32;
    let ASCII_ZERO: u8 = 48;
    let ASCII_NINE: u8 = 57;

    let scan_start = binding_offset + 8;
    let mut key: Field = 0;
    let mut nonce_val: Field = 0;
    let mut past_colon: bool = false;
    let mut ended: bool = false;

    for i in 0..MAX_BINDING_PAYLOAD {
        let idx = scan_start + i;
        if (idx < subject_value_end) & !ended {
            let b = header.get_unchecked(idx);
            if b == SPACE {
                ended = true;
            } else if b == COLON {
                assert(!past_colon, "binding must contain exactly one ':' separator");
                past_colon = true;
            } else {
                assert(
                    (b >= ASCII_ZERO) & (b <= ASCII_NINE),
                    "binding must contain only digits and a single ':'",
                );
                let digit = (b - ASCII_ZERO) as Field;
                if !past_colon {
                    key = key * 10 + digit;
                } else {
                    nonce_val = nonce_val * 10 + digit;
                }
            }
        }
    }

    assert(past_colon, "binding must contain ':' between key and nonce");
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
///   header                - canonicalized DKIM header bytes
///   signature             - RSA-2048 DKIM signature
///   from_header_sequence  - byte range of the `from:<value>` field
///   from_address_sequence - byte range of the address inside the FROM value
///   subject_value_start   - byte offset (within header) of the first byte after
///                           `subject:` field name (i.e. start of subject value)
///   subject_value_end     - byte offset of the CRLF that ends the subject value
///   binding_offset        - byte offset of the `spectre:` marker within the
///                           subject value
///
/// The circuit:
///   1. Verifies the DKIM signature over the canonical header. The signature
///      already commits to the body via the `bh=` tag - we do not need to read
///      the body to know it's authentic, so the email body can be anything the
///      sender's mail client produces (multipart, signatures, replies).
///   2. Verifies the FROM address hashes to the registered email_hash.
///   3. Validates that subject_value_start/end actually delimit a `subject:`
///      header field in the canonical header.
///   4. Parses `spectre:<new_public_key>:<nonce>` from the subject and asserts
///      it matches the public inputs - this binds the recovery to a specific
///      (newOwner, nonce) pair.
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
    subject_value_start: u32,
    subject_value_end: u32,
    binding_offset: u32,
) {
    // 1. Verify DKIM signature over the canonical header.
    let _ = pubkey.verify_dkim_signature(header, signature);

    // 2. Verify the FROM address hash matches the registered email.
    let from_field = comptime { "from".as_bytes() };
    let from_address = get_email_address(
        header,
        from_header_sequence,
        from_address_sequence,
        from_field,
    );
    check_email_hash(from_address, email_hash);

    // 3. Validate the subject field is well-formed in the canonical header.
    check_subject_field_bounds(header, subject_value_start, subject_value_end);

    // 4. Parse the binding from the subject and assert it matches public inputs.
    let (extracted_key, extracted_nonce) = parse_recovery_binding(
        header,
        subject_value_start,
        subject_value_end,
        binding_offset,
    );
    assert(extracted_key == new_public_key, "subject key does not match new_public_key");
    assert(extracted_nonce == nonce, "subject nonce does not match nonce");

    // 5. Sanity bounds.
    assert(new_public_key != 0, "new_public_key must be non-zero");
    assert(nonce != 0, "nonce must be non-zero");
}

// -- Tests -----------------------------------------------------------------------

#[test]
fn test_email_hash_round_trip() {
    let mut addr: BoundedVec<u8, MAX_EMAIL_HEADER_LENGTH> = BoundedVec::new();
    let bytes: [u8; 14] =
        [0x75, 0x73, 0x65, 0x72, 0x40, 0x67, 0x6d, 0x61, 0x69, 0x6c, 0x2e, 0x63, 0x6f, 0x6d];
    for byte in bytes {
        addr.push(byte);
    }
    let hash = sha256_var(addr.storage(), addr.len() as u32);
    check_email_hash(addr, hash);
}

#[test(should_fail_with = "from-address hash mismatch")]
fn test_email_hash_zero_hash_fails() {
    let mut addr: BoundedVec<u8, MAX_EMAIL_HEADER_LENGTH> = BoundedVec::new();
    let bytes: [u8; 14] =
        [0x75, 0x73, 0x65, 0x72, 0x40, 0x67, 0x6d, 0x61, 0x69, 0x6c, 0x2e, 0x63, 0x6f, 0x6d];
    for byte in bytes {
        addr.push(byte);
    }
    check_email_hash(addr, [0; 32]);
}
