import type { ProofResult } from "../types.js";
export interface ProverBackend {
    prove(params: ProveParams): Promise<ProofResult>;
}
export type ProveParams = {
    eml: Uint8Array;
    newOwner: string;
    nonce: bigint;
};
//# sourceMappingURL=index.d.ts.map