---
title: Introduction
slug: /intro
---

# What is Spectre?

Spectre is a **zero-knowledge account recovery primitive** for autonomous on-chain agents. It lets an agent owner rotate the key controlling their agent without seed phrases, custodians, or trusted third parties.

:::warning[Read this before you integrate]

Spectre v1 is a **registry**, not a wallet. The on-chain contract holds a mapping of `identity → { owner, ... }` and rotates `owner` when recovery succeeds. **Nothing else changes automatically.**

For this rotation to actually protect your agent, your agent must be a **smart contract** that reads `spectre.getRecord(identity).owner` for authorization. Raw EOAs (a private key in a `.env` file, a Python bot signing transactions directly) **cannot be recovered by Spectre**. They can't be recovered by any other system either, because EOA private keys are immutable.

An account-binding module that ships this wiring as one-line integration is the [next milestone](#what-spectre-is-not). Until then, you write the auth-check yourself. See the [Quickstart's integration patterns](/quickstart#before-you-call-register-pick-an-integration-pattern).

:::

## The problem

Agents need owners. Owners lose keys. Each traditional option for restoring access fails in its own way:

- **Seed phrases** put the entire account on a single piece of paper. Lost paper, lost agent. Stolen paper, stolen agent.
- **Exchange custody** trades self-sovereignty for a custodian who can be subpoenaed, frozen, or hacked.
- **Plain multisigs** work until enough signers go silent for the threshold to fail, which gets more likely as the years pass.

What we want is a structurally better answer to the same problem: not "no dependencies," but **dependencies that are designed to fail safely**.

- **Multiple independent recovery paths**, so losing any one doesn't end the agent.
- **Distributed or self-controlled trust**, not a single custodian or single fragile secret.
- **Governed, swappable infrastructure**, so the recovery flow can absorb changes (a mail provider rotating DKIM keys, an identity system being replaced) without redeploying the protocol.

Spectre offers three recovery modes that map to those properties. Arm one, two, or all three; whichever still works at recovery time is the one you use.

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

- **Not an account abstraction wallet.** Spectre rotates the owner key. What the owner *is* (an EOA, a smart account, the controller of an ERC-4337 account) is up to you. A preview minimal account (`SpectreAccount`) ships with the repo today; the production ERC-4337 / ERC-7579 modules are the next milestone.
- **Not gas-sponsored.** Users pay their own gas to register and recover. v1 deliberately skips sponsored transactions. See [Threat model](/threat-model#deliberate-non-scopes).
- **Not opinionated about personhood.** Spectre's `IPersonhoodVerifier` interface is the integration point; the testnet deploy uses `MockPersonhoodAdapter` for fast dev iteration, mainnet will use ZK Passport, and new adapters (Self.xyz, BrightID, etc.) can be added without contract changes via a governed propose/confirm flow.

## Current implementation

Spectre v1 is deployed on **Base** (Sepolia today, mainnet next). The protocol is chain-agnostic; additional EVM deployments will follow.

## Where to next

- **[Quickstart](/quickstart)**: install the SDK and walk through register, then recover.
- **[Why Spectre?](/why-spectre)**: what you'd have to build yourself to match this, and when rolling your own is rational.
- **[Recovery modes](/recovery-modes)**: choose which modes to arm.
- **[Threat model](/threat-model)**: what Spectre trusts and what it doesn't.
