import type { ProverBackend, ProveParams } from "./index.js";
import type { ProofResult } from "../types.js";

export class HostedProver implements ProverBackend {
  constructor(private readonly url: string) {}

  async prove(params: ProveParams): Promise<ProofResult> {
    const form = new FormData();
    form.append(
      "eml",
      new Blob([params.eml as Uint8Array<ArrayBuffer>], { type: "message/rfc822" }),
      "recovery.eml"
    );
    form.append("newPublicKey", params.newOwner);
    form.append("nonce", params.nonce.toString());

    const resp = await fetch(`${this.url}/prove`, {
      method: "POST",
      body: form,
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      throw new Error(`Prover error: ${err.error ?? resp.statusText}`);
    }

    return resp.json() as Promise<ProofResult>;
  }
}
