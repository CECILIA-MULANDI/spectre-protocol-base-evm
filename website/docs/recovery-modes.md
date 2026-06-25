---
title: Recovery modes
slug: /recovery-modes
---

# Recovery modes

Spectre has three recovery modes. They aren't ranked; they are **alternative paths into the same shared timelock + execute machinery**. Arm one, two, or all three. Whichever still works for you at recovery time is the one to use.

## Mode 1: Email + Personhood

**Always armed after `register()`.** This is the default mode and the one no agent can opt out of.

| | |
| --- | --- |
| **Armed by** | `client.register(email)` |
| **Triggered by** | Anyone holding the recovery email plus a fresh personhood proof |
| **Proof required** | ZK proof of DKIM-signed email and personhood proof (testnet: `MockPersonhoodAdapter`; mainnet: ZK Passport) |
| **On-chain call** | `initiateRecovery(...)` |

The user sends an email from their registered email address to any other inbox they can access, with subject `spectre:<newOwnerAsBigInt>:<nonce>`. The recipient is not checked by the protocol, but the email must actually leave the user's mail provider so the outbound DKIM signature is applied. The relayer (or browser prover) generates a ZK proof that the email was signed by the email provider's DKIM key, that it came from the registered email address, and that the subject contains the binding to `newOwner` and `nonce`. The personhood proof binds the recovery to a real human, gated by whatever adapter the agent registered with.

Both proofs are required in the same transaction. Email alone would be weak (DKIM key rotation, compromised mail account). Personhood alone would be weak (Sybil-resistant doesn't mean *this specific person's account*). Combined, they say "this is a real human AND they control the registered email."

## Mode 2: Backup wallet

A second key the user controls, registered ahead of time.

| | |
| --- | --- |
| **Armed by** | `client.setBackupWallet(addr)` |
| **Triggered by** | The backup wallet itself (`msg.sender == backupWallet`) |
| **Proof required** | None beyond the transaction signature |
| **On-chain call** | `initiateBackupRecovery(agentOwner, newOwner)` |

Simplest mode. No proof generation, no relayer dependency. Suitable when the user can credibly keep two keys safe (a hot key and a cold backup).

The backup wallet's power is **equivalent to the primary owner** during recovery. Choose it as carefully as the primary key. Anyone who controls the backup can recover the agent. See [threat model](/threat-model#what-the-backup-wallet-means).

## Mode 3: Social (M-of-N guardians)

A set of trusted addresses who can collectively recover on the user's behalf.

| | |
| --- | --- |
| **Armed by** | `client.setGuardians([addr1, addr2, ...], threshold)` |
| **Triggered by** | Each guardian, independently |
| **Proof required** | M independent transactions from M distinct guardians |
| **On-chain call** | `approveGuardianRecovery(agentOwner, newOwner)` × threshold |

Each guardian calls `approveGuardianRecovery(agentOwner, newOwner)`. When the M-th distinct guardian votes for the same `(agentOwner, newOwner)` pair, the recovery is initiated and the timelock starts.

Use when the user has people they trust more than they trust their own ability to safeguard a key: family, co-founders, a multisig of friends.

## Comparison

| | Mode 1 (Email) | Mode 2 (Backup) | Mode 3 (Social) |
| --- | --- | --- | --- |
| Always available? | ✓ | Optional | Optional |
| External dependencies | DKIM, personhood adapter | None | Each guardian must be reachable |
| Setup steps | 1 (register) | 2 (register + setBackup) | 2 (register + setGuardians) |
| Relayer needed? | For email parsing and prover (optional) | No | No |
| Gas cost to trigger | High (proof verification) | Low | Medium (one tx per guardian) |
| Best when | The user has email but lost the key | The user has a second key | The user trusts a small circle |

## The shared timelock

Whichever mode triggers, the same shape applies:

1. `initiate...` stages `pendingOwner = newOwner`, records `recoveryInitBlock = currentBlock`.
2. The timelock window runs (`timelockBlocks`, set at registration).
3. During the window, the current owner can call `cancelRecovery(agentOwner)` and the staging clears.
4. After the window elapses without a cancel, **anyone** can call `executeRecovery(agentOwner)` and the rotation finalizes.

Only one recovery can be in flight at a time. If a Mode 1 recovery is staged and the current owner cancels it, the slot frees up and the next attempt can use any mode.

## Which modes should I set up?

If your agent holds anything valuable, arm at least two. Email alone fails if your provider rotates DKIM in an unsupported way. The backup alone fails if you lose the backup key. Guardians alone fail if too many guardians are unreachable. Redundancy is the point.

Recommended baseline for an agent users care about:

- **Mode 1**: always on. No choice here.
- **Mode 2**: a backup wallet stored in a hardware wallet or a separate machine.
- **Mode 3**: 2-of-3 guardians who can reach each other if needed.
