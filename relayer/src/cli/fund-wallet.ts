import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const account = privateKeyToAccount("0x2b35cd0cbceaa2e0f0eeac68ce71e57df335e1640768663a2e21626103eed383");
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http("https://sepolia.base.org") });
const pub = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });

const target = "0x946eF21AA60aA009A1f8Df1654BBF9F8a01B3e4c" as `0x${string}`;
const balance = await pub.getBalance({ address: target });
console.log("backup wallet balance:", balance.toString(), "wei");

if (balance < parseEther("0.001")) {
  const hash = await wallet.sendTransaction({ to: target, value: parseEther("0.002") });
  console.log("funding tx:", hash);
  await pub.waitForTransactionReceipt({ hash });
  console.log("funded ✓");
} else {
  console.log("already funded ✓");
}
