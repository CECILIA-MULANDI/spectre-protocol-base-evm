---
title: Monitoring
slug: /monitoring
---

# Monitoring

If you operate an agent registered with Spectre, you must watch for hostile recovery attempts. The cancel window is your protection. Without monitoring, an attacker who initiates a recovery against your agent will execute it after the timelock without you noticing.

This page covers three ways to monitor, in order of effort.

:::warning[The cancel window is your protection]

The current owner can call `cancelRecovery(agentOwner)` at any point before `executeRecovery` lands. If the timelock elapses without a cancel, anyone can finalise the recovery and the agent's owner rotates. The window is the value of `timelockBlocks` set at registration (10 blocks minimum on testnet, 7200 blocks ≈ 24h on mainnet).

:::

## Option 1: SDK in-process watcher (recommended for backends)

The SDK ships `client.watchRecovery()` which subscribes to the three recovery lifecycle events over your configured RPC. No third party in the path, no infrastructure to run beyond your existing service.

```ts
import { SpectreClient } from "@spectre-protocol/sdk";

const client = new SpectreClient({
  rpcUrl: "https://sepolia.base.org",
  registryAddress: "0xBe53383054Fda41A9F71b8593384144c367b01A1",
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
  prover: { type: "hosted", url: "https://relayer.spectreprotocol.xyz" },
});

const unwatch = client.watchRecovery({
  agentOwner: "0xMyAgentOwner...",
  onInitiated: async (event) => {
    console.log("recovery initiated", event);
    // event = { agentOwner, newOwner, executeAfterBlock, mode, txHash, blockNumber }
    // page on-call, look at the dashboard, decide if it's legitimate
    if (isFraudulent(event)) {
      await client.cancelRecovery(event.agentOwner);
    }
  },
  onCancelled: (event) => console.log("recovery cancelled", event),
  onExecuted: (event) => console.log("recovery executed", event),
});

// Later, on shutdown:
unwatch();
```

Pass `agentOwner` to filter to one agent, or omit it to watch every agent in the registry (useful if you operate many agents from one service).

The watcher lives in-process and only fires while your service is running. If your service restarts, you'll miss events that landed during downtime. For persistent delivery, use Option 2.

## Option 2: Hosted webhook subscription (recommended for production)

The Spectre relayer offers a `/subscribe` API: register a webhook URL once, the relayer indexes the chain and POSTs to your endpoint when a recovery is initiated. Persistence and retries are handled server-side.

```ts
// One-time setup (signed by the agent owner key)
await client.notify.subscribe({
  endpoint: "https://hooks.example.com/spectre",
  // agentOwner defaults to the address derived from the client's key
});

// Inspect the active subscription
const sub = await client.notify.getSubscription(myAgentOwner);

// Tear it down
await client.notify.unsubscribe(myAgentOwner);
```

Your webhook receives an HTTP POST with a JSON body of shape `RecoveryAlert`:

```json
{
  "type": "RecoveryInitiated",
  "agentOwner": "0x...",
  "newOwner": "0x...",
  "executeAfterBlock": "12345678",
  "mode": "EmailPersonhood",
  "txHash": "0x...",
  "blockNumber": "12345670",
  "chainId": 84532,
  "cancelInstructions": "If this was not initiated by you, call cancelRecovery(0x...) from your owner key BEFORE block 12345678."
}
```

Your endpoint should respond `2xx` quickly; the relayer retries up to its configured maximum on non-2xx or timeout. Want email instead of a webhook? Run a webhook-to-email bridge (Cloudflare Worker, AWS Lambda, Zapier) against your hosted relayer.

## Option 3: Roll your own indexer

If you already run an event-indexing pipeline (a Subgraph, a Goldsky/Envio job, a custom RPC worker), you don't need anything from Spectre. Subscribe to the three lifecycle events directly.

```ts
import { createPublicClient, http, parseAbiItem } from "viem";
import { baseSepolia } from "viem/chains";

const client = createPublicClient({ chain: baseSepolia, transport: http() });

const unwatch = client.watchContractEvent({
  address: "0xBe53383054Fda41A9F71b8593384144c367b01A1",
  event: parseAbiItem(
    "event RecoveryInitiated(address indexed owner, address indexed newOwner, uint64 executeAfterBlock, uint8 mode)"
  ),
  args: { owner: "0xMyAgentOwner..." },
  onLogs: (logs) => {
    /* ... */
  },
});
```

## Event reference

The contract emits these recovery-lifecycle events. All three are indexed by `owner` so filtering is cheap.

| Event               | Signature                                                                                 | Meaning                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RecoveryInitiated` | `(address indexed owner, address indexed newOwner, uint64 executeAfterBlock, uint8 mode)` | A recovery has been staged. `executeAfterBlock` is the block at or after which `executeRecovery` becomes callable. `mode` is `1=EmailPersonhood`, `2=Social`, `3=Backup`. |
| `RecoveryCancelled` | `(address indexed owner)`                                                                 | A pending recovery was aborted. The nonce increments; any in-flight proofs are invalidated.                                                                               |
| `RecoveryExecuted`  | `(address indexed owner, address indexed newOwner)`                                       | The timelock elapsed and the owner has rotated.                                                                                                                           |

Configuration events (`AgentRegistered`, `BackupWalletSet`, `GuardiansSet`, `GuardianApproved`) are emitted too. Watch them if you also want to track agent setup; they aren't required for the safety loop.

## `/subscribe` API reference

The hosted relayer exposes three endpoints. Auth is an EIP-191 signature from the agent owner key over a canonical message.

### `POST /subscribe`

Request body:

```json
{
  "agentOwner": "0x...",
  "endpoint": "https://hooks.example.com/spectre",
  "nonce": "random-hex-string",
  "signature": "0x...",
  "accountAddress": "0x..."
}
```

`accountAddress` is optional. Include it if the alert should also reference a `SpectreAccount` (or other smart-account) bound to this owner.

Canonical message:

```
Spectre subscribe
agent: <agentOwner lowercased>
endpoint: <endpoint>
account: <accountAddress lowercased | "none">
nonce: <nonce>
```

Including `endpoint` in the signed payload prevents a stolen signature from being replayed against a different URL.

### `GET /subscribe/:agentOwner`

Public read. Returns the current subscription or `404`. Subscriptions are not secret; exposing them lets anyone audit who's listening.

### `DELETE /subscribe/:agentOwner`

Request body:

```json
{ "nonce": "random-hex", "signature": "0x..." }
```

Canonical message:

```
Spectre unsubscribe
agent: <agentOwner lowercased>
nonce: <nonce>
```

### Rate limits

Mutating endpoints have a per-IP token bucket: 10 burst, 1/s sustained. Reads are unmetered.

## See also

- [Recovery modes](/recovery-modes): which modes can produce `RecoveryInitiated` events.
- [Threat model](/threat-model#observability-obligations): why monitoring is positioned as a hard requirement.
- [Quickstart](/quickstart): registering and arming the recovery paths.
