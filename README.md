# Spectre Protocol-EVM(BASE)

Zero-knowledge account recovery for AI agents on Base. Spectre lets agent owners recover control using cryptographic proofs instead of seed phrases or centralized custodians.

## How it works

An agent owner registers with an email hash. To recover, they send a recovery email and verify their identity with World ID. The protocol verifies both proofs on-chain and starts a timelock — giving the real owner time to cancel if the attempt is fraudulent.

Three recovery modes:

| Mode                 | Trigger                                  | Proof required                           |
| -------------------- | ---------------------------------------- | ---------------------------------------- |
| **Email + World ID** | Anyone with the owner's email + World ID | DKIM ZK proof + World ID Semaphore proof |
| **Backup wallet**    | Pre-registered backup address            | Transaction from backup wallet           |
| **Social (M-of-N)**  | Guardian consensus                       | Threshold guardian approvals             |

All modes enforce a timelock before the key rotation finalizes.

## Architecture

```
circuits/          Noir ZK circuit — DKIM email signature verification
contracts/         Solidity smart contracts (Foundry)
relayer/           TypeScript CLI + HTTP prover API
world-id-ui/       React frontend for World ID proof generation
```

**Recovery flow (Email + World ID):**

```
Owner sends recovery email
        │
        ▼
   Relayer parses .eml, extracts DKIM signature
        │
        ▼
   Noir circuit generates ZK proof of valid DKIM + email content
        │
        ▼
   Owner verifies with World ID (via world-id-ui)
        │
        ▼
   Both proofs submitted to SpectreRegistry.initiateRecovery()
        │
        ▼
   Timelock starts (~24h on mainnet)
        │
        ▼
   Owner can cancel  ──or──  Anyone calls executeRecovery()
```

## Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) — Solidity toolchain
- [Nargo](https://noir-lang.org/docs/getting_started/installation) — Noir compiler
- [Barretenberg](https://github.com/AztecProtocol/barretenberg) (`bb`) — proof backend
- [Node.js](https://nodejs.org/) >= 18
- A [World ID](https://developer.worldcoin.org) app (for human verification)

## Quick start

### 1. Deploy contracts

```bash
cp .env.example .env
# Fill in DEPLOYER_PRIVATE_KEY, WORLD_ID_ROUTER, BASESCAN_API_KEY

cd contracts
forge install
forge test  # run tests first

# Deploy to Base Sepolia
forge script script/Deploy.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC \
  --broadcast --verify
```

Note the deployed `SpectreRegistry` and `HonkVerifier` addresses from the output.

### 2. Configure the relayer

```bash
cd relayer
npm install
```

Create `relayer/config.json`:

```json
{
  "rpcUrl": "https://sepolia.base.org",
  "registryAddress": "0x...",
  "verifierAddress": "0x...",
  "worldIdRouter": "0x42FF98C4E85212a5D31358ACbFe76a621b784Fac",
  "ownerPrivateKey": "0x...",
  "agentOwnerAddress": ""
}
```

### 3. Register an agent

```bash
npm run register <your-email@example.com> <timelock-blocks>
# e.g. npm run register alice@gmail.com 20
```

This stores `SHA256(email)` on-chain and sets the cancel window.

### 4. Set up World ID UI

```bash
cd world-id-ui
npm install
cp .env.example .env
# Set VITE_WLD_APP_ID to your World ID app ID
npm run dev
```

### 5. Start the prover API (optional)

```bash
cd relayer
WORLD_ID_RP_ID=rp_... \
WORLD_ID_SIGNING_KEY=... \
npm run server
```

The server runs on port 3001 and provides:

| Endpoint           | Method | Description                            |
| ------------------ | ------ | -------------------------------------- |
| `/prove`           | POST   | Upload `.eml` file → get ZK proof      |
| `/verify`          | POST   | Verify a proof                         |
| `/worldid-context` | POST   | Get signed context for World ID widget |
| `/health`          | GET    | Health check                           |

## Recovery walkthrough

### Email + World ID recovery

**Step 1** — Compose a recovery email from the registered address:

```
To: (any address)
Body: {recovery_key}:{nonce}
```

The nonce comes from `SpectreRegistry.getRecord(agentOwner).nonce`. Download the sent email as `.eml`.

**Step 2** — Generate a World ID proof using the `world-id-ui` frontend. Fill in the agent owner address, new owner address, and nonce. Save the output as `worldid-proof.json`.

**Step 3** — Initiate recovery:

```bash
npm run initiate <path/to/email.eml> <newOwnerAddress> <path/to/worldid-proof.json>
```

**Step 4** — Wait for the timelock to elapse, then execute:

```bash
npm run execute
```

### Backup wallet recovery

```bash
npm run set-backup <backupWalletAddress>         # owner sets backup
npm run initiate-backup <agentOwner> <newOwner>   # backup wallet initiates
npm run execute                                   # after timelock
```

### Social / guardian recovery

```bash
npm run set-guardians <addr1,addr2,addr3> <threshold>  # owner configures
npm run approve-guardian <agentOwner> <newOwner>        # each guardian votes
# Timelock starts automatically once threshold is reached
npm run execute                                        # after timelock
```

### Cancel a recovery

The current owner can cancel any pending recovery (regardless of mode):

```bash
npm run cancel
```

This increments the nonce, invalidating any stale guardian votes or proofs.

## CLI commands

| Command                    | Description                               |
| -------------------------- | ----------------------------------------- |
| `npm run register`         | Register agent with email hash + timelock |
| `npm run initiate`         | Initiate Email+WorldID recovery           |
| `npm run cancel`           | Cancel pending recovery                   |
| `npm run execute`          | Execute recovery after timelock           |
| `npm run check`            | View agent record and recovery status     |
| `npm run set-backup`       | Set backup wallet address                 |
| `npm run initiate-backup`  | Initiate backup wallet recovery           |
| `npm run set-guardians`    | Configure guardian addresses + threshold  |
| `npm run approve-guardian` | Guardian votes for a recovery             |
| `npm run fund-wallet`      | Fund a wallet with testnet ETH            |
| `npm run server`           | Start the HTTP prover API                 |

## ZK circuit

The Noir circuit (`circuits/src/main.nr`) verifies:

1. **RSA-2048 DKIM signature** — proves the email was signed by the sender's mail server
2. **FROM address hash** — matches the on-chain registered email hash (without revealing the email)
3. **Body content** — email body contains `{recovery_key}:{nonce}`, binding the proof to a specific recovery attempt
4. **Body hash** — DKIM `bh=` header matches SHA256 of the canonical body

Build and test the circuit:

```bash
cd circuits
nargo test        # run circuit tests
nargo execute     # generate witness
bb prove -s ultra_honk -b target/spectre.json -w target/spectre.gz \
  -o target/proof --oracle_hash keccak --write_vk
```

## Smart contract

`SpectreRegistry.sol` manages agent records and enforces recovery rules:

- **Registration** — `register(emailHash, timelockBlocks)` creates an agent record
- **Dual verification** — `initiateRecovery()` verifies both the DKIM ZK proof (via UltraHonk verifier) and World ID Semaphore proof (via World ID router)
- **Timelock** — all recovery modes are staged for a configurable block window (min 10 blocks testnet, 7200 blocks ~24h mainnet)
- **Replay protection** — nonce increments on cancel/execute; World ID nullifiers are single-use

Run tests:

```bash
cd contracts
forge test -vvv
```

## Deployed contracts (Base Sepolia)

| Contract        | Address                                      |
| --------------- | -------------------------------------------- |
| SpectreRegistry | `0xc8458d4B3b67a9a9643d6818dC73D2a10723C551` |
| HonkVerifier    | `0x8a4C0AdAFe442A9c9E7Aaf7815bD92fd3F961917` |
| World ID Router | `0x42FF98C4E85212a5D31358ACbFe76a621b784Fac` |

## Environment variables

See `.env.example` for the full list. Key variables:

| Variable               | Where              | Description                                |
| ---------------------- | ------------------ | ------------------------------------------ |
| `DEPLOYER_PRIVATE_KEY` | `.env`             | Account that deploys contracts             |
| `WORLD_ID_ROUTER`      | `.env`             | World ID router address for target network |
| `WORLD_ID_GROUP_ID`    | `.env`             | `1` for Orb-verified                       |
| `BASESCAN_API_KEY`     | `.env`             | For contract verification on Basescan      |
| `WORLD_ID_RP_ID`       | relayer env        | Your World ID relying party ID             |
| `WORLD_ID_SIGNING_KEY` | relayer env        | RP signing key for World ID contexts       |
| `VITE_WLD_APP_ID`      | `world-id-ui/.env` | World ID app ID from developer portal      |

## License

MIT
