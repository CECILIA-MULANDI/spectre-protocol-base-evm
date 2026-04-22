export type Sequence = {
  // start pos in the header bytes
  index: number;
  // how many bytes long
  length: number;
};
export type DKIMFields = {
  //e.g rsa-sha256
  algorithm: string;
  // e.g gmail.com
  domain: string;
  // used to fetch the DNS key
  selector: string;
  // actual bytes DKIM signed
  canonicalHeader: Buffer;
  // RSA-sig bytes
  signatureBytes: Buffer;
  // position of dkim-signature field in canonicalHeader
  dkimHeaderSequence: Sequence;
  // byte offset of the base64 bh= value within canonicalHeader
  bodyHashIndex: number;
};

export type ParsedEmail = {
  fromAddress: string;
  dkim: DKIMFields;
  fromHeaderSequence: Sequence;
  fromAddressSequence: Sequence;
  // DKIM relaxed-canonicalized body bytes
  canonicalBody: Buffer;
};
