import type { Address, AgentRecord, RecoveryStatus, WorldIdProof, SpectreClientConfig, TxResult } from "./types.js";
export declare class SpectreClient {
    private readonly registry;
    private readonly prover;
    constructor(config: SpectreClientConfig);
    register(email: string): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
        emailHash: `0x${string}`;
    }>;
    registerWithCustomTimelock(email: string, timelockBlocks: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
        emailHash: `0x${string}`;
    }>;
    initiateEmailRecovery(params: {
        eml: Uint8Array;
        agentOwner: Address;
        newOwner: Address;
        nonce: bigint;
        worldIdProof: WorldIdProof;
    }): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    setBackupWallet(backupWallet: Address): Promise<TxResult>;
    initiateBackupRecovery(agentOwner: Address, newOwner: Address): Promise<TxResult>;
    setGuardians(guardians: Address[], threshold: number): Promise<TxResult>;
    approveGuardianRecovery(agentOwner: Address, newOwner: Address): Promise<TxResult>;
    cancelRecovery(agentOwner: Address): Promise<TxResult>;
    executeRecovery(agentOwner: Address): Promise<TxResult>;
    getRecord(owner: Address): Promise<AgentRecord>;
    getRecoveryStatus(owner: Address): Promise<RecoveryStatus>;
    getGuardians(owner: Address): Promise<Address[]>;
    getApprovalCount(agentOwner: Address, newOwner: Address): Promise<number>;
    computeSignal(agentOwner: Address, newOwner: Address, nonce: bigint): `0x${string}`;
}
//# sourceMappingURL=client.d.ts.map