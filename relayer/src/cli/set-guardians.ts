/**
 * Set or replace the guardian list for the registered agent.
 *
 * Guardians can collectively initiate a time-locked recovery by each calling
 * approve-guardian-recovery. Once the threshold is reached the timelock starts.
 *
 */
import { loadConfig } from "./config.js";
import { buildClients } from "./network.js";
import { REGISTRY_ABI } from "./abi.js";

const [thresholdArg, ...guardianArgs] = process.argv.slice(2);
if (!thresholdArg || guardianArgs.length === 0) {
  console.error(
    "error: threshold and at least one guardian address are required"
  );
  process.exit(1);
}

const threshold = Number(thresholdArg);
if (!Number.isInteger(threshold) || threshold <= 0) {
  console.error("error: threshold must be a positive integer");
  process.exit(1);
}
if (threshold > guardianArgs.length) {
  console.error("error: threshold cannot exceed the number of guardians");
  process.exit(1);
}

const config = await loadConfig();
const { publicClient, walletClient } = buildClients(config);

const hash = await walletClient.writeContract({
  address: config.registryAddress,
  abi: REGISTRY_ABI,
  functionName: "setGuardians",
  args: [guardianArgs as `0x${string}`[], threshold],
});

console.log("tx submitted:", hash);
await publicClient.waitForTransactionReceipt({ hash });
console.log(
  `guardians set: ${guardianArgs.length} guardians, threshold ${threshold}`
);
guardianArgs.forEach((g, i) => console.log(`  [${i}] ${g}`));
