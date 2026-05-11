export type Sequence = {
  index: number;
  length: number;
};

export type DKIMFields = {
  algorithm: string;
  domain: string;
  selector: string;
  canonicalHeader: Uint8Array;
  signatureBytes: Uint8Array;
};

export type ParsedEmail = {
  fromAddress: string;
  dkim: DKIMFields;
  fromHeaderSequence: Sequence;
  fromAddressSequence: Sequence;
  /** Byte offset within `canonicalHeader` of the first byte of the subject value (right after `subject:`). */
  subjectValueStart: number;
  /** Byte offset within `canonicalHeader` of the CRLF that ends the subject value (or header length if subject is last). */
  subjectValueEnd: number;
  /** Byte offset within `canonicalHeader` of the `spectre:` marker inside the subject value. */
  bindingOffset: number;
};

export type RSAPublicKey = {
  modulus: bigint;
  exponent: bigint;
};
