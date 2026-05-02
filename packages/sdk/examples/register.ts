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
  console.log("Registering agent...")
  const { tx, emailHash } = await client.register(
    "alice@gmail.com",
    10n
  )
  console.log("TX hash:   ", tx)
  console.log("Email hash:", emailHash)

  const ownerAddress = process.env.OWNER_ADDRESS as `0x${string}`
  const record = await client.getRecord(ownerAddress)
  console.log("Record:", record)

  const status = await client.getRecoveryStatus(ownerAddress)
  console.log("Recovery status:", status)
}

main().catch(console.error)
