import type { ParsedEmail } from "../email/types.js";
import type { RSAPublicKey } from "../email/dkim.js";
import { createHash } from "crypto";

const LIMBS_BITS = 120n;
const NUM_LIMBS = 18;
const LIMB_MASK = (1n << LIMBS_BITS) - 1n;

export type CircuitWitness = {
  // Public inputs
  pubkey: { modulus: string[]; redc: string[] };
  email_hash: string[];
  new_public_key: string;
  nonce: string;
  // Private inputs — header
  header: { storage: string[]; len: string };
  signature: string[];
  from_header_sequence: { index: string; length: string };
  from_address_sequence: { index: string; length: string };
  // Private inputs — body binding
  body: { storage: string[]; len: string };
  dkim_header_sequence: { index: string; length: string };
  body_hash_index: string;
};

export function buildWitness(
  parsed: ParsedEmail,
  pubkey: RSAPublicKey,
  newPublicKey: bigint,
  nonce: bigint
): CircuitWitness {
  const modulusLimbs = splitToLimbs(pubkey.modulus);
  const redcParams = computeRedcParams(pubkey.modulus, 2048n);
  const emailHashBytes = Array.from(
    createHash("sha256").update(parsed.fromAddress).digest()
  );

  const MAX_HEADER_LEN = 2048;
  const headerBytes = Array.from(parsed.dkim.canonicalHeader);
  if (headerBytes.length > MAX_HEADER_LEN)
    throw new Error(`Header too long: ${headerBytes.length} > ${MAX_HEADER_LEN}`);
  const paddedHeader = [
    ...headerBytes,
    ...Array(MAX_HEADER_LEN - headerBytes.length).fill(0),
  ];

  const MAX_BODY_LEN = 128;
  const bodyBytes = Array.from(parsed.canonicalBody);
  if (bodyBytes.length > MAX_BODY_LEN)
    throw new Error(`Body too long: ${bodyBytes.length} > ${MAX_BODY_LEN} — body must be "${newPublicKey}:${nonce}\\r\\n"`);
  const paddedBody = [
    ...bodyBytes,
    ...Array(MAX_BODY_LEN - bodyBytes.length).fill(0),
  ];

  const sigBigint = BigInt("0x" + parsed.dkim.signatureBytes.toString("hex"));
  const signatureLimbs = splitToLimbs(sigBigint);

  return {
    pubkey: {
      modulus: modulusLimbs.map(String),
      redc: redcParams.map(String),
    },
    email_hash: emailHashBytes.map(String),
    new_public_key: String(newPublicKey),
    nonce: String(nonce),
    header: {
      storage: paddedHeader.map(String),
      len: String(headerBytes.length),
    },
    signature: signatureLimbs.map(String),
    from_header_sequence: {
      index: String(parsed.fromHeaderSequence.index),
      length: String(parsed.fromHeaderSequence.length),
    },
    from_address_sequence: {
      index: String(parsed.fromAddressSequence.index),
      length: String(parsed.fromAddressSequence.length),
    },
    body: {
      storage: paddedBody.map(String),
      len: String(bodyBytes.length),
    },
    dkim_header_sequence: {
      index: String(parsed.dkim.dkimHeaderSequence.index),
      length: String(parsed.dkim.dkimHeaderSequence.length),
    },
    body_hash_index: String(parsed.dkim.bodyHashIndex),
  };
}

function splitToLimbs(n: bigint): bigint[] {
  const limbs: bigint[] = [];
  let remainder = n;
  for (let i = 0; i < NUM_LIMBS; i++) {
    limbs.push(remainder & LIMB_MASK);
    remainder >>= LIMBS_BITS;
  }
  return limbs;
}

function computeRedcParams(modulus: bigint, modBits: bigint): bigint[] {
  const redc = (1n << (modBits * 2n + 6n)) / modulus;
  return splitToLimbs(redc);
}
