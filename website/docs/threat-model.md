---
title: Threat model
slug: /threat-model
---

# Threat model

Spectre is recovery infrastructure for accounts that hold value. This page lays out what the protocol trusts, what it doesn't, and what is deliberately out of scope. If you're integrating Spectre into something with real assets, **read this page first**.

## What Spectre trusts

These are the **deploy-time trust anchors**. Compromising any of them is a critical incident.

### The ZK verifier

`SpectreRegistry` calls into a single ZK verifier contract for proof verification. The verifier address is stored on-chain and can only be changed by the proxy admin via an upgrade.

Trusting the verifier means trusting:

- The Noir circuit code in `circuits/src/main.nr`
- The verifying key embedded in the deployed `Verifier.sol`
- That circuit and verifier pinning is correct (the circuit digest matches what the verifier accepts)

### The default personhood adapter

Spectre uses a default `IPersonhoodVerifier` for proofs of human-ness. On the Base Sepolia testnet deploy this is `MockPersonhoodAdapter` (no real personhood check, clearly labeled as testnet-only). The mainnet deploy will use ZK Passport via `ZKPassportPersonhoodAdapter`. The default address is set at `initialize` and can only be replaced via a proxy upgrade.

A user-chosen adapter (via `registerWith(...)`) must be approved in the `PersonhoodRegistry`. See [Recovery modes](/recovery-modes#mode-1-email--personhood). New adapters go through a public propose/confirm timelock before becoming usable.

### The DKIM registry

`SpectreRegistry` only accepts email proofs that were signed by an RSA key whose hash is in the `DKIMRegistry`. New keys go through a public propose/confirm timelock. Revocations are instant.

Trusting the DKIM registry means trusting:

- Whoever holds the `updater` key isn't malicious or compromised
- The propose/confirm window is long enough for observers to notice bad proposals

### The proxy admin

`SpectreRegistry`, `DKIMRegistry`, and `PersonhoodRegistry` are upgradeable behind transparent proxies. The proxy admin can swap implementations. In v1 the admin is an EOA; before mainnet this becomes a multisig with its own timelock.

## What Spectre does *not* trust

### The user's email plaintext

The chain never sees the email. Only `sha256(email.toLowerCase().trim())` is stored. The relayer that parses incoming emails for proof generation sees the email content but is **not in the trust path**. The proof itself enforces every constraint, and a malicious relayer can only fail to generate a proof, not forge one.

### The relayer's email-confirmation service

The `/email/challenge` and `/email/verify` endpoints exist so a UI can prevent users from accidentally registering hashes of email addresses they don't control. The on-chain contract does not check this. A user with technical comfort can register any hash by calling the contract directly. The email-confirmation step is a *product UX safeguard*, not a *protocol guarantee*.

### The email content itself

Recovery binds to the email's `Subject:` header, not its body. The body can be anything the sender's mail client produces (multipart, signatures, replies). The DKIM signature commits to a body hash, so we *know* it's untampered, but we don't *read* it.

## What the backup wallet means

When `setBackupWallet(addr)` is called, that address gains the power to recover the agent. It is **functionally a second root key**.

If the backup wallet key is stolen, the attacker can:

1. Call `initiateBackupRecovery(agentOwner, attackerAddress)` immediately.
2. Wait out the timelock.
3. Call `executeRecovery` and become the new owner.

The legitimate owner's only defense in that window is to call `cancelRecovery`. If they don't notice, the recovery succeeds.

Choose the backup wallet with the same care as the primary owner. Don't pick a wallet you've used elsewhere or one stored on the same machine as the primary key.

## Owner-key compromise scenarios

| Scenario | What Spectre does | What you should do |
| --- | --- | --- |
| Attacker steals owner key but you still control email and personhood | They can change config (`setBackupWallet`, `setGuardians`) instantly. They can initiate any recovery instantly. | Watch for `RecoveryInitiated` events. Call `cancelRecovery` immediately. Then call `initiateRecovery` yourself to rotate to a clean key. |
| Attacker steals owner key AND email | They can initiate Mode 1 recovery and add a fake personhood proof if your adapter is weak. The personhood proof is the last line of defense. | Same as above, but the cancel window is your only chance. Make `timelockBlocks` generous (`registerWithCustomTimelock`). |
| You lose owner key, still have email | Recover via Mode 1. | Generate ZK proof plus personhood proof, call `initiateRecovery`, wait timelock, call `executeRecovery`. |
| You lose owner key and email, have backup | Recover via Mode 2. | Call `initiateBackupRecovery` from backup wallet, wait timelock, call `executeRecovery`. |
| You lose owner key, email, and backup; still have guardians | Recover via Mode 3. | M guardians call `approveGuardianRecovery`, wait timelock, anyone calls `executeRecovery`. |

## Deliberate non-scopes

These are things Spectre **does not do**, by design. They are not bugs.

### Gas sponsorship

Users pay their own gas to register and recover. Sponsored registration would create a DoS surface, because the relayer can't distinguish real users from spammers when `emailHash` is opaque by design (privacy). Mitigating that DoS would require rate limiting, CAPTCHAs, or paid tiers. None of those fit a "recovery primitive" framing. May be added later via ERC-2771 or ERC-4337 wrappers without contract changes.

### Email body content verification

The recovery binding lives in the `Subject:` header, not the body. The body can be anything. This is what makes the protocol work with normal mail clients (Gmail's multipart, Outlook's signature blocks, threaded replies) without ZK constraints over arbitrary body content.

### Account-binding

Spectre rotates the `owner` field on a registry record. What that owner *controls* (an EOA's actions, a smart account, a 4337 wallet) is the application's responsibility. An account-binding module that pairs Spectre with an existing account implementation is the stated next milestone.

### Pre-registration email-ownership proof

Spectre doesn't require a DKIM proof at `register()` time. You could register the hash of an email address you don't control. You'd just make your own agent unrecoverable, hurting no one else. The relayer's `/email/challenge` flow is the recommended UX safeguard for this footgun. It is not a protocol-level check.

## Observability obligations

If you operate an agent registered with Spectre, you (or your monitoring) must watch for:

- **`RecoveryInitiated`** events on `SpectreRegistry` filtered by your `agentOwner`. The timelock window is your only chance to call `cancelRecovery` against a fraudulent attempt.
- **`KeyProposed`** events on `DKIMRegistry` and **`AdapterProposed`** events on `PersonhoodRegistry`. The propose/confirm window is the global observation period for governance actions.

The relayer's notification API (`/subscribe`) can push these to you over email or webhook. See `relayer/src/notify/`.
