/**
 * Register an agent recovery config on SpectreRegistry.
 *
 * Computes SHA256(email_address) off-chain and calls SpectreRegistry.register().
 * If timelock-blocks is omitted the protocol's default is used.
 */
import { createHash } from "crypto";
import { loadConfig, saveConfig } from "./config.js";
import { buildClients } from "./network.js";
import { REGISTRY_ABI } from "./abi.js";

const [emailAddress, timelockArg] = process.argv.slice(2);
if (!emailAddress) {
  console.error("usage: register <email-address> [timelock-blocks]");
  process.exit(1);
}

const config = await loadConfig();
const { publicClient, walletClient, account } = buildClients(config);

const emailHash = ("0x" +
  createHash("sha256").update(emailAddress).digest("hex")) as `0x${string}`;
console.log("email hash:", emailHash);

const hash = timelockArg === undefined
  ? await walletClient.writeContract({
      address: config.registryAddress,
      abi: REGISTRY_ABI,
      functionName: "register",
      args: [emailHash],
    })
  : await walletClient.writeContract({
      address: config.registryAddress,
      abi: REGISTRY_ABI,
      functionName: "registerWithCustomTimelock",
      args: [emailHash, BigInt(timelockArg)],
    });

console.log("tx submitted:", hash);
await publicClient.waitForTransactionReceipt({ hash });
console.log("registered. agent owner:", account.address);

await saveConfig({ ...config, agentOwnerAddress: account.address });
