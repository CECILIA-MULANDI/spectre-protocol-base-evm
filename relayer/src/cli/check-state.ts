import { createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";
import { REGISTRY_ABI } from "./abi.js";
import { loadConfig } from "./config.js";

const config = await loadConfig();
const chain = config.rpcUrl.includes("sepolia") ? baseSepolia : base;
const client = createPublicClient({ chain, transport: http(config.rpcUrl) });

const registry = config.registryAddress;
const owner = (process.argv[2] ?? config.agentOwnerAddress) as `0x${string}`;

if (!owner) {
  console.error("error: pass an agent address or set agentOwnerAddress in config.json");
  process.exit(1);
}

const record = await client.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "getRecord", args: [owner] }) as any;
const guardians = await client.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "getGuardians", args: [owner] }) as string[];
const [pending, pendingOwner, executeAfterBlock, mode] = await client.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "recoveryStatus", args: [owner] }) as any;

const MODES = ["None", "EmailWorldID", "Social", "Backup"];

console.log("=== Agent Record ===");
console.log("owner:             ", record.owner);
console.log("emailHash:         ", record.emailHash);
console.log("timelockBlocks:    ", record.timelockBlocks.toString());
console.log("nonce:             ", record.nonce.toString());
console.log("backupWallet:      ", record.backupWallet);
console.log("guardianThreshold: ", record.guardianThreshold);
console.log("guardianCount:     ", record.guardianCount);
console.log("\n=== Recovery Status ===");
console.log("pending:           ", pending);
console.log("pendingOwner:      ", pendingOwner);
console.log("executeAfterBlock: ", executeAfterBlock.toString());
console.log("mode:              ", MODES[mode] ?? mode);
console.log("\n=== Guardians ===");
guardians.forEach((g, i) => console.log(`  [${i}] ${g}`));
