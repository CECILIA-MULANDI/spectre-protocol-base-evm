import { readFile } from "fs/promises"
import { encodePacked, keccak256 } from "viem"
import { SpectreClient } from "../src/index.js"

const client = new SpectreClient({
  rpcUrl: "https://sepolia.base.org",
  registryAddress: "0xBe53383054Fda41A9F71b8593384144c367b01A1",
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
  prover: {
    type: "hosted",
    url: "http://localhost:3001",
  },
})

async function main() {
  const agentOwner = process.env.AGENT_OWNER as `0x${string}`
  const newOwner   = process.env.NEW_OWNER   as `0x${string}`
  const emlPath    = process.env.EML_PATH!

  const eml = await readFile(emlPath)

  const record = await client.getRecord(agentOwner)
  const nonce  = record.nonce

  console.log("Recovery signal:", client.computeSignal(agentOwner, newOwner, nonce))

  // Testnet deploys use MockPersonhoodAdapter, which ignores `personhoodProof`
  // but the registry still rejects nullifier reuse. Derive a fresh value per
  // attempt; a production adapter (e.g. ZK Passport) would supply both fields
  // from its SDK output.
  const personhoodProof: `0x${string}` = "0x"
  const personhoodNullifier = BigInt(
    keccak256(
      encodePacked(
        ["address", "address", "uint256", "uint256"],
        [agentOwner, newOwner, nonce, BigInt(Math.floor(Date.now() / 1000))]
      )
    )
  )

  console.log("Initiating email recovery...")
  const { hash } = await client.initiateEmailRecovery({
    eml,
    agentOwner,
    newOwner,
    nonce,
    personhoodNullifier,
    personhoodProof,
  })
  console.log("TX hash:", hash)

  const status = await client.getRecoveryStatus(agentOwner)
  console.log("Timelock runs until block:", status.executeAfterBlock.toString())
}

main().catch(console.error)
