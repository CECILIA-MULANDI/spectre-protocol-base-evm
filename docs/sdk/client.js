import { keccak256, encodePacked } from "viem";
import { RegistryClient } from "./contracts/registry.js";
import { HostedProver } from "./provers/hosted.js";
import { BrowserProver } from "./provers/browser.js";
export class SpectreClient {
    registry;
    prover;
    constructor(config) {
        if (!config.privateKey) {
            throw new Error("privateKey is required");
        }
        this.registry = new RegistryClient(config.registryAddress, config.rpcUrl, config.privateKey);
        this.prover =
            config.prover.type === "hosted"
                ? new HostedProver(config.prover.url)
                : new BrowserProver(config.prover.circuitUrl);
    }
    // Registration
    /// Register an agent using the protocol's default timelock.
    async register(email) {
        const emailHash = this.registry.computeEmailHash(email);
        const hash = await this.registry.register(emailHash);
        const receipt = await this.registry.waitForTx(hash);
        return { hash, receipt, emailHash };
    }
    /// Register an agent with a longer-than-default timelock.
    /// Reverts if `timelockBlocks` is below the protocol's default.
    async registerWithCustomTimelock(email, timelockBlocks) {
        const emailHash = this.registry.computeEmailHash(email);
        const hash = await this.registry.registerWithCustomTimelock(emailHash, timelockBlocks);
        const receipt = await this.registry.waitForTx(hash);
        return { hash, receipt, emailHash };
    }
    // Email + World ID recovery
    async initiateEmailRecovery(params) {
        const { proof, publicInputs } = await this.prover.prove({
            eml: params.eml,
            newOwner: params.newOwner,
            nonce: params.nonce,
        });
        const emailProof = `0x${proof}`;
        const emailPublicInputs = publicInputs
            .split(",")
            .map((v) => `0x${BigInt(v).toString(16).padStart(64, "0")}`);
        const hash = await this.registry.initiateRecovery(params.agentOwner, params.newOwner, emailProof, emailPublicInputs, params.worldIdProof);
        const receipt = await this.registry.waitForTx(hash);
        return { hash, receipt };
    }
    // Backup wallet recovery
    async setBackupWallet(backupWallet) {
        const hash = await this.registry.setBackupWallet(backupWallet);
        const receipt = await this.registry.waitForTx(hash);
        return { hash, receipt };
    }
    async initiateBackupRecovery(agentOwner, newOwner) {
        const hash = await this.registry.initiateBackupRecovery(agentOwner, newOwner);
        const receipt = await this.registry.waitForTx(hash);
        return { hash, receipt };
    }
    // Social / guardian recovery
    async setGuardians(guardians, threshold) {
        const hash = await this.registry.setGuardians(guardians, threshold);
        const receipt = await this.registry.waitForTx(hash);
        return { hash, receipt };
    }
    async approveGuardianRecovery(agentOwner, newOwner) {
        const hash = await this.registry.approveGuardianRecovery(agentOwner, newOwner);
        const receipt = await this.registry.waitForTx(hash);
        return { hash, receipt };
    }
    // Cancel / execute
    async cancelRecovery(agentOwner) {
        const hash = await this.registry.cancelRecovery(agentOwner);
        const receipt = await this.registry.waitForTx(hash);
        return { hash, receipt };
    }
    async executeRecovery(agentOwner) {
        const hash = await this.registry.executeRecovery(agentOwner);
        const receipt = await this.registry.waitForTx(hash);
        return { hash, receipt };
    }
    //Read
    async getRecord(owner) {
        return this.registry.getRecord(owner);
    }
    async getRecoveryStatus(owner) {
        return this.registry.getRecoveryStatus(owner);
    }
    async getGuardians(owner) {
        return this.registry.getGuardians(owner);
    }
    async getApprovalCount(agentOwner, newOwner) {
        return this.registry.getApprovalCount(agentOwner, newOwner);
    }
    computeSignal(agentOwner, newOwner, nonce) {
        return keccak256(encodePacked(["address", "address", "uint256"], [agentOwner, newOwner, nonce]));
    }
}
//# sourceMappingURL=client.js.map