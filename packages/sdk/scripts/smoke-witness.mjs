// Smoke test: parse the relayer fixture, fetch the DKIM key, build a witness,
// and confirm it shape-matches what the circuit expects.
//
// Note: the recovery-test.eml fixture must have a Subject of the form
// "spectre:<key>:<nonce>" for the parser to find a valid binding. If it
// doesn't, parsing fails with a clear error.
import { readFile } from "node:fs/promises";
import { parseEmail } from "../dist/email/parser.js";
import { fetchDKIMPublicKey } from "../dist/email/dkim.js";
import { buildWitness } from "../dist/witness.js";

const eml = await readFile(new URL("../../../relayer/recovery-test.eml", import.meta.url));
const parsed = await parseEmail(new Uint8Array(eml));
console.log("from:", parsed.fromAddress);
console.log("dkim:", parsed.dkim.selector, "/", parsed.dkim.domain);
console.log("header len:", parsed.dkim.canonicalHeader.length);
console.log("subject value:", parsed.subjectValueStart, "-", parsed.subjectValueEnd);
console.log("binding offset:", parsed.bindingOffset);

const pubkey = await fetchDKIMPublicKey(parsed.dkim.selector, parsed.dkim.domain);
console.log("modulus bits:", pubkey.modulus.toString(2).length);
console.log("exponent:", pubkey.exponent.toString());

const newOwner = 0x000000000000000000000000abcdef1234567890n;
const nonce = 1n;
const witness = await buildWitness(parsed, pubkey, newOwner, nonce);
console.log("witness keys:", Object.keys(witness).sort().join(","));
console.log("modulus limbs:", witness.pubkey.modulus.length);
console.log("signature limbs:", witness.signature.length);
console.log("header storage len:", witness.header.storage.length, "(should be 2048)");
console.log("email_hash bytes:", witness.email_hash.length, "(should be 32)");
console.log("subject_value_start:", witness.subject_value_start);
console.log("subject_value_end:", witness.subject_value_end);
console.log("binding_offset:", witness.binding_offset);
console.log("OK");
