# Spectre Protocol-EVM(BASE)

Zero-knowledge account recovery for autonomous on-chain agents. Spectre lets agent owners recover control using cryptographic proofs instead of seed phrases or centralized custodians. The protocol is chain-agnostic; v1 is deployed on Base.

## How it works

An agent owner registers with an email hash. To recover, they send a recovery email and submit a personhood proof. The protocol verifies both proofs on-chain and starts a timelock, giving the real owner time to cancel if the attempt is fraudulent.

Three recovery modes:

| Mode                    | Trigger                                  | Proof required                                |
| ----------------------- | ---------------------------------------- | --------------------------------------------- |
| **Email + Personhood**  | Anyone with the owner's email + a valid personhood proof | DKIM ZK proof + pluggable personhood proof |
| **Backup wallet**       | Pre-registered backup address            | Transaction from backup wallet                |
| **Social (M-of-N)**     | Guardian consensus                       | Threshold guardian approvals                  |

All modes enforce a timelock before the key rotation finalizes.

Personhood is pluggable through `PersonhoodRegistry`. The testnet deploy uses `MockPersonhoodAdapter` so dev iteration doesn't depend on an external identity provider; production will use a real adapter (ZK Passport is the next planned integration). The architecture supports multiple adapters via a governed propose/confirm allowlist.

## Architecture

```
circuits/          Noir ZK circuit - DKIM email signature verification
contracts/         Solidity smart contracts (Foundry)
relayer/           TypeScript CLI + HTTP prover API
packages/sdk/      TypeScript SDK for integrating apps
```

**Recovery flow (Email + Personhood):**

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
   Personhood proof (mock on testnet; ZK Passport on mainnet)
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

- [Foundry](https://book.getfoundry.sh/getting-started/installation) - Solidity toolchain
- [Nargo](https://noir-lang.org/docs/getting_started/installation) - Noir compiler
- [Barretenberg](https://github.com/AztecProtocol/barretenberg) (`bb`) - proof backend
- [Node.js](https://nodejs.org/) >= 18

## Quick start

### 1. Deploy contracts

```bash
cp .env.example .env
# Fill in DEPLOYER_PRIVATE_KEY, DKIM_UPDATER, BASESCAN_API_KEY

cd contracts
forge install
forge test  # run tests first

# Deploy to Base Sepolia
forge script scripts/Deploy.s.sol \
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

### 4. Start the prover API (optional)

```bash
cd relayer
npm run server
```

The server runs on port 3001 and provides:

| Endpoint  | Method | Description                       |
| --------- | ------ | --------------------------------- |
| `/prove`  | POST   | Upload `.eml` file → get ZK proof |
| `/verify` | POST   | Verify a proof                    |
| `/health` | GET    | Health check                      |

## Recovery walkthrough

### Email + Personhood recovery

**Step 1** - Send a recovery email from the registered address:

```
To: (any address)
Subject: spectre:{recovery_key}:{nonce}
Body: (anything)
```

`recovery_key` is the new owner address as a decimal bigint. `nonce` comes from `SpectreRegistry.getRecord(agentOwner).nonce`. The body can be anything your mail client produces (signatures, multipart MIME, etc.) - only the subject is checked. Download the sent email as `.eml`.

**Step 2** - Initiate recovery:

```bash
npm run initiate <path/to/email.eml> <newOwnerAddress>
```

The CLI generates the DKIM ZK proof from the `.eml` and submits it alongside a per-attempt personhood nullifier. On testnet (`MockPersonhoodAdapter`) the personhood proof is empty bytes; a production adapter (e.g. ZK Passport) would replace both with values from its SDK.

**Step 3** - Wait for the timelock to elapse, then execute:

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

| Command                    | Description                                |
| -------------------------- | ------------------------------------------ |
| `npm run register`         | Register agent with email hash + timelock  |
| `npm run initiate`         | Initiate Email + Personhood recovery       |
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

1. **RSA-2048 DKIM signature** - proves the email was signed by the sender's mail server (which transitively commits to the body via the `bh=` tag, so the body is integrity-protected without us reading it)
2. **FROM address hash** - matches the on-chain registered email hash (without revealing the email)
3. **Subject binding** - the subject contains `spectre:{recovery_key}:{nonce}`, binding the proof to a specific (newOwner, nonce) pair

The body is intentionally not inspected. This lets users send recovery emails from any mainstream mail client (which all wrap plain-text input in multipart MIME) without worrying about strict body formats.

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

- **Registration** - `register(emailHash, timelockBlocks)` creates an agent record
- **Dual verification** - `initiateRecovery()` verifies both the DKIM ZK proof (via UltraHonk verifier) and a personhood proof through the agent's chosen `IPersonhoodVerifier` adapter
- **Timelock** - all recovery modes are staged for a configurable block window (min 10 blocks testnet, 7200 blocks ~24h mainnet)
- **Replay protection** - nonce increments on cancel/execute; personhood nullifiers are tracked in `usedNullifiers` and remain consumed after `executeRecovery`

Run tests:

```bash
cd contracts
forge test -vvv
```

## Deployed contracts (Base Sepolia)

`SpectreRegistry` is a Transparent proxy; use the **proxy** address. The implementation is upgradeable behind it.

`SpectreRegistry` is a Transparent proxy; use the **proxy** address. The implementation is upgradeable behind it. The latest deployment lives in `contracts/broadcast/Deploy.s.sol/84532/run-latest.json`.

## Environment variables

See `.env.example` for the full list. Key variables:

| Variable                 | Where  | Description                                                 |
| ------------------------ | ------ | ----------------------------------------------------------- |
| `DEPLOYER_PRIVATE_KEY`   | `.env` | Account that deploys contracts                              |
| `DKIM_UPDATER`           | `.env` | Address allowed to propose/revoke DKIM keys + adapters      |
| `DKIM_PROPOSAL_TIMELOCK` | `.env` | Seconds between propose() and confirm() (e.g. 86400 = 24h)  |
| `DEFAULT_TIMELOCK_BLOCKS`| `.env` | Default + minimum recovery cancel window, in blocks         |
| `BASESCAN_API_KEY`       | `.env` | For contract verification on Basescan                       |

## License

MIT
