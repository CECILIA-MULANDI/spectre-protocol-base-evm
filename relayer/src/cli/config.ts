import { readFile, writeFile } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, "../../../config.json");

export type Config = {
  rpcUrl: string;
  registryAddress: `0x${string}`;
  verifierAddress: `0x${string}`;
  worldIdRouter: `0x${string}`;
  dkimRegistryAddress?: `0x${string}`;
  ownerPrivateKey: `0x${string}`;
  // populated after register
  agentOwnerAddress?: `0x${string}`;
};

export async function loadConfig(): Promise<Config> {
  const raw = await readFile(CONFIG_PATH, "utf-8");
  return JSON.parse(raw) as Config;
}

export async function saveConfig(config: Config): Promise<void> {
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}
