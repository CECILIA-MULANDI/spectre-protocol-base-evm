import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile } from "fs/promises";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import type { CircuitWitness } from "./witness.js";

const execAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const CIRCUITS_DIR = resolve(__dirname, "../../../circuits");
const CIRCUIT_JSON = join(CIRCUITS_DIR, "target/spectre.json");
const WITNESS_GZ = join(CIRCUITS_DIR, "target/spectre.gz");
const PROOF_DIR = join(CIRCUITS_DIR, "target/proof");

export type ProofResult = {
  proof: Buffer;
  publicInputs: Buffer;
  verificationKey: Buffer;
};

function witnessToToml(w: CircuitWitness): string {
  const arr = (vals: string[]) => `[${vals.map((v) => `"${v}"`).join(", ")}]`;
  return [
    `email_hash = ${arr(w.email_hash)}`,
    `new_public_key = "${w.new_public_key}"`,
    `nonce = "${w.nonce}"`,
    `signature = ${arr(w.signature)}`,
    `body_hash_index = "${w.body_hash_index}"`,
    ``,
    `[pubkey]`,
    `modulus = ${arr(w.pubkey.modulus)}`,
    `redc = ${arr(w.pubkey.redc)}`,
    ``,
    `[header]`,
    `storage = ${arr(w.header.storage)}`,
    `len = "${w.header.len}"`,
    ``,
    `[body]`,
    `storage = ${arr(w.body.storage)}`,
    `len = "${w.body.len}"`,
    ``,
    `[from_header_sequence]`,
    `index = "${w.from_header_sequence.index}"`,
    `length = "${w.from_header_sequence.length}"`,
    ``,
    `[from_address_sequence]`,
    `index = "${w.from_address_sequence.index}"`,
    `length = "${w.from_address_sequence.length}"`,
    ``,
    `[dkim_header_sequence]`,
    `index = "${w.dkim_header_sequence.index}"`,
    `length = "${w.dkim_header_sequence.length}"`,
  ].join("\n");
}

/** Generates an UltraHonk ZK proof via nargo + bb. */
export async function generateProof(
  witness: CircuitWitness
): Promise<ProofResult> {
  await writeFile(
    join(CIRCUITS_DIR, "Prover.toml"),
    witnessToToml(witness),
    "utf-8"
  );
  await execAsync("nargo", ["execute"], { cwd: CIRCUITS_DIR });

  // --oracle_hash keccak for Solidity verifier compatibility
  await execAsync("bb", [
    "prove",
    "-s",
    "ultra_honk",
    "-b",
    CIRCUIT_JSON,
    "-w",
    WITNESS_GZ,
    "-o",
    PROOF_DIR,
    "--oracle_hash",
    "keccak",
    "--write_vk",
  ]);

  const [proof, publicInputs, verificationKey] = await Promise.all([
    readFile(join(PROOF_DIR, "proof")),
    readFile(join(PROOF_DIR, "public_inputs")),
    readFile(join(PROOF_DIR, "vk")),
  ]);

  return { proof, publicInputs, verificationKey };
}

/** Verifies a proof off-chain using bb. */
export async function verifyProof(result: ProofResult): Promise<boolean> {
  await Promise.all([
    writeFile(join(PROOF_DIR, "proof"), result.proof),
    writeFile(join(PROOF_DIR, "vk"), result.verificationKey),
  ]);

  try {
    await execAsync("bb", [
      "verify",
      "-s",
      "ultra_honk",
      "-p",
      join(PROOF_DIR, "proof"),
      "-k",
      join(PROOF_DIR, "vk"),
      "-i",
      join(PROOF_DIR, "public_inputs"),
      "--oracle_hash",
      "keccak",
    ]);
    return true;
  } catch {
    return false;
  }
}
