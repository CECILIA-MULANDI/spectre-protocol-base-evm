import { type Hash, type TransactionReceipt } from "viem";
import type { Address, AgentRecord, RecoveryStatus, WorldIdProof } from "../types.js";
export declare class RegistryClient {
    private readonly registryAddress;
    private readonly publicClient;
    private readonly walletClient;
    constructor(registryAddress: Address, rpcUrl: string, privateKey: `0x${string}`);
    register(emailHash: `0x${string}`): Promise<Hash>;
    registerWithCustomTimelock(emailHash: `0x${string}`, timelockBlocks: bigint): Promise<Hash>;
    initiateRecovery(agentOwner: Address, newOwner: Address, emailProof: `0x${string}`, emailPublicInputs: `0x${string}`[], worldIdProof: WorldIdProof): Promise<Hash>;
    initiateBackupRecovery(agentOwner: Address, newOwner: Address): Promise<Hash>;
    setBackupWallet(backupWallet: Address): Promise<Hash>;
    setGuardians(guardians: Address[], threshold: number): Promise<Hash>;
    approveGuardianRecovery(agentOwner: Address, newOwner: Address): Promise<Hash>;
    cancelRecovery(agentOwner: Address): Promise<Hash>;
    executeRecovery(agentOwner: Address): Promise<Hash>;
    getRecord(owner: Address): Promise<AgentRecord>;
    getRecoveryStatus(owner: Address): Promise<RecoveryStatus>;
    getGuardians(owner: Address): Promise<Address[]>;
    getApprovalCount(agentOwner: Address, newOwner: Address): Promise<number>;
    waitForTx(hash: Hash): Promise<TransactionReceipt>;
    computeEmailHash(email: string): `0x${string}`;
}
//# sourceMappingURL=registry.d.ts.map