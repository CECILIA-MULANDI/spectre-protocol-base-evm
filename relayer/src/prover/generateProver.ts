import { readFile, writeFile } from "fs/promises";
import { parseEmail } from "../email/parser.js";
import { fetchDKIMPublicKey } from "../email/dkim.js";
import { buildWitness } from "./witness.js";

async function main() {
  const emlPath = process.argv[2];
  if (!emlPath)
    throw new Error("error: email path is required");

  const rawEml = await readFile(emlPath);
  const parsed = await parseEmail(rawEml);

  console.log("From address:", parsed.fromAddress);
  console.log("DKIM domain:", parsed.dkim.domain);
  console.log("DKIM selector:", parsed.dkim.selector);
  console.log("Header length:", parsed.dkim.canonicalHeader.length);
  console.log("from_header_sequence:", parsed.fromHeaderSequence);
  console.log("from_address_sequence:", parsed.fromAddressSequence);
  console.log("subject_value_start:", parsed.subjectValueStart);
  console.log("subject_value_end:", parsed.subjectValueEnd);
  console.log("binding_offset:", parsed.bindingOffset);
  const subjectBytes = parsed.dkim.canonicalHeader.subarray(
    parsed.subjectValueStart,
    parsed.subjectValueEnd
  );
  console.log("subject value:", JSON.stringify(subjectBytes.toString("utf8")));

  const pubkey = await fetchDKIMPublicKey(
    parsed.dkim.selector,
    parsed.dkim.domain
  );
  console.log("Fetched RSA pubkey from DNS ✓");

  const witness = buildWitness(parsed, pubkey, 1n, 1n);

  const toml = formatProverToml(witness);
  await writeFile("../circuits/Prover.toml", toml);
  console.log("Prover.toml written ✓");
}

function formatProverToml(w: ReturnType<typeof buildWitness>): string {
  const arr = (vals: string[]) => `[${vals.map((v) => `"${v}"`).join(", ")}]`;

  return `
email_hash = ${arr(w.email_hash)}
new_public_key = "${w.new_public_key}"
nonce = "${w.nonce}"
signature = ${arr(w.signature)}
subject_value_start = "${w.subject_value_start}"
subject_value_end = "${w.subject_value_end}"
binding_offset = "${w.binding_offset}"

[pubkey]
modulus = ${arr(w.pubkey.modulus)}
redc = ${arr(w.pubkey.redc)}

[header]
storage = ${arr(w.header.storage)}
len = "${w.header.len}"

[from_header_sequence]
index = "${w.from_header_sequence.index}"
length = "${w.from_header_sequence.length}"

[from_address_sequence]
index = "${w.from_address_sequence.index}"
length = "${w.from_address_sequence.length}"
`.trim();
}

main().catch(console.error);
