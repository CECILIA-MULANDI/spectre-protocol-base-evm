---
title: Recovering with Email + Personhood
slug: /recovering-with-email
---

# Recovering with Email + Personhood

The Email + Personhood mode is the only recovery path that's always armed after `register()`. It spans two systems: the user's email provider and your code. This page walks the full flow end-to-end and points out the steps where formatting is unforgiving.

:::warning[Who this page is for]

You need this page if **a person who lost their owner key needs to recover their agent**. If you're an operator recovering agents you own programmatically, the same flow applies, but you'll likely run it from a CLI or admin tool rather than user-facing UI. Both shapes use the same SDK calls.

:::

## The flow at a glance

1. Look up the agent's current `nonce` on chain.
2. The user sends an email from their registered email address to any other inbox they can access, with an exact, machine-parseable Subject that binds the recovery to a `(newOwner, nonce)` pair.
3. The user downloads that email as a `.eml` file from their provider.
4. Your code produces a personhood proof for the agent's configured adapter.
5. Your code submits `.eml` + personhood inputs on-chain via `client.initiateEmailRecovery(...)`.
6. The timelock runs. The current owner (the lost key) can cancel during this window. After it elapses, anyone can finalise.

Every step from 2 onward is bound to the same `(newOwner, nonce)`. If any of them disagree, the on-chain call reverts. The SDK ships helpers for each binding step so you don't have to format anything by hand.

## Step 1: Look up the nonce

The nonce lives on chain and increments on every successful (or cancelled) recovery. Always read it freshly before starting a recovery; don't cache it.

```ts
import { SpectreClient } from "@spectre-protocol/sdk";

const client = new SpectreClient({
  rpcUrl: "https://sepolia.base.org",
  registryAddress: "0x9cE6Fa1A495b443e236D041f935Bacb5581BbC6B",
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

The user then sends an email **from their registered email address** (the one whose sha256 was stored at `register()` time), with this exact string as the Subject. The body is ignored by the circuit. The recipient is also ignored by the protocol, but it must be a **different inbox** the user can access. Gmail-to-Gmail routing can stay internal to Google's servers, in which case the message never receives an outbound DKIM signature and the proof will fail. Any other address (a second Gmail account, Outlook, ProtonMail, work email) works.

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

## Step 4: Produce a personhood proof

Personhood is the second factor that pairs with the email. Spectre's `IPersonhoodVerifier` interface is adapter-agnostic: the registry calls whichever adapter the agent registered with and tracks the returned nullifier in `usedNullifiers` to prevent replay.

What you pass to the SDK is two opaque values:

- **`personhoodNullifier`** (`bigint`): a per-identity value the registry stores in `usedNullifiers`. Must not collide with one already burned for any agent.
- **`personhoodProof`** (`0x${string}`): opaque bytes the adapter decodes. Format is adapter-specific.

### Testnet: MockPersonhoodAdapter

The Base Sepolia deploy uses `MockPersonhoodAdapter`, which ignores `personhoodProof` entirely. You still need a non-reused nullifier; derive one per attempt:

```ts
import { encodePacked, keccak256 } from "viem";

const personhoodProof: `0x${string}` = "0x";
const personhoodNullifier = BigInt(
  keccak256(
    encodePacked(
      ["address", "address", "uint256", "uint256"],
      [agentOwner, newOwner, nonce, BigInt(Math.floor(Date.now() / 1000))]
    )
  )
);
```

This is testnet-only behaviour. The mock contract is labeled `NEVER deploy to mainnet` in its source.

### Production: ZK Passport (planned)

Mainnet recovery will use a `ZKPassportPersonhoodAdapter` that wraps the deterministic [ZK Passport verifier](https://docs.zkpassport.id/getting-started/onchain). The integrator generates a proof via `@zkpassport/sdk`, binds the recovery signal as `custom_data` via `.bind("custom_data", client.computeSignal(...))`, and passes the SDK output as `personhoodProof`. The ZK Passport unique-identifier becomes `personhoodNullifier`.

The adapter is the next planned integration; for now the testnet path uses the mock and the architecture supports drop-in swap-in through `PersonhoodRegistry`.

### Other adapters

`PersonhoodRegistry` is a governed allowlist. Any contract implementing `IPersonhoodVerifier` can be proposed by the registry's `updater`, confirmed after the propose timelock, and then registered against by any agent via `registerWithAdapter()`. Self.xyz, anonymous credentials, and other personhood schemes all fit the same shape: proof bytes in, identity-derived nullifier out.

## Step 5: Submit the recovery

```ts
const { hash } = await client.initiateEmailRecovery({
  eml,
  agentOwner,
  newOwner,
  nonce,
  personhoodNullifier,
  personhoodProof,
});
```

Behind the scenes this:

1. Calls the configured prover (browser or hosted) to produce the DKIM ZK proof from the `.eml`.
2. Packs the proof and its public inputs into the calldata.
3. Calls `SpectreRegistry.initiateRecovery(agentOwner, newOwner, emailProof, emailPublicInputs, personhoodNullifier, personhoodProof)`.

The on-chain contract verifies:

- The DKIM signature over the email is valid against a registered DKIM key.
- The sha256 of the From address matches `record.emailHash`.
- The Subject contains `spectre:<BigInt(newOwner)>:<nonce>`.
- `personhoodNullifier` has not been used before.
- The agent's chosen personhood adapter accepts `personhoodProof` (revert otherwise).

If any check fails, the transaction reverts and nothing changes on chain. Note that the personhood nullifier is staged at this step, not finalised: if `cancelRecovery` is called the nullifier is released for reuse; only `executeRecovery` keeps it permanently consumed.

## Step 6: Wait the timelock, then execute

```ts
const status = await client.getRecoveryStatus(agentOwner);
// status.executeAfterBlock: block at or after which executeRecovery becomes callable
// status.pendingOwner: the newOwner that's been staged
// status.mode: "EmailPersonhood"
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
| `NullifierAlreadyUsed` | Your `personhoodNullifier` was already consumed by an `executeRecovery`. On the mock adapter, derive a fresh per-attempt value (including a timestamp component). On a real adapter, the user's identity has already recovered some agent and must use a different identity. |
| `AdapterNotApproved` | The agent registered against an adapter that has since been revoked from `PersonhoodRegistry`, or was never approved. The agent must register against an approved adapter (or the default). |

## See also

- [Recovery modes](/recovery-modes): all three modes side by side.
- [Threat model](/threat-model): what the email + personhood combination defends against.
- [Monitoring](/monitoring): how the current owner watches for hostile recoveries during the timelock.
