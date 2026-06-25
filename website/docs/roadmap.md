---
title: Roadmap & Milestones
slug: /roadmap
---

# Roadmap & Milestones

A public record of what Spectre has shipped, what's in flight, and what's deliberately out of scope. Spectre is being built as durable infrastructure, not a hackathon prototype; this page exists so integrators and contributors can see honest progress instead of marketing claims.

## At a glance

| Layer | Status |
| --- | --- |
| Smart contracts (registry, DKIM, personhood, account) | Shipped on Base Sepolia, audited |
| ZK circuit + Solidity verifier | Shipped, VK pinned to deployed verifier |
| TypeScript SDK (`@spectre-protocol/sdk`) | Published, refactor in progress for 0.2.0 |
| Relayer (prover API + notify daemon) | Shipped, hosted at `spectre-relayer.onrender.com` |
| Documentation site | Live at `spectreprotocol.xyz` |
| Base Sepolia testnet | Live, full E2E validated 2026-06-25 |
| Base Mainnet | Planned, gated on personhood adapter |
| Production personhood adapter (ZK Passport) | Planned, next major milestone |

## Built and live

Everything in this section is deployed, audited where audits apply, and exercised end-to-end on Base Sepolia.

### Protocol layer

| Component | What it is | Where |
| --- | --- | --- |
| `SpectreRegistry` | Core registry contract; holds each agent's record and rotates `owner` on successful recovery | Transparent proxy on Base Sepolia |
| Noir circuit + Honk verifier | Proves an RSA-2048 DKIM signature and binds the proof to `(newOwner, nonce)` via the email subject | Verifier deployed, VK pinned |
| `DKIMRegistry` | Governed list of mail-provider RSA keys with propose/confirm timelocks and instant revocation | Deployed; Gmail's current selector trusted |
| `PersonhoodRegistry` | Adapter allowlist with the same governance shape as DKIMRegistry | Deployed |
| `IPersonhoodVerifier` interface | The minimal surface adapters implement (signal, nullifier, opaque proof bytes) | Stable; mock and production adapters target it |
| `MockPersonhoodAdapter` | Testnet default; accepts any input. Clearly labeled "never deploy to mainnet" | Deployed on Base Sepolia |
| `SpectreAccount` | Preview smart-account primitive that consults the registry for authorization and freezes during recovery | Deployed; reference implementation |

### Recovery modes

All three modes are implemented and tested under the same timelock + cancel window:

| Mode | Trigger | Proof required |
| --- | --- | --- |
| Email + Personhood | DKIM-signed recovery email + personhood proof | ZK proof of DKIM signature + adapter-specific personhood proof |
| Backup wallet | Pre-registered backup address | Transaction from the backup wallet |
| Social (M-of-N) | Threshold of guardian approvals | M signatures from configured guardians |

### Off-chain infrastructure

| Component | Status |
| --- | --- |
| TypeScript SDK with browser + hosted prover backends | Published on npm as `@spectre-protocol/sdk@0.1.x` |
| Email confirmation UX gate (one-time-code via Resend) | Live in relayer |
| Notification daemon (watcher + webhook dispatcher, SQLite-backed) | Live in relayer |
| Hosted prover API | Live at `spectre-relayer.onrender.com` |
| Browser prover demo | Live at `spectreprotocol.xyz/test-browser-prover.html` |

### Security posture

| Item | Status |
| --- | --- |
| Internal audit Pass A | Complete |
| Internal audit Pass B | Complete |
| Internal audit Pass C (8 findings) | All remediated and pushed, verified locally |
| Pluggable verifier pattern (`setVerifier` admin path) | Implemented |
| Pause guardian (subtractive emergency role) | Implemented |
| Two-step updater transfer (DKIM and personhood registries) | Implemented |
| Reserved storage gap on upgradeable contract | Implemented |
| Reentrancy hardening: checks-effects-interactions | Implemented |
| Nullifier release on cancel (S4) | Implemented |

### Deployed addresses (Base Sepolia, 2026-06-25)

| Contract | Address |
| --- | --- |
| `SpectreRegistry` (proxy) | `0x9cE6Fa1A495b443e236D041f935Bacb5581BbC6B` |
| `HonkVerifier` | `0xcee25cAb743F26A14E55a635261CCCD98A30749B` |
| `DKIMRegistry` | `0x4Bb1219c5b907045183822A993380be874573EBE` |
| `PersonhoodRegistry` | `0x11a84b7F5a756912F2531ef280C120D57195a9F1` |
| `MockPersonhoodAdapter` | `0x6271dF6524c93c4E2387b172c30477826fB4a536` |

All verified on Basescan.

## In flight

Work currently underway, targeting near-term release.

| Item | Why | Status |
| --- | --- | --- |
| SDK 0.2.0 publish | Breaking change: `initiateEmailRecovery` now takes pluggable `personhoodNullifier` and `personhoodProof` instead of a World-ID-specific object | Code complete, awaiting publish |
| Tutorial repo update | Bump `@spectre-protocol/sdk` dep to 0.2.0 and refresh the recovery script | Code change ready locally; ship after SDK publish |
| Webhook monitoring probe | End-to-end demo of the watcher + dispatcher pipeline against a public webhook endpoint, as evidence for the security model | Optional, planned for the soft-launch article |

## Planned next

The next major milestones, in roughly the order we plan to ship them.

### Production personhood: ZK Passport adapter

