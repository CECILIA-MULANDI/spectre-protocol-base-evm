import { keccak256, encodePacked } from "viem";
import { RegistryClient } from "./contracts/registry.js";
import { HostedProver } from "./provers/hosted.js";
import { BrowserProver } from "./provers/browser.js";
import { NotifyClient } from "./notify.js";
import { WorldIdClient } from "./worldid.js";
import type { ProverBackend } from "./provers/index.js";
import type {
  Address,
  AgentRecord,
  RecoveryStatus,
  WorldIdProof,
  SpectreClientConfig,
  TxResult,
  WatchRecoveryOptions,
  Unwatch,
} from "./types.js";

export class SpectreClient {
  private readonly registry: RegistryClient;
  private readonly prover: ProverBackend;
  private readonly relayerUrl?: string;

  /** Hosted-webhook subscription helpers. RPC watching is on the client directly via {@link watchRecovery}. */
  readonly notify: NotifyClient;

  /** World ID helpers for the Email + Personhood recovery flow (rp_context fetch). */
  readonly worldId: WorldIdClient;

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
        : new BrowserProver(config.prover.circuitUrl, {
            circuitDigest: config.prover.circuitDigest,
            allowUnpinnedCircuit: config.prover.allowUnpinnedCircuit,
          });

    this.relayerUrl =
      config.relayerUrl ??
      (config.prover.type === "hosted" ? config.prover.url : undefined);

    this.notify = new NotifyClient(() => this.relayerUrl, config.privateKey);
    this.worldId = new WorldIdClient(() => this.relayerUrl);
  }

  // Email-ownership confirmation (optional UX layer; protocol does not enforce)

  /**
   * Returns a `challenge()` / `verify(code)` pair bound to `email`. The
   * relayer sends a one-time code to the address; the user reads it and
   * pastes it back. UIs gate the on-chain `register(email)` button on
   * `verify()` returning `true`. See relayer/src/email/outbound.ts.
   *
   * The on-chain contract does not enforce this — see
   * docs/threat-model.md and `project_gas_sponsorship_oos`.
   */
  confirmEmail(email: string): {
    challenge: () => Promise<void>;
    verify: (code: string) => Promise<boolean>;
  } {
    if (!this.relayerUrl) {
      throw new Error(
        "confirmEmail requires `relayerUrl` (or a hosted prover URL) in SpectreClientConfig"
      );
    }
    const base = this.relayerUrl.replace(/\/$/, "");
    return {
      challenge: async () => {
        const r = await fetch(`${base}/email/challenge`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        });
        if (!r.ok) {
          const body = await r.text();
          throw new Error(`email/challenge failed: ${r.status} ${body}`);
        }
      },
      verify: async (code: string) => {
        const r = await fetch(`${base}/email/verify`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, code }),
        });
        if (r.status === 200) {
          const body = (await r.json()) as { verified?: boolean };
          return body.verified === true;
        }
        return false;
      },
    };
  }

  // Registration

  /// Register an agent using the protocol's default timelock.
  async register(email: string) {
    const emailHash = this.registry.computeEmailHash(email);
    const hash = await this.registry.register(emailHash);
    const receipt = await this.registry.waitForTx(hash);
    return { hash, receipt, emailHash };
  }

  /// Register an agent with a longer-than-default timelock.
  /// Reverts if `timelockBlocks` is below the protocol's default.
  async registerWithCustomTimelock(email: string, timelockBlocks: bigint) {
    const emailHash = this.registry.computeEmailHash(email);
    const hash = await this.registry.registerWithCustomTimelock(emailHash, timelockBlocks);
    const receipt = await this.registry.waitForTx(hash);
    return { hash, receipt, emailHash };
  }

  /// Register choosing a specific personhood adapter (must be the protocol
  /// default or approved in the PersonhoodRegistry). Pass the protocol default
  /// timelock if you don't want a longer window.
  async registerWithAdapter(
    email: string,
    adapter: Address,
    timelockBlocks: bigint
  ) {
    const emailHash = this.registry.computeEmailHash(email);
    const hash = await this.registry.registerWith(emailHash, adapter, timelockBlocks);
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

  /**
   * Build the exact email Subject that binds a recovery email to
   * `(newOwner, nonce)`. The user sends an email from their registered address
   * with this string as the Subject header; the circuit verifies the DKIM
   * signature covers it. Format: `spectre:<newOwnerAsUint256>:<nonce>`.
   *
   * `newOwner` is encoded as its decimal uint256 representation (not hex), so
   * `0x00...0001` becomes `1`. Use this helper rather than rolling your own
   * string template; the parser is exact about formatting.
   */
  prepareRecoverySubject(newOwner: Address, nonce: bigint): string {
    return `spectre:${BigInt(newOwner).toString()}:${nonce.toString()}`;
  }

  // Monitoring (RPC-based, trustless)

  /**
   * Watch recovery lifecycle events directly off the RPC. Returns an `unwatch`
   * function. Pass `agentOwner` to filter to one agent; omit to watch every
   * agent in the registry.
   *
   * For server-side persistence and retry handling, use {@link notify} instead.
   */
  watchRecovery(opts: WatchRecoveryOptions): Unwatch {
    return this.registry.watchRecovery(opts);
  }
}
