---
title: Why Spectre?
slug: /why-spectre
---

# Why Spectre?

Recovery for an autonomous on-chain agent isn't a "small contract" problem. It's a stack:

- a ZK circuit that proves a DKIM-signed email without revealing it,
- a governed registry of mail-provider RSA keys that has to be kept current,
- an adapter framework for personhood proofs,
- the timelock, nonce, and nullifier interlock that makes the cancel window safe,
- monitoring infrastructure that turns "anyone can initiate" into "you actually have time to react."

Spectre ships all of it as one cohesive system. This page is the inventory of what you get when you build on Spectre instead of building each piece yourself.

## What you get

| Component | What it does |
| --- | --- |
| **`SpectreRegistry`** | The on-chain contract that holds each agent's record and rotates `owner` on successful recovery. Deployed behind a Transparent proxy with governed upgrades. |
| **Noir circuit + Honk verifier** | The ZK circuit that verifies an RSA-2048 DKIM signature and binds the proof to a specific `(newOwner, nonce)`. The deployed verifier has a pinned, verifiable VK. |
| **`DKIMRegistry`** | A governed list of mail-provider RSA keys with propose/confirm timelocks and instant revocation. Spectre's job, not yours, to keep current as Gmail, Outlook, Proton, and FastMail rotate their keys. |
| **`PersonhoodRegistry`** | An adapter framework with propose/confirm governance. Testnet runs `MockPersonhoodAdapter`; mainnet will run a ZK Passport adapter. New adapters (Self.xyz, BrightID) can be approved without redeploying the protocol. |
| **TypeScript SDK** | `@spectre-protocol/sdk` for register, recover, cancel, execute, read, and event subscription. Browser-side or hosted prover. |
| **Hosted prover + email relayer** | Optional service that parses `.eml` files, generates ZK proofs, and sends recovery-email challenges. Run your own or use the Spectre-hosted instance. |

## What's coming next

- An **account-binding module** that wires Spectre's `owner` field to a smart account in one deploy, so integrators don't write the auth-check by hand. See [Quickstart's integration patterns](/quickstart#before-you-call-register-pick-an-integration-pattern).
- Additional **personhood adapters** (zkPassport, BrightID) onboarded through the governed propose/confirm flow.
- **EVM deployments beyond Base** as demand justifies.

## See also

- [Quickstart](/quickstart): install the SDK, register, recover.
- [Recovery modes](/recovery-modes): pick which paths to arm.
- [Threat model](/threat-model): what Spectre trusts and what it doesn't.
