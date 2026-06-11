---
title: Recovering with Email + World ID
slug: /recovering-with-email
---

# Recovering with Email + World ID

The Email + Personhood mode is the only recovery path that's always armed after `register()`. It's also the highest-UX-complexity flow because it spans three systems: the user's email provider, World App on their phone, and your code. This page walks the full flow end-to-end and points out the steps where formatting is unforgiving.

:::warning[Who this page is for]

You need this page if **a person who lost their owner key needs to recover their agent**. If you're an operator recovering agents you own programmatically, the same flow applies, but you'll likely run it from a CLI or admin tool rather than user-facing UI. Both shapes use the same SDK calls.

:::

## The flow at a glance

1. Look up the agent's current `nonce` on chain.
2. The user sends themselves an email with an exact, machine-parseable Subject that binds the recovery to a `(newOwner, nonce)` pair.
3. The user downloads that email as a `.eml` file from their provider.
4. The user generates a World ID proof in their browser, with a `signal` that ties the proof to the same `(newOwner, nonce)`.
5. Your code submits `.eml` + World ID proof on-chain via `client.initiateEmailRecovery(...)`.
6. The timelock runs. The current owner (the lost key) can theoretically cancel during this window. After it elapses, anyone can finalise.

Every step from 2 onward is bound to the same `(newOwner, nonce)`. If any of them disagree, the on-chain call reverts. The SDK ships helpers for each binding step so you don't have to format anything by hand.

## Step 1: Look up the nonce

The nonce lives on chain and increments on every successful (or cancelled) recovery. Always read it freshly before starting a recovery; don't cache it.

```ts
import { SpectreClient } from "@spectre-protocol/sdk";

const client = new SpectreClient({
  rpcUrl: "https://sepolia.base.org",
  registryAddress: "0xBe53383054Fda41A9F71b8593384144c367b01A1",
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
  prover: { type: "hosted", url: "https://relayer.spectreprotocol.xyz" },
});

const record = await client.getRecord(agentOwner);
const { nonce } = record;
```

## Step 2: Build the recovery Subject and have the user send it

The DKIM-signed Subject header of the recovery email is what cryptographically commits the email to `(newOwner, nonce)`. The format is strict:

```
spectre:<newOwnerAsDecimalUint256>:<nonce>
```

Use the SDK helper rather than templating the string by hand. The parser rejects leading zeros, non-decimal characters, multiple `:` separators, and anything else surprising.

```ts
const subject = client.prepareRecoverySubject(newOwner, nonce);
// e.g. "spectre:1389375924817439871938:1"
```

The user then sends an email **from their registered email address** (the one whose sha256 was stored at `register()` time), with this exact string as the Subject. The body is ignored by the circuit. The recipient is also ignored, but sending to themselves is the simplest, since they need to download the email anyway.

A minimal UI prompt looks like:

> 1. Open your email client.
> 2. Compose a new message to **yourself**.
> 3. Paste this exactly as the Subject: `spectre:1389375924817439871938:1`
> 4. The body can be anything (or empty).
> 5. Send.

## Step 3: Download the `.eml`

The proof is generated from the raw `.eml` bytes, including the DKIM signature header. Every provider has a different download path:

| Provider | How to get the `.eml` |
| --- | --- |
| **Gmail (web)** | Open the message → ⋮ menu (top right) → **Show original** → **Download original** |
| **Outlook (web)** | Open the message → ⋯ menu → **View** → **View message source** → save the text as `.eml` |
| **Apple Mail (macOS)** | Open the message → **File** → **Save As** → choose Raw Message Source (`.eml`) |
| **ProtonMail** | Open the message → expand dropdown next to **Reply** → **Export** → **Export message** |
| **Fastmail** | Open the message → ⋯ menu → **View source** → save the text as `.eml` |

Have the user upload that file in your UI (a standard `<input type="file" accept=".eml">` works). Read it into a `Uint8Array` and pass it to `initiateEmailRecovery` later.

```ts
// Browser
const eml = new Uint8Array(await emlFile.arrayBuffer());

// Node
import { readFile } from "node:fs/promises";
const eml = await readFile(emlPath);
```

## Step 4: Generate the World ID proof

World ID v4 widgets are browser-only: someone has to scan a QR code in World App. The pieces you need to wire up:

### 4a. Set up World ID constants

Spectre uses a single World ID app for all recoveries. The app is active in both staging (for testnet development) and production (for mainnet).

```ts
// Use Spectre's public World ID app (active on both staging and production)
const WORLD_ID_APP_ID = "app_413b6e491a273ced2cd358a5b8ccd0e8";
const WORLD_ID_ACTION = "spectre-recovery";

// For testnet (Base Sepolia): use staging environment
// For mainnet (Base): use production environment
const WORLD_ID_ENVIRONMENT = "staging"; // or "production"
```

All integrators use the same `app_id` and `action`. This binds your recovery to Spectre's `externalNullifier` in the contract.

### 4b. Fetch a fresh `rp_context` from the relayer

World ID v4 requires a server-signed context. The hosted Spectre relayer exposes one for `action: "spectre-recovery"`:

```ts
const rpContext = await client.worldId.getContext();
// { rp_id, nonce, created_at, expires_at, signature }
```

Fetch this each time a user starts a recovery; the signature has a short expiry.

### 4c. Compute the signal

