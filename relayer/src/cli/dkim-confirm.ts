/**
 * Promote a proposed DKIM key to "trusted" once the registry timelock has elapsed.
 *
 * Usage:
 *   tsx dkim-confirm.ts <keyHash>
 */
import { loadConfig } from "./config.js";
import { buildClients } from "./network.js";

const DKIM_REGISTRY_ABI = [
  {
    type: "function",
    name: "confirm",
    inputs: [{ name: "keyHash", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const [keyHash] = process.argv.slice(2);
if (!keyHash || !keyHash.startsWith("0x") || keyHash.length !== 66) {
  console.error("usage: dkim-confirm <0x-prefixed-32-byte-keyHash>");
  process.exit(1);
}

const config = await loadConfig();
if (!config.dkimRegistryAddress) {
  console.error("dkimRegistryAddress missing from config.json");
  process.exit(1);
}

const { publicClient, walletClient } = buildClients(config);

const hash = await walletClient.writeContract({
  address: config.dkimRegistryAddress,
  abi: DKIM_REGISTRY_ABI,
  functionName: "confirm",
  args: [keyHash as `0x${string}`],
});
console.log("confirm tx:", hash);
await publicClient.waitForTransactionReceipt({ hash });
console.log("key is now trusted.");
