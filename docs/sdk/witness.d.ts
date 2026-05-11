import type { ParsedEmail, RSAPublicKey } from "./email/types.js";
export type CircuitWitness = {
    pubkey: {
        modulus: string[];
        redc: string[];
    };
    email_hash: string[];
    new_public_key: string;
    nonce: string;
    header: {
        storage: string[];
        len: string;
    };
    signature: string[];
    from_header_sequence: {
        index: string;
        length: string;
    };
    from_address_sequence: {
        index: string;
        length: string;
    };
    body: {
        storage: string[];
        len: string;
    };
    dkim_header_sequence: {
        index: string;
        length: string;
    };
    body_hash_index: string;
};
export declare function buildWitness(parsed: ParsedEmail, pubkey: RSAPublicKey, newPublicKey: bigint, nonce: bigint): Promise<CircuitWitness>;
//# sourceMappingURL=witness.d.ts.map