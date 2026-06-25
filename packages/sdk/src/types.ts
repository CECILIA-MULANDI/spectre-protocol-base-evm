export type Address = `0x${string}`;

export type ProofResult = {
  proof: string; // hex
  publicInputs: string; // hex
  fromAddress: string; // e.g. "alice@gmail.com"
};

export type RecoveryMode = "EmailPersonhood" | "Backup" | "Social";

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
  personhoodAdapter: Address;
};

export type TxResult = {
  hash: `0x${string}`;
  receipt: import("viem").TransactionReceipt;
};

export type RecoveryInitiatedEvent = {
  agentOwner: Address;
  newOwner: Address;
  executeAfterBlock: bigint;
  mode: RecoveryMode;
  txHash: `0x${string}`;
  blockNumber: bigint;
};

export type RecoveryCancelledEvent = {
  agentOwner: Address;
  txHash: `0x${string}`;
  blockNumber: bigint;
};

export type RecoveryExecutedEvent = {
  agentOwner: Address;
  newOwner: Address;
  txHash: `0x${string}`;
  blockNumber: bigint;
};

export type WatchRecoveryOptions = {
  /** Restrict to a single agent. Omit to watch every agent in the registry. */
  agentOwner?: Address;
  onInitiated?: (event: RecoveryInitiatedEvent) => void;
  onCancelled?: (event: RecoveryCancelledEvent) => void;
  onExecuted?: (event: RecoveryExecutedEvent) => void;
  /** Polling interval in ms (defaults to viem's default for the transport). */
  pollingInterval?: number;
};

/** Returned by {@link import("./client.js").SpectreClient.watchRecovery}. Call to stop watching. */
export type Unwatch = () => void;

export type WebhookSubscription = {
  agentOwner: Address;
  endpoint: string;
  accountAddress?: Address;
  channel: { kind: "webhook"; endpoint: string };
  createdAt: number;
};

export type ProverConfig =
  | { type: "hosted"; url: string }
  | {
      type: "browser";
      circuitUrl: string;
      /** SHA-256 of the circuit JSON bytes (hex, with or without 0x).
       *  Required unless `allowUnpinnedCircuit` is true. Pin to the artifact
       *  whose VK is in the deployed Verifier.sol. */
      circuitDigest?: string;
      /** Dev/test override: skip the digest check. Logs a warning. */
      allowUnpinnedCircuit?: boolean;
    };

export type SpectreClientConfig = {
  rpcUrl: string;
  registryAddress: Address;
  privateKey: `0x${string}`;
  prover: ProverConfig;
  /** Optional relayer base URL for off-chain helpers like email confirmation.
   *  When the hosted prover and the email-confirmation relayer are the same
   *  service, this typically equals `prover.url`. */
  relayerUrl?: string;
};
