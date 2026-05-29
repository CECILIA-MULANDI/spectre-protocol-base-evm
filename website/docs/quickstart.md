---
title: Quickstart
slug: /quickstart
---

# Quickstart

End-to-end: install the SDK, register an agent, set up a backup wallet, and run a recovery.

## Install

```bash
npm install @spectre-protocol/sdk viem
```

The SDK depends on [viem](https://viem.sh) for chain interaction.

## Configure a client

```ts
import { SpectreClient } from "@spectre-protocol/sdk";

const client = new SpectreClient({
  rpcUrl: "https://sepolia.base.org",
  registryAddress: "0x...",         // SpectreRegistry on Base Sepolia
  privateKey: "0x...",              // your owner key
  prover: {
    type: "hosted",
    url: "https://relayer.spectreprotocol.xyz",
  },
  // relayerUrl defaults to prover.url when prover.type === "hosted"
});
```

For a production app, swap to `prover: { type: "browser", circuitUrl, circuitDigest }` so the ZK proof is generated in the user's browser instead of on a relayer. The hosted prover is for development and as a fallback.

## Step 1: Confirm the email

Before registering, confirm the user actually controls the email address. This is a UX guardrail; the on-chain contract does **not** enforce it. The relayer sends a one-time code, and the UI gates the register button on a successful verify.

```ts
const { challenge, verify } = client.confirmEmail("alice@example.com");

await challenge();                       // user receives a 6-digit code
const ok = await verify(userTypedCode);  // returns true or false
if (!ok) throw new Error("Email confirmation failed");
```

## Step 2: Register an agent

```ts
const result = await client.register("alice@example.com");
// → { hash, receipt, emailHash }
```

This sets up **Mode 1 (Email + Personhood)** for the address that signed the transaction. The agent's `owner` becomes `msg.sender`. The email is stored on-chain only as `sha256(email.toLowerCase().trim())`; the plaintext never touches the chain.

After this transaction, the user can recover via email and personhood. Other modes (backup, guardians) are off until armed separately.

## Step 3: Add a backup wallet (optional)

A second key the user controls. If their primary key is lost but the backup is reachable, recovery is one transaction.

```ts
await client.setBackupWallet("0xMyBackupAddress");
```

Now **Mode 2 (Backup)** is armed.

## Step 4: Add social guardians (optional)

M-of-N humans who can collectively recover on the user's behalf.

```ts
await client.setGuardians(
  ["0xAlice...", "0xBob...", "0xCarol..."],
  2,  // threshold: 2-of-3
);
```

Now **Mode 3 (Social)** is armed.

## Step 5: Recover via email

Recovery happens in two on-chain steps separated by a timelock.

```ts
// 5a. Generate the ZK proof from a .eml file the user sends
//     to themselves with subject `spectre:<newOwnerAsBigInt>:<nonce>`.
const eml = await fetch("/recovery-email.eml").then(r => r.bytes());

await client.initiateEmailRecovery({
  eml,
  agentOwner:  "0xOldOwner...",
  newOwner:    "0xNewOwner...",
  nonce:       1n,
  worldIdProof,
});

// 5b. Wait for the timelock. The current owner can cancel during this window.
//     Check getRecoveryStatus to see executeAfterBlock.
const status = await client.getRecoveryStatus("0xOldOwner...");
console.log(`Recovery can execute after block ${status.executeAfterBlock}`);

// 5c. Once the timelock elapses, anyone can finalize.
await client.executeRecovery("0xOldOwner...");
```

After `executeRecovery`, the agent's `owner` is `0xNewOwner...`. The `nonce` increments so old proofs can't be replayed.

## Cancelling a fraudulent recovery

If the current owner sees a recovery they didn't initiate (e.g., via on-chain notification), they cancel it:

```ts
await client.cancelRecovery("0xMyOwnerAddress");
```

This works only before `executeRecovery` lands. The timelock window is configured per-agent at registration.

## Next steps

- Pick which modes to arm in [Recovery modes](/recovery-modes).
- Understand what Spectre trusts (and what it doesn't) in [Threat model](/threat-model).
