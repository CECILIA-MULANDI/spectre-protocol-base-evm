/**
 * Cancel a pending recovery. Only callable by the current owner.
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

const hash = await walletClient.writeContract({
  address: config.registryAddress,
  abi: REGISTRY_ABI,
  functionName: "cancelRecovery",
  args: [config.agentOwnerAddress],
});

console.log("cancel tx submitted:", hash);
await publicClient.waitForTransactionReceipt({ hash });
console.log("recovery cancelled. nonce incremented.");
