import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import type { Config } from "./config.js";

export function buildClients(config: Config) {
  const chain = config.rpcUrl.includes("sepolia") ? baseSepolia : base;
  const account = privateKeyToAccount(config.ownerPrivateKey);

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
