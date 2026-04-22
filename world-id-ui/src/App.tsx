import { useState } from "react";
import {
  IDKitRequestWidget,
  CredentialRequest,
  any,
  type IDKitResult,
  IDKitErrorCodes,
} from "@worldcoin/idkit";
import { encodePacked, keccak256, isAddress, decodeAbiParameters } from "viem";

const WORLD_ID_APP_ID = ((import.meta as any).env?.VITE_WLD_APP_ID ??
  "app_staging_placeholder") as `app_${string}`;
const BACKEND_URL =
  (import.meta as any).env?.VITE_BACKEND_URL ?? "http://localhost:3001";

type RpContext = {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
};

// ResponseItemV3: legacy Semaphore proof format — matches our contract's uint256[8] expectation
type ResponseItemV3 = {
  identifier: string;
  proof: string; // ABI-encoded uint256[8] hex
  merkle_root: string; // hex
  nullifier: string; // hex
};

export default function App() {
  const [agentOwner, setAgentOwner] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [nonce, setNonce] = useState("1");
  const [open, setOpen] = useState(false);
  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const [result, setResult] = useState<IDKitResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idkitError, setIdkitError] = useState<string | null>(null);

  const valid =
    isAddress(agentOwner) &&
    isAddress(newOwner) &&
    /^\d+$/.test(nonce) &&
    agentOwner !== newOwner;

  // Must match SpectreRegistry: keccak256(abi.encodePacked(agentOwner, newOwner, nonce))
  const signal: `0x${string}` = valid
    ? keccak256(
        encodePacked(
          ["address", "address", "uint256"],
          [
            agentOwner as `0x${string}`,
            newOwner as `0x${string}`,
            BigInt(nonce),
          ]
        )
      )
    : "0x0000000000000000000000000000000000000000000000000000000000000000";

  async function handleVerifyClick() {
    setError(null);
    setLoading(true);
    try {
      const resp = await fetch(`${BACKEND_URL}/worldid-context`, {
        method: "POST",
      });
      if (!resp.ok) throw new Error(await resp.text());
      const ctx: RpContext = await resp.json();
      setRpContext(ctx);
      setOpen(true);
    } catch (e) {
      setError(
        `Failed to get signing context: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    } finally {
      setLoading(false);
    }
  }

  function onSuccess(res: IDKitResult) {
    setResult(res);
    setOpen(false);
  }

  // Format result as worldid-proof.json for the CLI.
  // v4 ResponseItemV4: proof[0..3] = compressed Groth16, proof[4] = Merkle root, nullifier = hex
  const proofJson = (() => {
    if (!result) return null;
    const res = result as unknown as {
      protocol_version?: string;
      responses?: ResponseItemV3[];
    };
    if (res.protocol_version === "4.0") {
      const v4 = (result as unknown as { responses: ResponseItemV4[] })
        .responses?.[0];
      if (!v4) return JSON.stringify(result, null, 2);
      return JSON.stringify(
        {
          protocol_version: "4.0",
          merkle_root: v4.proof[4], // proof[4] is the Merkle root
          nullifier: v4.nullifier,
          proof: v4.proof.slice(0, 4), // first 4 = compressed Groth16
          signal_hash: v4.signal_hash,
          issuer_schema_id: v4.issuer_schema_id,
        },
        null,
        2
      );
    }
    // v3 fallback
    const v3 = res.responses?.[0];
    if (!v3) return JSON.stringify(result, null, 2);
    const decoded = decodeAbiParameters(
      [{ type: "uint256[8]" }],
      v3.proof as `0x${string}`
    )[0] as bigint[];
    return JSON.stringify(
      {
        root: v3.merkle_root,
        nullifier_hash: v3.nullifier,
        proof: decoded.map(String),
      },
      null,
      2
    );
  })();

  async function copy() {
    if (!proofJson) return;
    await navigator.clipboard.writeText(proofJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <h1>Spectre — Get World ID Proof</h1>
      <p>
        Fill in the recovery parameters, verify with World App, then save the
        output as worldid-proof.json.
      </p>

      {WORLD_ID_APP_ID === "app_staging_placeholder" && (
        <p className="warn">⚠ Set VITE_WLD_APP_ID in world-id-ui/.env</p>
      )}

      <label>Agent owner address (current owner being recovered)</label>
      <input
        placeholder="0x..."
        value={agentOwner}
        onChange={(e) => {
          setAgentOwner(e.target.value);
          setResult(null);
        }}
      />

      <label>New owner address (address to rotate control to)</label>
      <input
        placeholder="0x..."
        value={newOwner}
        onChange={(e) => {
          setNewOwner(e.target.value);
          setResult(null);
        }}
      />

      <label>Nonce (from SpectreRegistry.getRecord(agentOwner).nonce)</label>
      <input
        placeholder="1"
        value={nonce}
        onChange={(e) => {
          setNonce(e.target.value);
          setResult(null);
        }}
      />

      {valid && <p className="signal">Signal: {signal}</p>}

      {error && <p style={{ color: "red" }}>{error}</p>}

      {!result ? (
        <>
          <button onClick={handleVerifyClick} disabled={!valid || loading}>
            {loading ? "Preparing..." : "Verify with World App"}
          </button>

          {rpContext && (
            <IDKitRequestWidget
              app_id={WORLD_ID_APP_ID}
              action="spectre-recovery"
              rp_context={rpContext}
              constraints={any(CredentialRequest("proof_of_human", { signal }))}
              allow_legacy_proofs={false}
              environment="staging"
              open={open}
              onOpenChange={setOpen}
              onSuccess={onSuccess}
              onError={(code: IDKitErrorCodes) => setIdkitError(code)}
            />
          )}
          {idkitError && (
            <p style={{ color: "orange" }}>
              World ID error code: <strong>{idkitError}</strong>
            </p>
          )}
        </>
      ) : (
        <>
          <p style={{ color: "#4ade80" }}>
            ✓ Proof generated. Save as worldid-proof.json.
          </p>
          <pre>{proofJson}</pre>
          <button onClick={copy}>
            {copied ? "Copied!" : "Copy to clipboard"}
          </button>
        </>
      )}
    </div>
  );
}
