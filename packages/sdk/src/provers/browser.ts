import type { ProverBackend, ProveParams } from "./index.js";
import type { ProofResult } from "../types.js";
import { parseEmail } from "../email/parser.js";
import { fetchDKIMPublicKey, type DKIMLookupOptions } from "../email/dkim.js";
import { buildWitness } from "../witness.js";

export type BrowserProverOptions = DKIMLookupOptions & {
  /** SHA-256 of the circuit JSON bytes (hex, optional 0x prefix). */
  circuitDigest?: string;
  /** Skip the digest check. Logs a warning. */
  allowUnpinnedCircuit?: boolean;
};

export class BrowserProver implements ProverBackend {
  constructor(
    private readonly circuitUrl: string,
    private readonly options: BrowserProverOptions = {}
  ) {}

  async prove(params: ProveParams): Promise<ProofResult> {
    const [{ Noir }, { UltraHonkBackend }] = await Promise.all([
      import("@noir-lang/noir_js"),
      import("@noir-lang/backend_barretenberg"),
    ]);

    const circuitResp = await fetch(this.circuitUrl);
    if (!circuitResp.ok)
      throw new Error(`Failed to fetch circuit: ${this.circuitUrl} (${circuitResp.status})`);
    // Hash the raw bytes BEFORE parsing — re-serializing JSON is not byte-stable.
    const circuitBytes = new Uint8Array(await circuitResp.arrayBuffer());
    await verifyCircuitDigest(circuitBytes, this.options);
    const circuit = JSON.parse(new TextDecoder().decode(circuitBytes));

    const parsed = await parseEmail(params.eml);
    const pubkey = await fetchDKIMPublicKey(
      parsed.dkim.selector,
      parsed.dkim.domain,
      this.options
    );
    const witness = await buildWitness(
      parsed,
      pubkey,
      BigInt(params.newOwner),
      params.nonce
    );

    const backend = new UltraHonkBackend(circuit.bytecode);
    const noir = new Noir(circuit);

    const { witness: solved } = await noir.execute(witness);
    const { proof, publicInputs } = await backend.generateProof(solved);

    return {
      proof: bytesToHex(proof),
      publicInputs: publicInputs.join(","),
      fromAddress: parsed.fromAddress,
    };
  }
}

function bytesToHex(buf: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < buf.length; i++) hex += buf[i]!.toString(16).padStart(2, "0");
  return hex;
}

function normalizeDigest(d: string): string {
  return (d.startsWith("0x") || d.startsWith("0X") ? d.slice(2) : d).toLowerCase();
}

async function verifyCircuitDigest(
  bytes: Uint8Array,
  options: BrowserProverOptions
): Promise<void> {
  const expected = options.circuitDigest;
  if (!expected) {
    if (!options.allowUnpinnedCircuit) {
      throw new Error(
        "BrowserProver: circuitDigest is required for trustless use. " +
          "Pass the SHA-256 of the circuit artifact whose VK is deployed in " +
          "Verifier.sol, or set allowUnpinnedCircuit:true to override (dev only)."
      );
    }
    // eslint-disable-next-line no-console
    console.warn(
      "[spectre] BrowserProver: circuit fetched without digest verification " +
        "(allowUnpinnedCircuit:true). Do not use in production."
    );
    return;
  }
  const digestBuf = await crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as BufferSource
  );
  const actual = bytesToHex(new Uint8Array(digestBuf));
  const want = normalizeDigest(expected);
  if (actual !== want) {
    throw new Error(
      `BrowserProver: circuit digest mismatch. expected=${want} actual=${actual}. ` +
        `The fetched circuit does not match the pinned hash — refusing to prove.`
    );
  }
}
