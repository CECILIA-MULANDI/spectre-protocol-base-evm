import {
  createPublicClient,
  createWalletClient,
  http,
  encodePacked,
  keccak256,
  type Hash,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { REGISTRY_ABI } from "./abi.js";
import type {
  Address,
  AgentRecord,
  RecoveryStatus,
  WorldIdProof,
} from "../types.js";

const RECOVERY_MODES = ["None", "EmailWorldID", "Social", "Backup"] as const;

export class RegistryClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly publicClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly walletClient: any;

  constructor(
    private readonly registryAddress: Address,
    rpcUrl: string,
    privateKey: `0x${string}`
  ) {
    const account = privateKeyToAccount(privateKey);
    const chain = rpcUrl.includes("sepolia") ? baseSepolia : base;

    this.publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    this.walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });
  }

  async register(
    emailHash: `0x${string}`,
    timelockBlocks: bigint
  ): Promise<Hash> {
    return this.walletClient.writeContract({
      address: this.registryAddress,
      abi: REGISTRY_ABI,
      functionName: "register",
      args: [emailHash, timelockBlocks],
      account: this.walletClient.account!,
      chain: this.walletClient.chain,
    });
  }

  async initiateRecovery(
    agentOwner: Address,
    newOwner: Address,
    emailProof: `0x${string}`,
    emailPublicInputs: `0x${string}`[],
    worldIdProof: WorldIdProof
  ): Promise<Hash> {
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
      account: this.walletClient.account!,
      chain: this.walletClient.chain,
    });
  }

  async initiateBackupRecovery(
    agentOwner: Address,
    newOwner: Address
  ): Promise<Hash> {
    return this.walletClient.writeContract({
      address: this.registryAddress,
      abi: REGISTRY_ABI,
      functionName: "initiateBackupRecovery",
      args: [agentOwner, newOwner],
      account: this.walletClient.account!,
      chain: this.walletClient.chain,
    });
  }

  async setBackupWallet(backupWallet: Address): Promise<Hash> {
    return this.walletClient.writeContract({
      address: this.registryAddress,
      abi: REGISTRY_ABI,
      functionName: "setBackupWallet",
      args: [backupWallet],
      account: this.walletClient.account!,
      chain: this.walletClient.chain,
    });
  }

  async setGuardians(guardians: Address[], threshold: number): Promise<Hash> {
    return this.walletClient.writeContract({
      address: this.registryAddress,
      abi: REGISTRY_ABI,
      functionName: "setGuardians",
      args: [guardians, threshold],
      account: this.walletClient.account!,
      chain: this.walletClient.chain,
    });
  }

  async approveGuardianRecovery(
    agentOwner: Address,
    newOwner: Address
  ): Promise<Hash> {
    return this.walletClient.writeContract({
      address: this.registryAddress,
      abi: REGISTRY_ABI,
      functionName: "approveGuardianRecovery",
      args: [agentOwner, newOwner],
      account: this.walletClient.account!,
      chain: this.walletClient.chain,
    });
  }

  async cancelRecovery(agentOwner: Address): Promise<Hash> {
    return this.walletClient.writeContract({
      address: this.registryAddress,
      abi: REGISTRY_ABI,
      functionName: "cancelRecovery",
      args: [agentOwner],
      account: this.walletClient.account!,
      chain: this.walletClient.chain,
    });
  }

  async executeRecovery(agentOwner: Address): Promise<Hash> {
    return this.walletClient.writeContract({
      address: this.registryAddress,
      abi: REGISTRY_ABI,
      functionName: "executeRecovery",
      args: [agentOwner],
      account: this.walletClient.account!,
      chain: this.walletClient.chain,
    });
  }

  async getRecord(owner: Address): Promise<AgentRecord> {
    const raw = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: REGISTRY_ABI,
      functionName: "getRecord",
      args: [owner],
    }) as {
      emailHash: `0x${string}`; owner: Address; pendingOwner: Address;
      timelockBlocks: bigint; recoveryInitBlock: bigint; nonce: bigint;
      backupWallet: Address; guardianThreshold: number; guardianCount: number;
      pendingRecoveryMode: number;
    };
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

  async getRecoveryStatus(owner: Address): Promise<RecoveryStatus> {
    // viem returns a positional array for multi-output functions when ABI is typed as Abi
    const raw = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: REGISTRY_ABI,
      functionName: "recoveryStatus",
      args: [owner],
    }) as [boolean, Address, bigint, number];
    return {
      pending: raw[0],
      pendingOwner: raw[1],
      executeAfterBlock: raw[2],
      mode: RECOVERY_MODES[raw[3]] ?? "None",
    };
  }

  async getGuardians(owner: Address): Promise<Address[]> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: REGISTRY_ABI,
      functionName: "getGuardians",
      args: [owner],
    });
    return result as Address[];
  }

  async getApprovalCount(agentOwner: Address, newOwner: Address): Promise<number> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: REGISTRY_ABI,
      functionName: "getApprovalCount",
      args: [agentOwner, newOwner],
    });
    return result as number;
  }

  async waitForTx(hash: Hash): Promise<TransactionReceipt> {
    return this.publicClient.waitForTransactionReceipt({ hash })
  }

  computeEmailHash(email: string): `0x${string}` {
    return keccak256(encodePacked(["string"], [email.toLowerCase().trim()]));
  }
}

function parseWorldIdProof(
  w: WorldIdProof
): [
  bigint,
  bigint,
  readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]
] {
  const root = BigInt(w.root);
  const nullifier = BigInt(w.nullifier_hash);
  const proof = w.proof.map((p) => BigInt(p)) as unknown as readonly [
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint
  ];
  return [root, nullifier, proof];
}
