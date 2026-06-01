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
  console.log("Registering agent...")
  const { hash, emailHash } = await client.registerWithCustomTimelock(
    "alice@gmail.com",
    10n
  )
  console.log("TX hash:   ", hash)
  console.log("Email hash:", emailHash)

  const ownerAddress = process.env.OWNER_ADDRESS as `0x${string}`
  const record = await client.getRecord(ownerAddress)
  console.log("Record:", record)

  const status = await client.getRecoveryStatus(ownerAddress)
  console.log("Recovery status:", status)
}

main().catch(console.error)
