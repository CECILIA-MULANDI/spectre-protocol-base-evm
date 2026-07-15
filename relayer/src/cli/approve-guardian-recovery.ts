/**
 * Cast a guardian approval vote for a proposed recovery.
 *
 * Must be called from the guardian's wallet (set SPECTRE_OWNER_KEY to the
 * guardian's key). Once the configured threshold of guardians have approved
 * the same agentOwner + newOwner pair, the time-locked recovery starts
 * automatically.
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
const { publicClient, walletClient, account } = await buildClients(config);

console.log("approving as guardian:", account.address);

const hash = await walletClient.writeContract({
  address: config.registryAddress,
  abi: REGISTRY_ABI,
  functionName: "approveGuardianRecovery",
  args: [agentOwner as `0x${string}`, newOwner as `0x${string}`],
});

console.log("tx submitted:", hash);
const receipt = await publicClient.waitForTransactionReceipt({ hash });

// Read at the confirmed block so RPC replica lag cannot return stale state.
const approvalCount = await publicClient.readContract({
  address: config.registryAddress,
  abi: REGISTRY_ABI,
  functionName: "getApprovalCount",
  args: [agentOwner as `0x${string}`, newOwner as `0x${string}`],
  blockNumber: receipt.blockNumber,
});

console.log("approval recorded. current approval count:", approvalCount);

// Check if recovery is now pending
const [pending, , executeAfterBlock, mode] = (await publicClient.readContract({
  address: config.registryAddress,
  abi: REGISTRY_ABI,
  functionName: "recoveryStatus",
  args: [agentOwner as `0x${string}`],
  blockNumber: receipt.blockNumber,
})) as unknown as [boolean, `0x${string}`, bigint, number];

if (pending && mode === 3 /* Social */) {
  console.log(
    "threshold reached — recovery pending, executable after block:",
    executeAfterBlock.toString()
  );
}
