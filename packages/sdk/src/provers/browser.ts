import type { InputMap } from "@noir-lang/noir_js";
import type { ProverBackend, ProveParams } from "./index.js";
import type { ProofResult } from "../types.js";

export class BrowserProver implements ProverBackend {
  // Path or URL to the compiled circuit JSON — caller provides this so the
  // SDK doesn't hardcode a fetch URL or bundle the artifact itself.
  constructor(private readonly circuitUrl: string) {}

  async prove(params: ProveParams): Promise<ProofResult> {
    // Dynamically import noir_js so bundlers can tree-shake this
    // when the hosted prover is used instead.
    const [{ Noir }, { UltraHonkBackend }] = await Promise.all([
      import("@noir-lang/noir_js"),
      import("@noir-lang/backend_barretenberg"),
    ]);

    const circuitResp = await fetch(this.circuitUrl);
    if (!circuitResp.ok)
      throw new Error(`Failed to fetch circuit: ${this.circuitUrl}`);
    const circuit = await circuitResp.json();

    const backend = new UltraHonkBackend(circuit.bytecode);
    const noir = new Noir(circuit);

    const witness = buildWitnessInput(params);
    const { witness: solved } = await noir.execute(witness);
    const { proof, publicInputs } = await backend.generateProof(solved);

    return {
      proof: bufferToHex(proof),
      publicInputs: publicInputs.join(","),
      fromAddress: "",
    };
  }
}

function buildWitnessInput(_params: ProveParams): InputMap {
  // TODO: mirror the witness structure from relayer/src/prover/witness.ts
  throw new Error("BrowserProver.buildWitnessInput not yet implemented");
}

function bufferToHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
