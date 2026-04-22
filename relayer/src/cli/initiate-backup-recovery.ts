/**
 * Initiate a backup-wallet recovery for an agent.
 *
 * Must be called from the backup wallet registered for the agent.
 * Set ownerPrivateKey in config.json to the backup wallet's private key,
 * or override via OWNER_PRIVATE_KEY env var.
 */
import { loadConfig } from "./config.js";
import { buildClients } from "./network.js";
import { REGISTRY_ABI } from "./abi.js";

const [agentOwner, newOwner] = process.argv.slice(2);
if (!agentOwner || !newOwner) {
  console.error("error: agent-owner and new-owner addresses are required");
  process.exit(1);
}

const config = await loadConfig();
const { publicClient, walletClient, account } = buildClients(config);

console.log("initiating backup recovery as:", account.address);
console.log("agent owner:                  ", agentOwner);
console.log("new owner:                    ", newOwner);

const hash = await walletClient.writeContract({
  address: config.registryAddress,
  abi: REGISTRY_ABI,
  functionName: "initiateBackupRecovery",
  args: [agentOwner as `0x${string}`, newOwner as `0x${string}`],
});

console.log("tx submitted:", hash);
await publicClient.waitForTransactionReceipt({ hash });

const status = (await publicClient.readContract({
  address: config.registryAddress,
  abi: REGISTRY_ABI,
  functionName: "recoveryStatus",
  args: [agentOwner as `0x${string}`],
})) as unknown as {
  pending: boolean;
  pendingOwner: `0x${string}`;
  executeAfterBlock: bigint;
  mode: number;
};

console.log(
  "backup recovery pending. executable after block:",
  status.executeAfterBlock.toString()
);
console.log("owner can cancel within the timelock window.");
