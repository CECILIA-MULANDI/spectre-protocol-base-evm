/**
 * Execute a recovery after the timelock has elapsed. Callable by anyone.
 */
import { loadConfig } from "./config.js";
import { buildClients } from "./network.js";
import { REGISTRY_ABI } from "./abi.js";

const config = await loadConfig();
if (!config.agentOwnerAddress) {
  console.error("no agentOwnerAddress in config — run register first");
  process.exit(1);
}

const { publicClient, walletClient } = buildClients(config);

// Check timelock status before attempting
const [pending, pendingOwner, executeAfterBlock] = await publicClient.readContract({
  address: config.registryAddress,
  abi: REGISTRY_ABI,
  functionName: "recoveryStatus",
  args: [config.agentOwnerAddress],
}) as unknown as [boolean, `0x${string}`, bigint, number];

if (!pending) {
  console.error("no pending recovery found");
  process.exit(1);
}

const currentBlock = await publicClient.getBlockNumber();
if (currentBlock < executeAfterBlock) {
  console.log(`timelock not elapsed. current block: ${currentBlock}, execute after: ${executeAfterBlock}`);
  process.exit(1);
}

const hash = await walletClient.writeContract({
  address: config.registryAddress,
  abi: REGISTRY_ABI,
  functionName: "executeRecovery",
  args: [config.agentOwnerAddress],
});

console.log("execute tx submitted:", hash);
await publicClient.waitForTransactionReceipt({ hash });
console.log("recovery executed. new owner:", pendingOwner);
