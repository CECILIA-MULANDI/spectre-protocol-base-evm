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
};

export type ParsedEmail = {
  fromAddress: string;
  dkim: DKIMFields;
  fromHeaderSequence: Sequence;
  fromAddressSequence: Sequence;
  // Byte offset (within canonicalHeader) of the first byte after `subject:`
  subjectValueStart: number;
  // Byte offset (within canonicalHeader) of the CRLF that ends the subject value
  subjectValueEnd: number;
  // Byte offset (within canonicalHeader) of the `spectre:` marker in the subject value
  bindingOffset: number;
};