The signal binds the World ID proof to the same `(agentOwner, newOwner, nonce)` tuple as the email. The on-chain contract reverts if they disagree.

```ts
const signal = client.computeSignal(agentOwner, newOwner, nonce);
```

### 4d. Open the IDKit widget

Install `@worldcoin/idkit` (peer dep; not pulled in automatically by the SDK) and render the request widget with the signal, context, and action:

```tsx
import { IDKitRequestWidget, CredentialRequest, any } from "@worldcoin/idkit";

<IDKitRequestWidget
  app_id={WORLD_ID_APP_ID}
  action={WORLD_ID_ACTION}
  rp_context={rpContext}
  constraints={any(CredentialRequest("proof_of_human", { signal }))}
  allow_legacy_proofs={false}
  environment={WORLD_ID_ENVIRONMENT}
  open={open}
  onOpenChange={setOpen}
  onSuccess={(result) => setProof(toSpectreProof(result))}
/>
```

The user scans a QR code with World App and approves. `onSuccess` fires with an `IDKitResult` you must reshape into the SDK's `WorldIdProof` type.

### 4d. Reshape the IDKit result

The SDK's `initiateEmailRecovery` takes a proof of shape:

```ts
type WorldIdProof = {
  root: string;
  nullifier_hash: string;
  proof: string[]; // uint256[8] as decimal strings
};
```

IDKit v4 returns a slightly different shape depending on the response version. A working reshape (matches `world-id-ui/src/App.tsx` in the Spectre repo):

```ts
function toSpectreProof(result: IDKitResult): WorldIdProof {
  // v3 legacy Semaphore response
  const v3 = (result as any).responses?.[0];
  const decoded = decodeAbiParameters(
    [{ type: "uint256[8]" }],
    v3.proof as `0x${string}`
  )[0] as bigint[];
  return {
    root: v3.merkle_root,
    nullifier_hash: v3.nullifier,
    proof: decoded.map(String),
  };
}
```

A reference implementation that handles both v3 and v4 lives at [`world-id-ui/src/App.tsx`](https://github.com/CECILIA-MULANDI/spectre-protocol-base-evm/blob/main/world-id-ui/src/App.tsx). The hosted Spectre verifier on Base Sepolia accepts v3 today; v4 support tracks the [planned upgrade](https://github.com/CECILIA-MULANDI/spectre-protocol-base-evm/issues).

## Step 5: Submit the recovery

With `.eml` + `worldIdProof` in hand, one SDK call submits everything:

```ts
const { hash } = await client.initiateEmailRecovery({
  eml,
  agentOwner,
  newOwner,
  nonce,
  worldIdProof,
});
```

Behind the scenes this:

1. Calls the configured prover (browser or hosted) to produce the DKIM ZK proof from the `.eml`.
2. Packs the proof and its public inputs into the calldata.
3. Calls `SpectreRegistry.initiateRecovery(agentOwner, newOwner, emailProof, emailPublicInputs, worldIdProof)`.

The on-chain contract verifies:

- The DKIM signature over the email is valid against a registered DKIM key.
- The sha256 of the From address matches `record.emailHash`.
- The Subject contains `spectre:<BigInt(newOwner)>:<nonce>`.
- The World ID nullifier hasn't been used; the proof is valid for `action: "spectre-recovery"` and the signal binds to the same tuple.

If any check fails, the transaction reverts and nothing changes on chain.

## Step 6: Wait the timelock, then execute

```ts
const status = await client.getRecoveryStatus(agentOwner);
// status.executeAfterBlock — block at or after which executeRecovery becomes callable
// status.pendingOwner — the newOwner that's been staged
// status.mode — "EmailPersonhood"
```

Display a countdown to the user. The cancel window is the agent's `timelockBlocks` (set at registration). On Base Sepolia the floor is 10 blocks ≈ 20 seconds. On mainnet the default is ~24 hours.

Once `block.number >= status.executeAfterBlock`, anyone can finalise:

```ts
await client.executeRecovery(agentOwner);
```

After this lands, `record.owner` is the new owner and `record.nonce` has incremented. Any in-flight proofs against the old nonce are now invalid.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `subject missing 'spectre:' marker` | Subject was edited by the email provider (signature added, "Re:" prepended, smart quotes). Resend with a plain Subject; some providers add quoted-printable encoding which the circuit rejects. |
| `binding must contain only digits and a single ':'` | Hand-edited Subject. Use `prepareRecoverySubject`. |
| `from address mismatch` | The email was sent from an alias or a different address than the one registered. `record.emailHash` is sha256 of the *exact* registered address, lowercased and trimmed. |
| `DKIM key not registered` | The provider rotated their DKIM key and Spectre hasn't propagated it yet. Propose it via the DKIMRegistry governance flow, wait for confirmation, retry. |
| `signal mismatch` | The World ID `signal` was computed against a different `(agentOwner, newOwner, nonce)` than the on-chain call. Always derive both from the same values; never type the nonce by hand. |
| `nullifier already used` | This World ID account has already recovered for `action: "spectre-recovery"`. World ID enforces one-recovery-per-human-per-action; the user needs to recover from a different World ID account, or recover via another mode. |

## See also

- [Recovery modes](/recovery-modes): all three modes side by side.
- [Threat model](/threat-model): what the email + personhood combination defends against.
- [Monitoring](/monitoring): how the current owner watches for hostile recoveries during the timelock.
