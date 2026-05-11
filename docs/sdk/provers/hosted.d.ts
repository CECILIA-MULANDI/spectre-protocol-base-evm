import type { ProverBackend, ProveParams } from "./index.js";
import type { ProofResult } from "../types.js";
export declare class HostedProver implements ProverBackend {
    private readonly url;
    constructor(url: string);
    prove(params: ProveParams): Promise<ProofResult>;
}
//# sourceMappingURL=hosted.d.ts.map