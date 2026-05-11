export type Address = `0x${string}`;
export type ProofResult = {
    proof: string;
    publicInputs: string;
    fromAddress: string;
};
export type WorldIdProof = {
    root: string;
    nullifier_hash: string;
    proof: string[];
};
export type RecoveryMode = "EmailWorldID" | "Backup" | "Social";
export type RecoveryStatus = {
    pending: boolean;
    pendingOwner: Address;
    executeAfterBlock: bigint;
    mode: RecoveryMode | "None";
};
export type AgentRecord = {
    emailHash: `0x${string}`;
    owner: Address;
    pendingOwner: Address;
    timelockBlocks: bigint;
    recoveryInitBlock: bigint;
    nonce: bigint;
    backupWallet: Address;
    guardianThreshold: number;
    guardianCount: number;
};
export type TxResult = {
    hash: `0x${string}`;
    receipt: import("viem").TransactionReceipt;
};
export type ProverConfig = {
    type: "hosted";
    url: string;
} | {
    type: "browser";
    circuitUrl: string;
};
export type SpectreClientConfig = {
    rpcUrl: string;
    registryAddress: Address;
    privateKey: `0x${string}`;
    prover: ProverConfig;
};
//# sourceMappingURL=types.d.ts.map