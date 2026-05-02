import { keccak256, encodePacked } from "viem";
import { RegistryClient } from "./contracts/registry.js";
import { HostedProver } from "./provers/hosted.js";
import { BrowserProver } from "./provers/browser.js";
import type { ProverBackend } from "./provers/index.js";
import type {
  Address,
  AgentRecord,
  RecoveryStatus,
  WorldIdProof,
  SpectreClientConfig,
  TxResult,
} from "./types.js";

export class SpectreClient {
  private readonly registry: RegistryClient;
  private readonly prover: ProverBackend;

  constructor(config: SpectreClientConfig) {
    if (!config.privateKey) {
      throw new Error("privateKey is required");
    }

    this.registry = new RegistryClient(
      config.registryAddress,
      config.rpcUrl,
      config.privateKey
    );

    this.prover =
      config.prover.type === "hosted"
        ? new HostedProver(config.prover.url)
        : new BrowserProver(config.prover.circuitUrl);
  }

  // Registration

  async register(email: string, timelockBlocks: bigint) {
    const emailHash = this.registry.computeEmailHash(email);
    const hash = await this.registry.register(emailHash, timelockBlocks);
    const receipt = await this.registry.waitForTx(hash);
    return { hash, receipt, emailHash };
  }

  // Email + World ID recovery

  async initiateEmailRecovery(params: {
    eml: Uint8Array;
    agentOwner: Address;
    newOwner: Address;
    nonce: bigint;
    worldIdProof: WorldIdProof;
  }) {
    const { proof, publicInputs } = await this.prover.prove({
      eml: params.eml,
      newOwner: params.newOwner,
      nonce: params.nonce,
    });

    const emailProof = `0x${proof}` as `0x${string}`;
    const emailPublicInputs = publicInputs
      .split(",")
      .map(
        (v) => `0x${BigInt(v).toString(16).padStart(64, "0")}` as `0x${string}`
      );

    const hash = await this.registry.initiateRecovery(
      params.agentOwner,
      params.newOwner,
      emailProof,
      emailPublicInputs,
      params.worldIdProof
    );
    const receipt = await this.registry.waitForTx(hash);
    return { hash, receipt };
  }

  // Backup wallet recovery

  async setBackupWallet(backupWallet: Address): Promise<TxResult> {
    const hash = await this.registry.setBackupWallet(backupWallet);
    const receipt = await this.registry.waitForTx(hash);
    return { hash, receipt };
  }

  async initiateBackupRecovery(agentOwner: Address, newOwner: Address): Promise<TxResult> {
    const hash = await this.registry.initiateBackupRecovery(agentOwner, newOwner);
    const receipt = await this.registry.waitForTx(hash);
    return { hash, receipt };
  }

  // Social / guardian recovery

  async setGuardians(guardians: Address[], threshold: number): Promise<TxResult> {
    const hash = await this.registry.setGuardians(guardians, threshold);
    const receipt = await this.registry.waitForTx(hash);
    return { hash, receipt };
  }

  async approveGuardianRecovery(agentOwner: Address, newOwner: Address): Promise<TxResult> {
    const hash = await this.registry.approveGuardianRecovery(agentOwner, newOwner);
    const receipt = await this.registry.waitForTx(hash);
    return { hash, receipt };
  }

  // Cancel / execute

  async cancelRecovery(agentOwner: Address): Promise<TxResult> {
    const hash = await this.registry.cancelRecovery(agentOwner);
    const receipt = await this.registry.waitForTx(hash);
    return { hash, receipt };
  }

  async executeRecovery(agentOwner: Address): Promise<TxResult> {
    const hash = await this.registry.executeRecovery(agentOwner);
    const receipt = await this.registry.waitForTx(hash);
    return { hash, receipt };
  }

  //Read

  async getRecord(owner: Address): Promise<AgentRecord> {
    return this.registry.getRecord(owner);
  }

  async getRecoveryStatus(owner: Address): Promise<RecoveryStatus> {
    return this.registry.getRecoveryStatus(owner);
  }

  async getGuardians(owner: Address): Promise<Address[]> {
    return this.registry.getGuardians(owner);
  }

  async getApprovalCount(
    agentOwner: Address,
    newOwner: Address
  ): Promise<number> {
    return this.registry.getApprovalCount(agentOwner, newOwner);
  }

  computeSignal(
    agentOwner: Address,
    newOwner: Address,
    nonce: bigint
  ): `0x${string}` {
    return keccak256(
      encodePacked(
        ["address", "address", "uint256"],
        [agentOwner, newOwner, nonce]
      )
    );
  }
}
