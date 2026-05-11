// Smoke test: parse a DKIM-signed .eml whose Subject contains
// "spectre:<newOwner-as-bigint>:<nonce>", fetch the DKIM key, build a witness,
// and confirm it shape-matches the new circuit (subject-based binding).
//
// This test verifies the SDK parser + witness pipeline; it does NOT run the
// circuit (which would also verify the DKIM RSA signature).
import { readFile } from "node:fs/promises";
import { parseEmail } from "../dist/email/parser.js";
import { fetchDKIMPublicKey } from "../dist/email/dkim.js";
import { buildWitness } from "../dist/witness.js";

const fixturePath = process.argv[2] ?? "/tmp/recovery-subject.eml";
const eml = await readFile(fixturePath);
const parsed = await parseEmail(new Uint8Array(eml));

console.log("from:                ", parsed.fromAddress);
console.log("dkim:                ", parsed.dkim.selector, "/", parsed.dkim.domain);
console.log("header len:          ", parsed.dkim.canonicalHeader.length);
console.log("subject_value_start: ", parsed.subjectValueStart);
console.log("subject_value_end:   ", parsed.subjectValueEnd);
console.log("binding_offset:      ", parsed.bindingOffset);

const subjectBytes = parsed.dkim.canonicalHeader.subarray(
  parsed.subjectValueStart,
  parsed.subjectValueEnd
);
console.log("subject value:       ", JSON.stringify(new TextDecoder().decode(subjectBytes)));

const bindingBytes = parsed.dkim.canonicalHeader.subarray(parsed.bindingOffset);
const bindingText = new TextDecoder().decode(bindingBytes);
const endOfLine = bindingText.search(/[\r\n]/);
console.log("binding region:      ", JSON.stringify(bindingText.slice(0, endOfLine === -1 ? 60 : endOfLine)));

const pubkey = await fetchDKIMPublicKey(parsed.dkim.selector, parsed.dkim.domain);
console.log("modulus bits:        ", pubkey.modulus.toString(2).length);
console.log("exponent:            ", pubkey.exponent.toString());

const newOwner = 0xabcdef1234567890n;
const nonce = 1n;
const witness = await buildWitness(parsed, pubkey, newOwner, nonce);
const expectedKeys = [
  "binding_offset",
  "email_hash",
  "from_address_sequence",
  "from_header_sequence",
  "header",
  "new_public_key",
  "nonce",
  "pubkey",
  "signature",
  "subject_value_end",
  "subject_value_start",
];
const actualKeys = Object.keys(witness).sort();
console.log("witness keys match:  ", JSON.stringify(actualKeys) === JSON.stringify(expectedKeys));
console.log("modulus limbs:       ", witness.pubkey.modulus.length, "(should be 18)");
console.log("signature limbs:     ", witness.signature.length, "(should be 18)");
console.log("header storage len:  ", witness.header.storage.length, "(should be 2048)");
console.log("email_hash bytes:    ", witness.email_hash.length, "(should be 32)");
console.log("subject_value_start: ", witness.subject_value_start);
console.log("subject_value_end:   ", witness.subject_value_end);
console.log("binding_offset:      ", witness.binding_offset);
console.log("new_public_key:      ", witness.new_public_key);
console.log("nonce:               ", witness.nonce);
console.log("OK");
