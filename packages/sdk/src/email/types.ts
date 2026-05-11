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
  dkimHeaderSequence: Sequence;
  bodyHashIndex: number;
};

export type ParsedEmail = {
  fromAddress: string;
  dkim: DKIMFields;
  fromHeaderSequence: Sequence;
  fromAddressSequence: Sequence;
  canonicalBody: Uint8Array;
};

export type RSAPublicKey = {
  modulus: bigint;
  exponent: bigint;
};
