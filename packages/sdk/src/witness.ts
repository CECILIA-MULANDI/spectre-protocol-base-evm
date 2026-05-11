import { encodeUtf8 } from "./email/bytes.js";
import type { ParsedEmail, RSAPublicKey } from "./email/types.js";

const LIMB_BITS = 120n;
const NUM_LIMBS = 18;
const LIMB_MASK = (1n << LIMB_BITS) - 1n;

const MAX_HEADER_LEN = 2048;
const MAX_BODY_LEN = 128;

export type CircuitWitness = {
  pubkey: { modulus: string[]; redc: string[] };
  email_hash: string[];
  new_public_key: string;
  nonce: string;
  header: { storage: string[]; len: string };
  signature: string[];
  from_header_sequence: { index: string; length: string };
  from_address_sequence: { index: string; length: string };
  body: { storage: string[]; len: string };
  dkim_header_sequence: { index: string; length: string };
  body_hash_index: string;
};

export async function buildWitness(
  parsed: ParsedEmail,
  pubkey: RSAPublicKey,
  newPublicKey: bigint,
  nonce: bigint
): Promise<CircuitWitness> {
  const modulusLimbs = splitToLimbs(pubkey.modulus);
  const redcParams = computeRedcParams(pubkey.modulus, 2048n);

  const fromBytes = encodeUtf8(parsed.fromAddress);
  const emailHashBuffer = await crypto.subtle.digest(
    "SHA-256",
    fromBytes as unknown as BufferSource
  );
  const emailHashBytes = Array.from(new Uint8Array(emailHashBuffer));

  if (parsed.dkim.canonicalHeader.length > MAX_HEADER_LEN) {
    throw new Error(
      `Header too long: ${parsed.dkim.canonicalHeader.length} > ${MAX_HEADER_LEN}`
    );
  }
  const paddedHeader = padBytes(parsed.dkim.canonicalHeader, MAX_HEADER_LEN);

  if (parsed.canonicalBody.length > MAX_BODY_LEN) {
    throw new Error(
      `Body too long: ${parsed.canonicalBody.length} > ${MAX_BODY_LEN} - body must be "${newPublicKey}:${nonce}\\r\\n"`
    );
  }
  const paddedBody = padBytes(parsed.canonicalBody, MAX_BODY_LEN);

  const sigHex = Array.from(parsed.dkim.signatureBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const sigBigint = BigInt("0x" + sigHex);
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
      len: String(parsed.dkim.canonicalHeader.length),
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
      len: String(parsed.canonicalBody.length),
    },
    dkim_header_sequence: {
      index: String(parsed.dkim.dkimHeaderSequence.index),
      length: String(parsed.dkim.dkimHeaderSequence.length),
    },
    body_hash_index: String(parsed.dkim.bodyHashIndex),
  };
}

function padBytes(bytes: Uint8Array, length: number): number[] {
  const out = new Array<number>(length).fill(0);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i]!;
  return out;
}

function splitToLimbs(n: bigint): bigint[] {
  const limbs: bigint[] = [];
  let remainder = n;
  for (let i = 0; i < NUM_LIMBS; i++) {
    limbs.push(remainder & LIMB_MASK);
    remainder >>= LIMB_BITS;
  }
  return limbs;
}

function computeRedcParams(modulus: bigint, modBits: bigint): bigint[] {
  const redc = (1n << (modBits * 2n + 6n)) / modulus;
  return splitToLimbs(redc);
}
