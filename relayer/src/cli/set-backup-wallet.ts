/**
 * Set or update the backup wallet for the registered agent.
 *
 * The backup wallet can later call initiateBackupRecovery to start
 * a time-locked ownership transfer without needing an email or World ID proof.
 */
import { loadConfig } from "./config.js";
import { buildClients } from "./network.js";
import { REGISTRY_ABI } from "./abi.js";

const [backupWallet] = process.argv.slice(2);
if (!backupWallet) {
  console.error("error: backup-wallet address is required");
  process.exit(1);
}

const config = await loadConfig();
const { publicClient, walletClient } = buildClients(config);

const hash = await walletClient.writeContract({
  address: config.registryAddress,
  abi: REGISTRY_ABI,
  functionName: "setBackupWallet",
  args: [backupWallet as `0x${string}`],
});

console.log("tx submitted:", hash);
await publicClient.waitForTransactionReceipt({ hash });
console.log("backup wallet set:", backupWallet);
