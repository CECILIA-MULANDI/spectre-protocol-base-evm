import type { ProverBackend, ProveParams } from "./index.js";
import type { ProofResult } from "../types.js";
import { parseEmail } from "../email/parser.js";
import { fetchDKIMPublicKey, type DKIMLookupOptions } from "../email/dkim.js";
import { buildWitness } from "../witness.js";

export type BrowserProverOptions = DKIMLookupOptions;

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
    const circuit = await circuitResp.json();

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
