import type { ProverBackend, ProveParams } from "./index.js";
import type { ProofResult } from "../types.js";
import { type DKIMLookupOptions } from "../email/dkim.js";
export type BrowserProverOptions = DKIMLookupOptions;
export declare class BrowserProver implements ProverBackend {
    private readonly circuitUrl;
    private readonly options;
    constructor(circuitUrl: string, options?: BrowserProverOptions);
    prove(params: ProveParams): Promise<ProofResult>;
}
//# sourceMappingURL=browser.d.ts.map