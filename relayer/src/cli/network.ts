import { createPublicClient, createWalletClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";
import type { Config } from "./config.js";
import { resolveAccount } from "./signer.js";

export async function buildClients(config: Config) {
  const chain = config.rpcUrl.includes("sepolia") ? baseSepolia : base;
  const account = await resolveAccount(config);

  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(config.rpcUrl),
  });

  return { publicClient, walletClient, account };
}
