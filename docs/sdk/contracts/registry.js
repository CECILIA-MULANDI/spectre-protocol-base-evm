import { createPublicClient, createWalletClient, http, sha256, stringToBytes, } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { REGISTRY_ABI } from "./abi.js";
const RECOVERY_MODES = ["None", "EmailWorldID", "Social", "Backup"];
export class RegistryClient {
    registryAddress;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    publicClient;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    walletClient;
    constructor(registryAddress, rpcUrl, privateKey) {
        this.registryAddress = registryAddress;
        const account = privateKeyToAccount(privateKey);
        const chain = rpcUrl.includes("sepolia") ? baseSepolia : base;
        this.publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
        this.walletClient = createWalletClient({
            account,
            chain,
            transport: http(rpcUrl),
        });
    }
    async register(emailHash) {
        return this.walletClient.writeContract({
            address: this.registryAddress,
            abi: REGISTRY_ABI,
            functionName: "register",
            args: [emailHash],
            account: this.walletClient.account,
            chain: this.walletClient.chain,
        });
    }
    async registerWithCustomTimelock(emailHash, timelockBlocks) {
        return this.walletClient.writeContract({
            address: this.registryAddress,
            abi: REGISTRY_ABI,
            functionName: "registerWithCustomTimelock",
            args: [emailHash, timelockBlocks],
            account: this.walletClient.account,
            chain: this.walletClient.chain,
        });
    }
    async initiateRecovery(agentOwner, newOwner, emailProof, emailPublicInputs, worldIdProof) {
        const [root, nullifier, proof] = parseWorldIdProof(worldIdProof);
        return this.walletClient.writeContract({
            address: this.registryAddress,
            abi: REGISTRY_ABI,
            functionName: "initiateRecovery",
            args: [
                agentOwner,
                newOwner,
                emailProof,
                emailPublicInputs,
                root,
                nullifier,
                proof,
            ],
            account: this.walletClient.account,
            chain: this.walletClient.chain,
        });
    }
    async initiateBackupRecovery(agentOwner, newOwner) {
        return this.walletClient.writeContract({
            address: this.registryAddress,
            abi: REGISTRY_ABI,
            functionName: "initiateBackupRecovery",
            args: [agentOwner, newOwner],
            account: this.walletClient.account,
            chain: this.walletClient.chain,
        });
    }
    async setBackupWallet(backupWallet) {
        return this.walletClient.writeContract({
            address: this.registryAddress,
            abi: REGISTRY_ABI,
            functionName: "setBackupWallet",
            args: [backupWallet],
            account: this.walletClient.account,
            chain: this.walletClient.chain,
        });
    }
    async setGuardians(guardians, threshold) {
        return this.walletClient.writeContract({
            address: this.registryAddress,
            abi: REGISTRY_ABI,
            functionName: "setGuardians",
            args: [guardians, threshold],
            account: this.walletClient.account,
            chain: this.walletClient.chain,
        });
    }
    async approveGuardianRecovery(agentOwner, newOwner) {
        return this.walletClient.writeContract({
            address: this.registryAddress,
            abi: REGISTRY_ABI,
            functionName: "approveGuardianRecovery",
            args: [agentOwner, newOwner],
            account: this.walletClient.account,
            chain: this.walletClient.chain,
        });
    }
    async cancelRecovery(agentOwner) {
        return this.walletClient.writeContract({
            address: this.registryAddress,
            abi: REGISTRY_ABI,
            functionName: "cancelRecovery",
            args: [agentOwner],
            account: this.walletClient.account,
            chain: this.walletClient.chain,
        });
    }
    async executeRecovery(agentOwner) {
        return this.walletClient.writeContract({
            address: this.registryAddress,
            abi: REGISTRY_ABI,
            functionName: "executeRecovery",
            args: [agentOwner],
            account: this.walletClient.account,
            chain: this.walletClient.chain,
        });
    }
    async getRecord(owner) {
        const raw = await this.publicClient.readContract({
            address: this.registryAddress,
            abi: REGISTRY_ABI,
            functionName: "getRecord",
            args: [owner],
        });
        return {
            emailHash: raw.emailHash,
            owner: raw.owner,
            pendingOwner: raw.pendingOwner,
            timelockBlocks: raw.timelockBlocks,
            recoveryInitBlock: raw.recoveryInitBlock,
            nonce: raw.nonce,
            backupWallet: raw.backupWallet,
            guardianThreshold: raw.guardianThreshold,
            guardianCount: raw.guardianCount,
        };
    }
    async getRecoveryStatus(owner) {
        // viem returns a positional array for multi-output functions when ABI is typed as Abi
        const raw = await this.publicClient.readContract({
            address: this.registryAddress,
            abi: REGISTRY_ABI,
            functionName: "recoveryStatus",
            args: [owner],
        });
        return {
            pending: raw[0],
            pendingOwner: raw[1],
            executeAfterBlock: raw[2],
            mode: RECOVERY_MODES[raw[3]] ?? "None",
        };
    }
    async getGuardians(owner) {
        const result = await this.publicClient.readContract({
            address: this.registryAddress,
            abi: REGISTRY_ABI,
            functionName: "getGuardians",
            args: [owner],
        });
        return result;
    }
    async getApprovalCount(agentOwner, newOwner) {
        const result = await this.publicClient.readContract({
            address: this.registryAddress,
            abi: REGISTRY_ABI,
            functionName: "getApprovalCount",
            args: [agentOwner, newOwner],
        });
        return result;
    }
    async waitForTx(hash) {
        return this.publicClient.waitForTransactionReceipt({ hash });
    }
    /// SHA-256 of the lowercased, trimmed email address.
    /// Must match what the circuit commits as `email_hash` and what
    /// SpectreRegistry stores in `record.emailHash`.
    computeEmailHash(email) {
        return sha256(stringToBytes(email.toLowerCase().trim()));
    }
}
function parseWorldIdProof(w) {
    const root = BigInt(w.root);
    const nullifier = BigInt(w.nullifier_hash);
    const proof = w.proof.map((p) => BigInt(p));
    return [root, nullifier, proof];
}
//# sourceMappingURL=registry.js.map