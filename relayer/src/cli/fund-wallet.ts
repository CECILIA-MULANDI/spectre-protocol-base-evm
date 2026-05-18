/**
 * Dev helper: top up a Base Sepolia wallet from a funder key.
 *
 * Usage: SPECTRE_FUNDER_KEY=0x<64-hex> tsx fund-wallet.ts [targetAddress]
 *
 * SECURITY: this file previously hardcoded a funder private key in source. That
 * key is permanently leaked in git history (commit cbe5cbd) and must be treated
 * as burned — never reuse or fund it. The funder key now comes from the
 * environment only.
 */
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const funderKey = process.env.SPECTRE_FUNDER_KEY?.trim();
if (!funderKey || !/^0x[0-9a-fA-F]{64}$/.test(funderKey)) {
  console.error(
    "error: set SPECTRE_FUNDER_KEY=0x<64-hex> (a funded Base Sepolia key)"
  );
  process.exit(1);
}

const target = (process.argv[2] ??
  "0x946eF21AA60aA009A1f8Df1654BBF9F8a01B3e4c") as `0x${string}`;

const account = privateKeyToAccount(funderKey as `0x${string}`);
const wallet = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
});
const pub = createPublicClient({
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
});

const balance = await pub.getBalance({ address: target });
console.log("target balance:", balance.toString(), "wei");

if (balance < parseEther("0.001")) {
  const hash = await wallet.sendTransaction({
    to: target,
    value: parseEther("0.002"),
  });
  console.log("funding tx:", hash);
  await pub.waitForTransactionReceipt({ hash });
  console.log("funded ✓");
} else {
  console.log("already funded ✓");
}
