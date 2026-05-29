---
title: Introduction
slug: /intro
---

# What is Spectre?

Spectre is a **zero-knowledge account recovery primitive** for AI agents on Base. It lets an agent owner rotate the key controlling their agent without seed phrases, custodians, or trusted third parties.

## The problem

Agents need owners. Owners lose keys. Traditional crypto recovery options (write down a seed phrase, trust an exchange, hope a multisig has enough surviving signers) don't fit autonomous agents that need to keep operating across long time horizons. We want recovery that:

- doesn't depend on a custodian who can be subpoenaed, hacked, or rate-limited,
- doesn't require the owner to safeguard secrets they're likely to lose,
- and stays usable years after setup, even if the recovery flow's dependencies (email providers, identity systems) have changed underneath.

## The shape of the solution

Spectre is a registry contract. Each agent record stores an `owner` address and metadata for how that owner can be rotated. A successful recovery flow rotates `owner` to a new address, atomically.

There are three recovery modes. Set them up independently and use whichever still works for you:

| Mode | Trigger | Proof material |
| --- | --- | --- |
| **Email + Personhood** | Anyone with the owner's email plus a personhood proof | DKIM ZK proof and personhood proof |
| **Backup wallet** | A pre-registered backup address | A transaction from the backup wallet |
| **Social (M-of-N)** | Guardian consensus | M independent guardian approvals |

Every successful recovery passes through a **timelock**. The current owner can cancel during the timelock window if the recovery is fraudulent.

## What Spectre is *not*

Worth saying upfront so you set the right expectations:

- **Not an account abstraction wallet.** Spectre rotates the owner key. What the owner *is* (an EOA, a smart account, the controller of an ERC-4337 account) is up to you. The next milestone is an account-binding module that pairs Spectre with an existing account implementation.
- **Not gas-sponsored.** Users pay their own gas to register and recover. v1 deliberately skips sponsored transactions. See [Threat model](/threat-model#deliberate-non-scopes).
- **Not opinionated about personhood.** Spectre uses World ID as a deploy-time default, but new personhood adapters (zkPassport, BrightID, etc.) can be added without contract changes via a governed propose/confirm flow.

## Where to next

- **[Quickstart](/quickstart)**: install the SDK and walk through register, then recover.
- **[Recovery modes](/recovery-modes)**: choose which modes to arm.
- **[Threat model](/threat-model)**: what Spectre trusts and what it doesn't.
