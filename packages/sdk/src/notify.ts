import { privateKeyToAccount } from "viem/accounts";
import type { Address, WebhookSubscription } from "./types.js";

/**
 * Hosted-webhook subscription client for the Spectre relayer's `/subscribe`
 * API. Each mutating call is signed by the agent owner's key with an EIP-191
 * message that includes a nonce and the endpoint, so a stolen signature can't
 * be replayed against a different URL.
 *
 * Use this when you want server-side persistence and retries. For an in-process
 * RPC watcher, use {@link import("./client.js").SpectreClient.watchRecovery}.
 */
export class NotifyClient {
  constructor(
    private readonly getRelayerUrl: () => string | undefined,
    private readonly privateKey: `0x${string}`
  ) {}

  /**
   * Register a webhook for `agentOwner`. The relayer will POST a
   * `RecoveryAlert` JSON body to `endpoint` when a recovery is initiated.
   * Defaults `agentOwner` to the address derived from the client's key.
   */
  async subscribe(args: {
    endpoint: string;
    agentOwner?: Address;
    /** Optional smart-account / SpectreAccount address bound to the alert. */
    accountAddress?: Address;
  }): Promise<void> {
    const base = this.requireRelayerUrl();
    const account = privateKeyToAccount(this.privateKey);
    const agentOwner = (args.agentOwner ?? account.address) as Address;
    const nonce = generateNonce();

    const message = subscribeMessage({
      agentOwner,
      endpoint: args.endpoint,
      nonce,
      account: args.accountAddress,
    });
    const signature = await account.signMessage({ message });

    const res = await fetch(`${base}/subscribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentOwner,
        endpoint: args.endpoint,
        nonce,
        signature,
        accountAddress: args.accountAddress,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`subscribe failed: ${res.status} ${body}`);
    }
  }

  /** Look up the current subscription for `agentOwner`. Returns null if none. */
  async getSubscription(
    agentOwner: Address
  ): Promise<WebhookSubscription | null> {
    const base = this.requireRelayerUrl();
    const res = await fetch(`${base}/subscribe/${agentOwner}`);
    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`getSubscription failed: ${res.status} ${body}`);
    }
    return (await res.json()) as WebhookSubscription;
  }

  /** Remove the subscription for `agentOwner`. Signed by the owner key. */
  async unsubscribe(agentOwner?: Address): Promise<void> {
    const base = this.requireRelayerUrl();
    const account = privateKeyToAccount(this.privateKey);
    const target = (agentOwner ?? account.address) as Address;
    const nonce = generateNonce();
    const message = unsubscribeMessage({ agentOwner: target, nonce });
    const signature = await account.signMessage({ message });

    const res = await fetch(`${base}/subscribe/${target}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonce, signature }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`unsubscribe failed: ${res.status} ${body}`);
    }
  }

  private requireRelayerUrl(): string {
    const url = this.getRelayerUrl();
    if (!url) {
      throw new Error(
        "notify requires `relayerUrl` (or a hosted prover URL) in SpectreClientConfig"
      );
    }
    return url.replace(/\/$/, "");
  }
}

function subscribeMessage(args: {
  agentOwner: Address;
  endpoint: string;
  nonce: string;
  account?: string;
}): string {
  return [
    "Spectre subscribe",
    `agent: ${args.agentOwner.toLowerCase()}`,
    `endpoint: ${args.endpoint}`,
    `account: ${args.account ? args.account.toLowerCase() : "none"}`,
    `nonce: ${args.nonce}`,
  ].join("\n");
}

function unsubscribeMessage(args: {
  agentOwner: Address;
  nonce: string;
}): string {
  return [
    "Spectre unsubscribe",
    `agent: ${args.agentOwner.toLowerCase()}`,
    `nonce: ${args.nonce}`,
  ].join("\n");
}

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
