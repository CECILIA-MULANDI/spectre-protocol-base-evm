import { readFile, writeFile } from "fs/promises";
import { parseEmail } from "../email/parser.js";
import { fetchDKIMPublicKey } from "../email/dkim.js";
import { buildWitness } from "./witness.js";

async function main() {
  const emlPath = process.argv[2];
  if (!emlPath)
    throw new Error(
      "Usage: tsx src/prover/generateProver.ts ../prover/sample_email.eml"
    );

  const rawEml = await readFile(emlPath);
  const parsed = await parseEmail(rawEml);

  console.log("From address:", parsed.fromAddress);
  console.log("DKIM domain:", parsed.dkim.domain);
  console.log("DKIM selector:", parsed.dkim.selector);
  console.log("Header length:", parsed.dkim.canonicalHeader.length);
  console.log("from_header_sequence:", parsed.fromHeaderSequence);
  console.log("from_address_sequence:", parsed.fromAddressSequence);

  const pubkey = await fetchDKIMPublicKey(
    parsed.dkim.selector,
    parsed.dkim.domain
  );
  console.log("Fetched RSA pubkey from DNS ✓");


  const witness = buildWitness(parsed, pubkey, 1n, 1n);

  // Format as TOML for Prover.toml
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
