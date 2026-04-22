/**
 * Register an agent recovery config on SpectreRegistry.
 *
 * Usage: tsx register.ts <email-address> <timelock-blocks>
 *
 * Computes SHA256(email_address) off-chain and calls SpectreRegistry.register().
 */
import { createHash } from "crypto";
import { encodeFunctionData } from "viem";
import { loadConfig, saveConfig } from "./config.js";
import { buildClients } from "./network.js";
import { REGISTRY_ABI } from "./abi.js";

const [emailAddress, timelockArg] = process.argv.slice(2);
if (!emailAddress || !timelockArg) {
  console.error("usage: register.ts <email-address> <timelock-blocks>");
  process.exit(1);
}

const timelockBlocks = BigInt(timelockArg);

const config = await loadConfig();
const { publicClient, walletClient, account } = buildClients(config);

const emailHash = "0x" + createHash("sha256").update(emailAddress).digest("hex") as `0x${string}`;
console.log("email hash:", emailHash);

const hash = await walletClient.writeContract({
  address: config.registryAddress,
  abi: REGISTRY_ABI,
  functionName: "register",
  args: [emailHash as `0x${string}`, timelockBlocks],
});

console.log("tx submitted:", hash);
await publicClient.waitForTransactionReceipt({ hash });
console.log("registered. agent owner:", account.address);

await saveConfig({ ...config, agentOwnerAddress: account.address });
