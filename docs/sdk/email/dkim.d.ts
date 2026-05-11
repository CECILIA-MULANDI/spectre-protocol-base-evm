import type { RSAPublicKey } from "./types.js";
export type DKIMLookupOptions = {
    dohUrl?: string;
    fetchImpl?: typeof fetch;
};
export declare function fetchDKIMPublicKey(selector: string, domain: string, options?: DKIMLookupOptions): Promise<RSAPublicKey>;
//# sourceMappingURL=dkim.d.ts.map