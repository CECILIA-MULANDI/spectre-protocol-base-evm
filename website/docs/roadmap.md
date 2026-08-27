---
title: Roadmap
slug: /roadmap
---

# Roadmap

Spectre is deployed on Base Sepolia today. Base Mainnet is gated on the ZK Passport personhood adapter and a final external audit pass. Everything else on this page is either a public contract you can call now, an explicit next milestone, or an explicit non-goal.

## Deployed contracts (Base Sepolia)

| Contract | Address |
| --- | --- |
| `SpectreRegistry` (proxy) | `0x9cE6Fa1A495b443e236D041f935Bacb5581BbC6B` |
| `HonkVerifier` | `0xcee25cAb743F26A14E55a635261CCCD98A30749B` |
| `DKIMRegistry` | `0x4Bb1219c5b907045183822A993380be874573EBE` |
| `PersonhoodRegistry` | `0x11a84b7F5a756912F2531ef280C120D57195a9F1` |
| `MockPersonhoodAdapter` (testnet only) | `0x6271dF6524c93c4E2387b172c30477826fB4a536` |

All verified on Basescan. `MockPersonhoodAdapter` is labeled "NEVER deploy to mainnet" in its source and is only registered for testnet convenience.

## Planned next

The next major milestones, in the order we plan to ship them.

### Production personhood: ZK Passport adapter

A `ZKPassportPersonhoodAdapter` implementing `IPersonhoodVerifier` against ZK Passport's verifier contract (deterministically at `0x1D000001000EFD9a6371f4d90bB8920D5431c0D8` on Ethereum Mainnet, Ethereum Sepolia, and Base Mainnet). Chain-agnostic, no relying-party context required, government-rooted identity, larger addressable population than orb-verified schemes.

ZK Passport is not currently deployed on Base Sepolia; we have requested an integration. Until it lands, testnet continues to use `MockPersonhoodAdapter`.

### Base Mainnet deployment

Gated on:

1. ZK Passport adapter shipped and audited.
2. Production multisig governance configured (Safe for `owner`, `DKIMRegistry.updater`, `PersonhoodRegistry.updater`).
3. Pause guardian assigned to a separate signer for emergency response.
4. Final external audit pass on the v1 surface.

### Account-binding module (ERC-4337 / ERC-7579)

Today integrators write the auth-check that reads `spectre.getRecord(identity).owner`. The next milestone bundles this wiring into a 4337/7579-compatible module so integration collapses to a one-deploy install.

### Expanded DKIM coverage

`DKIMRegistry` currently trusts Gmail's selector. Mainnet launch adds Microsoft Outlook, Apple iCloud, Yahoo, ProtonMail, and FastMail through the governance flow (each is a separate `propose` plus 24h timelock plus `confirm` cycle).

For live status on what's shipped, the source of truth is the repository itself: [github.com/CECILIA-MULANDI/spectre-protocol-base-evm](https://github.com/CECILIA-MULANDI/spectre-protocol-base-evm).
