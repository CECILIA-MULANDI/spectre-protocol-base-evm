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
  registryAddress: "0xBe53383054Fda41A9F71b8593384144c367b01A1", // SpectreRegistry on Base Sepolia
  privateKey: "0x...", // your owner key
  prover: {
    type: "hosted",
    url: "https://relayer.spectreprotocol.xyz",
  },
  // relayerUrl defaults to prover.url when prover.type === "hosted"
});
```

For a production app, you can swap to `prover: { type: "browser", circuitUrl, circuitDigest }` so the ZK proof is generated in the user's browser instead of on a relayer. The hosted prover is for development and as a fallback.

## Before you call `register()`: pick an integration pattern

This is the most important section on this page. Skip it and you'll likely wire Spectre up in a way that does nothing useful for your agent.

### The mental model

When you call `register()`, **`msg.sender` becomes the immutable lookup key** for the agent's record. That key never changes, not even after recovery. What recovery rotates is the **`owner` field** on the record. So a record always looks like:

```
spectre.getRecord(identityAddress) → { owner, emailHash, nonce, ... }
                          ▲                ▲
                          │                │
                  immutable forever   rotates on recovery
```

Your agent's authorization logic must look up `spectre.getRecord(identityAddress).owner` to find out *who currently controls the agent*. It must **not** assume `identityAddress` itself is still the signer.

### The auth-check pattern (this is what makes Spectre do anything)

Spectre on its own only rotates a value in storage. For that rotation to control your agent, your agent must be a smart contract that consults Spectre:

```solidity
interface ISpectreRegistry {
    struct AgentRecord {
        bytes32 emailHash;
        address owner;
        // ...other fields
    }
    function getRecord(address identity) external view returns (AgentRecord memory);
}

contract MyAgent {
    ISpectreRegistry public immutable spectre;
    address public immutable identity; // set at deploy; never changes

    constructor(ISpectreRegistry _spectre, address _identity) {
        spectre = _spectre;
        identity = _identity;
    }

    modifier onlyOwner() {
        require(
            msg.sender == spectre.getRecord(identity).owner,
            "not authorized"
        );
        _;
    }

    function executeTrade(/* ... */) external onlyOwner {
        // ...
    }
}
```

If your "agent" is a raw EOA (a private key in a `.env` file, a bot script signing directly), **Spectre cannot recover it**. There is no `owner` field on an EOA to rotate. This is a property of EVM accounts, not a Spectre limitation. To use Spectre, the asset-holder must be a smart contract.

### The three integration patterns

The address that calls `register()` is your agent's *durable identity* in Spectre. Pick the pattern that matches your architecture:

| Pattern | Who signs `register()` | Best for |
| --- | --- | --- |
| **User-side onboarding (UI)** | The human user's wallet via wallet-connect | Web apps where each user connects their own wallet |
| **Programmatic bootstrap** | A backend key or deploy script | Hosted agent platforms; agent factories |
| **Self-registration** | The agent's own EOA on first run | Sovereign agents whose key is its own identity |

Each pattern has different recovery semantics:

- *User-side*: the human recovers their own access. Most common shape.
- *Programmatic*: the operator recovers, not the end user. Custodial.
- *Self-registration*: whoever holds the email + personhood proof becomes the new owner. The agent's key is its own death-switch.

### `SpectreAccount`: a preview primitive you can use today

The pattern above (rolling your own auth-check) is the supported path for arbitrary integrations. If you want a minimal smart account that's already wired to Spectre, the repo ships a preview primitive: [`SpectreAccount.sol`](https://github.com/CECILIA-MULANDI/spectre-protocol-base-evm/blob/main/contracts/src/SpectreAccount.sol). It reads `registry.getRecord(agentId).owner` for every call and reverts while a recovery is pending, so a thief with the current key can't drain during the timelock.

It's a preview, not a production-blessed module. The full ERC-4337 / ERC-7579 modules are the next milestone; until then, audit `SpectreAccount` yourself if you plan to hold value in one.

## Step 1: Confirm the email

Before registering, confirm the user actually controls the email address. This is a UX guardrail; the on-chain contract does **not** enforce it. The relayer sends a one-time code, and the UI gates the register button on a successful verify.

```ts
const { challenge, verify } = client.confirmEmail("alice@example.com");

await challenge(); // user receives a 6-digit code
const ok = await verify(userTypedCode); // returns true or false
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
  2 // threshold: 2-of-3
);
```

Now **Mode 3 (Social)** is armed.

## Step 5: Recover via email

Recovery happens in two on-chain steps separated by a timelock. The shape:

```ts
// Read the current nonce; it increments on every successful or cancelled
// recovery, so always fetch fresh rather than caching.
const record = await client.getRecord(agentOwner);

await client.initiateEmailRecovery({
  eml,                       // Uint8Array of the user's .eml file
  agentOwner,
  newOwner,
  nonce: record.nonce,
  worldIdProof,              // shape: { root, nullifier_hash, proof[8] }
});

// Watch the timelock. The current owner can cancel during this window.
const status = await client.getRecoveryStatus(agentOwner);
console.log(`Recovery executes at block ${status.executeAfterBlock}`);

// Once block.number >= executeAfterBlock, anyone can finalise.
await client.executeRecovery(agentOwner);
```

The two non-trivial inputs are the `.eml` (the user has to produce it from their email provider) and the `worldIdProof` (the user has to generate it in World App, with a signal that binds to the same `(agentOwner, newOwner, nonce)` tuple). Both have exact formatting requirements; the SDK ships helpers for each binding step.

For the full walkthrough including Subject formatting, provider-by-provider `.eml` download instructions, and the World ID integration, see **[Recovering with Email + World ID](/recovering-with-email)**.

After `executeRecovery`, the agent's `owner` is the new address and `record.nonce` has incremented, invalidating any old proofs.

## Cancelling a fraudulent recovery

If the current owner sees a recovery they didn't initiate (e.g., via on-chain notification), they cancel it:

```ts
await client.cancelRecovery("0xMyOwnerAddress");
```

This works only before `executeRecovery` lands. The timelock window is configured per-agent at registration.

## Next steps

- Pick which modes to arm in [Recovery modes](/recovery-modes).
- Understand what Spectre trusts (and what it doesn't) in [Threat model](/threat-model).