A `ZKPassportPersonhoodAdapter` implementing `IPersonhoodVerifier` against ZK Passport's verifier contract (deterministically at `0x1D000001000EFD9a6371f4d90bB8920D5431c0D8` on Ethereum Mainnet, Ethereum Sepolia, and Base Mainnet).

Selection rationale documented separately, but in short: chain-agnostic deterministic verifier, no centralised relying-party context required, dev mode for development, government-rooted identity, larger addressable population than orb-verified personhood schemes.

Open question: ZK Passport is not currently deployed on Base Sepolia. We have requested an integration; the testnet demo path will use `MockPersonhoodAdapter` until that lands.

### Base Mainnet deployment

Gated on:

1. ZK Passport adapter shipped and audited.
2. Production multisig governance configured (Safe for `owner`, `DKIMRegistry.updater`, `PersonhoodRegistry.updater`).
3. Pause guardian assigned to a separate signer for emergency response.
4. Final external audit pass on the v1 surface.

### Account-binding module (ERC-4337 / ERC-7579)

The current path requires integrators to write the auth-check that reads `spectre.getRecord(identity).owner`. The next milestone is shipping a 4337/7579-compatible module that bundles this wiring as a one-line integration.

### Expanded DKIM coverage

Today the testnet `DKIMRegistry` has Gmail proposed. Mainnet launch needs the keys for Microsoft Outlook, Apple iCloud, Yahoo, ProtonMail, and FastMail registered through the governance flow. Each provider's selector is a separate `propose` + 24h timelock + `confirm` cycle.

### Operational monitoring as a service

The notify daemon (watcher + webhook dispatcher) currently runs on the hosted relayer but has no subscribers because there are no end users yet. As integrators wire their apps in, the monitoring surface needs SLA-grade hardening: retry semantics, dead-letter queue, observability dashboards, and a public status page.

## Longer horizon

Beyond the v1 launch surface. These are committed to as direction, not on a fixed timeline.

- **Cross-chain deployment**. ZK Passport's verifier is multi-chain by construction. Once the mainnet adapter is stable, Spectre's contracts deploy to other EVMs without code changes.
- **Hardware wallet as a recovery factor**. A separate `IRecoveryFactor` adapter where the credential is a signed message from a Ledger/Trezor instead of an email.
- **Multi-factor combinations**. The protocol already supports per-agent timelock customisation; future work could allow agents to require multiple factors simultaneously (e.g., email + guardian threshold) for a single recovery.

## Out of scope (v1)

We deliberately do not ship these in v1. Documenting them keeps the protocol surface honest.

| Non-goal | Why |
| --- | --- |
| Gas sponsorship for `register()` or `initiateRecovery()` | A sponsored register endpoint creates a DoS surface (anyone can spam-register). Users pay their own gas. |
| End-user-branded Spectre dashboard | Spectre is infrastructure, not a consumer app. Wrapper UIs are integrators' surface. We may ship a reference dashboard later, but it is a separate product decision. |
| Custodial recovery fallback | Re-introduces a trusted recovery authority, breaking Spectre's positioning. |
| Per-agent admin override | The owner-of-record on an agent record is determined by the protocol's recovery rules. There is no out-of-band override path, by design. |
| Body-content trust in recovery email | The circuit deliberately does not verify the email body. Binding lives in the Subject header. |
| Mutable per-agent timelock floor | The protocol-wide minimum timelock is set at deploy time and cannot be lowered later. |

## Timeline by month

A compressed view of what landed when. Useful context for anyone reading the repo history.

### 2026-04 (Foundation)

- ZK circuit for RSA-2048 DKIM signature verification (Noir).
- First Solidity contracts: registry, recovery modes scaffold, mock World ID adapter.
- TypeScript relayer CLI.
- Initial documentation site (Docusaurus).
- Email + personhood, backup wallet, and social/guardian modes wired.

### 2026-05 (SDK + Docs)

- Documentation site rebuilt with Syne/teal brand system.
- `@spectre-protocol/sdk` 0.1.0 to 0.1.4 published: types, ABI bindings, prover backends, monitoring helpers, recovery UI helpers.
- Browser prover demo shipped on the docs site.
- Hardened recovery: email proof binding, DKIM key gating, immutable timelock policy.
- Audit passes A and B complete.

### 2026-06 (Hardening + Mock Refactor)

- Owner notification system: watcher, dispatcher, queue, subscriptions.
- Browser prover hardening: isomorphic email parser, DKIM via DoH.
- Hosted relayer dockerised and deployed to Render.
- Audit Pass C: all 8 findings remediated, verified locally.
- Pluggable personhood architecture: `MockPersonhoodAdapter` for testnet, World ID adapter removed.
- Full E2E validation on Base Sepolia (2026-06-25): fresh deploy, DKIM key registration, agent registration, recovery initiation, timelock, execution.
- SDK refactor for breaking 0.2.0 release.

### Next (planned)

- SDK 0.2.0 publish.
- ZK Passport adapter implementation and audit.
- Base Mainnet deployment.
- Account-binding module (ERC-4337 / ERC-7579).

## How to track changes to this page

This roadmap is committed to the repository at [`website/docs/roadmap.md`](https://github.com/CECILIA-MULANDI/spectre-protocol-base-evm/blob/main/website/docs/roadmap.md). Every change goes through a normal commit, so the page's edit history is the actual project history. If a milestone slips or scope changes, the commit explaining why is one click away.
