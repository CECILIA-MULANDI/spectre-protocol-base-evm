/**
 * World ID helpers for the Email + Personhood recovery flow.
 *
 * The protocol's personhood adapter is World ID by default. Generating a World
 * ID proof in the browser requires a signed `rp_context` from a trusted backend
 * (World ID v4 requirement). The Spectre hosted relayer exposes
 * `POST /worldid-context` for this purpose; this client wraps that call so
 * integrators don't have to learn the relayer protocol.
 *
 * The actual `@worldcoin/idkit` widget runs in the integrator's UI; this client
 * just provides the inputs it needs.
 */
export type WorldIdRpContext = {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
};

export class WorldIdClient {
  constructor(private readonly getRelayerUrl: () => string | undefined) {}

  /**
   * Fetch a fresh `rp_context` signed by the relayer. Pass the returned object
   * to `<IDKitRequestWidget rp_context={...} />`. The context has a short
   * expiry (set by the relayer); fetch a new one per recovery attempt.
   */
  async getContext(): Promise<WorldIdRpContext> {
    const base = this.requireRelayerUrl();
    const res = await fetch(`${base}/worldid-context`, { method: "POST" });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`worldid-context failed: ${res.status} ${body}`);
    }
    return (await res.json()) as WorldIdRpContext;
  }

  private requireRelayerUrl(): string {
    const url = this.getRelayerUrl();
    if (!url) {
      throw new Error(
        "worldId requires `relayerUrl` (or a hosted prover URL) in SpectreClientConfig"
      );
    }
    return url.replace(/\/$/, "");
  }
}
