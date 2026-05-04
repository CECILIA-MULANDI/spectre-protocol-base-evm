import { readFile } from "fs/promises"
import { SpectreClient } from "../src/index.js"

const client = new SpectreClient({
  rpcUrl: "https://sepolia.base.org",
  registryAddress: "0xc8458d4B3b67a9a9643d6818dC73D2a10723C551",
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
  const proofPath  = process.env.WORLD_ID_PROOF_PATH!

  const eml         = await readFile(emlPath)
  const worldIdProof = JSON.parse(await readFile(proofPath, "utf-8"))

  const record = await client.getRecord(agentOwner)
  const nonce  = record.nonce

  console.log("Signal to use in World ID UI:")
  console.log(client.computeSignal(agentOwner, newOwner, nonce))
  console.log()

  console.log("Initiating email recovery...")
  const { hash } = await client.initiateEmailRecovery({
    eml,
    agentOwner,
    newOwner,
    nonce,
    worldIdProof,
  })
  console.log("TX hash:", hash)

  const status = await client.getRecoveryStatus(agentOwner)
  console.log("Timelock runs until block:", status.executeAfterBlock.toString())
}

main().catch(console.error)
