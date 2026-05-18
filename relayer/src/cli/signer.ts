/**
 * Signer resolution for the relayer CLIs.
 *
 * Audit S(#3): the owner key must not live in plaintext `config.json` for a
 * user-facing tool. Resolution precedence, most-secure first:
 *
 *   1. SPECTRE_OWNER_KEY            — 0x-hex key from the environment (nothing
 *                                     on disk; works with CI / secret managers)
 *   2. SPECTRE_KEYSTORE            — path to a Web3 Secret Storage v3 keystore
 *      + SPECTRE_KEYSTORE_PASSWORD  (or *_PASSWORD_FILE)  (encrypted at rest)
 *   3. config.json ownerPrivateKey — DEPRECATED plaintext fallback; still works
 *                                     so nothing breaks, but warns loudly.
 *
 * Ledger / external signers are a deliberate future extension: add a branch
 * here returning a viem custom Account; no call site changes needed.
 *
 * Keystore v3 decryption is implemented with Node `crypto` + viem `keccak256`
 * so this adds no new dependency.
 */
import { readFile } from "node:fs/promises";
import {
  scryptSync,
  pbkdf2Sync,
  createDecipheriv,
  timingSafeEqual,
} from "node:crypto";
import { keccak256, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

export const ENV_KEY = "SPECTRE_OWNER_KEY";
export const ENV_KEYSTORE = "SPECTRE_KEYSTORE";
export const ENV_KEYSTORE_PW = "SPECTRE_KEYSTORE_PASSWORD";
export const ENV_KEYSTORE_PW_FILE = "SPECTRE_KEYSTORE_PASSWORD_FILE";

function normalizePrivateKey(raw: string, source: string): Hex {
  const k = raw.trim();
  const hex = k.startsWith("0x") ? k : `0x${k}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      `${source}: expected a 32-byte hex private key (0x + 64 hex chars)`
    );
  }
  return hex.toLowerCase() as Hex;
}

interface KeystoreV3 {
  version: number;
  crypto?: KeystoreCrypto;
  Crypto?: KeystoreCrypto;
}
interface KeystoreCrypto {
  cipher: string;
  ciphertext: string;
  cipherparams: { iv: string };
  kdf: string;
  kdfparams: Record<string, unknown>;
  mac: string;
}

/**
 * Decrypt a Web3 Secret Storage v3 keystore JSON to a 0x private key.
 * Supports scrypt and pbkdf2(hmac-sha256) KDFs and aes-128-ctr.
 */
export async function decryptKeystore(
  json: string,
  password: string
): Promise<Hex> {
  let ks: KeystoreV3;
  try {
    ks = JSON.parse(json) as KeystoreV3;
  } catch {
    throw new Error("keystore: file is not valid JSON");
  }
  const c = ks.crypto ?? ks.Crypto;
  if (ks.version !== 3 || !c) {
    throw new Error("keystore: only Web3 Secret Storage v3 is supported");
  }

  const pw = Buffer.from(password, "utf8");
  const p = c.kdfparams as {
    salt: string;
    dklen: number;
    n?: number;
    r?: number;
    p?: number;
    c?: number;
    prf?: string;
  };
  const salt = Buffer.from(p.salt, "hex");
  let derived: Buffer;

  if (c.kdf === "scrypt") {
    const n = p.n!;
    const r = p.r!;
    derived = scryptSync(pw, salt, p.dklen, {
      N: n,
      r,
      p: p.p!,
      // Node's default maxmem (32 MiB) is below scrypt's 128*N*r need.
      maxmem: 128 * n * r + (1 << 20),
    });
  } else if (c.kdf === "pbkdf2") {
    if (p.prf && p.prf !== "hmac-sha256") {
      throw new Error(`keystore: unsupported pbkdf2 prf '${p.prf}'`);
    }
    derived = pbkdf2Sync(pw, salt, p.c!, p.dklen, "sha256");
  } else {
    throw new Error(`keystore: unsupported kdf '${c.kdf}'`);
  }

  const cipherText = Buffer.from(c.ciphertext, "hex");
  const macInput = new Uint8Array([
    ...derived.subarray(16, 32),
    ...cipherText,
  ]);
  const computed = Buffer.from(keccak256(macInput).slice(2), "hex");
  const expected = Buffer.from(c.mac, "hex");
  if (
    computed.length !== expected.length ||
    !timingSafeEqual(computed, expected)
  ) {
    throw new Error("keystore: MAC mismatch — wrong password or corrupt file");
  }

  if (c.cipher !== "aes-128-ctr") {
    throw new Error(`keystore: unsupported cipher '${c.cipher}'`);
  }
  const decipher = createDecipheriv(
    "aes-128-ctr",
    derived.subarray(0, 16),
    Buffer.from(c.cipherparams.iv, "hex")
  );
  const pk = Buffer.concat([decipher.update(cipherText), decipher.final()]);
  return normalizePrivateKey(pk.toString("hex"), "keystore");
}

async function readKeystorePassword(): Promise<string> {
  const direct = process.env[ENV_KEYSTORE_PW];
  if (direct) return direct;
  const file = process.env[ENV_KEYSTORE_PW_FILE];
  if (file) return (await readFile(file, "utf8")).replace(/\r?\n$/, "");
  throw new Error(
    `keystore selected (${ENV_KEYSTORE}) but no password: set ${ENV_KEYSTORE_PW} or ${ENV_KEYSTORE_PW_FILE}`
  );
}

let plaintextWarned = false;
/** @internal test helper — reset the once-per-process warning latch. */
export function _resetPlaintextWarning(): void {
  plaintextWarned = false;
}
function warnPlaintext(): void {
  if (plaintextWarned) return;
  plaintextWarned = true;
  const bar = "!".repeat(74);
  process.stderr.write(
    `\n${bar}\n` +
      `  SECURITY: signing with ownerPrivateKey from config.json\n` +
      `  (PLAINTEXT ON DISK — DEPRECATED). Migrate before mainnet:\n` +
      `    - ${ENV_KEY}=0x<64-hex>            (nothing on disk), or\n` +
      `    - ${ENV_KEYSTORE}=/path/keystore.json\n` +
      `      + ${ENV_KEYSTORE_PW} (or ${ENV_KEYSTORE_PW_FILE})\n` +
      `  Then delete ownerPrivateKey from config.json.\n` +
      `${bar}\n\n`
  );
}

/**
 * Resolve the signing account by precedence. `ownerPrivateKey` is optional;
 * if absent and no env signer is configured, throws with guidance.
 */
export async function resolveAccount(config: {
  ownerPrivateKey?: Hex;
}): Promise<PrivateKeyAccount> {
  const envKey = process.env[ENV_KEY]?.trim();
  if (envKey) {
    return privateKeyToAccount(normalizePrivateKey(envKey, ENV_KEY));
  }

  const ksPath = process.env[ENV_KEYSTORE]?.trim();
  if (ksPath) {
    const json = await readFile(ksPath, "utf8");
    const pk = await decryptKeystore(json, await readKeystorePassword());
    return privateKeyToAccount(pk);
  }

  if (config.ownerPrivateKey) {
    warnPlaintext();
    return privateKeyToAccount(
      normalizePrivateKey(config.ownerPrivateKey, "config.json ownerPrivateKey")
    );
  }

  throw new Error(
    "No signer configured. Provide one of:\n" +
      `  ${ENV_KEY}=0x<64-hex>\n` +
      `  ${ENV_KEYSTORE}=/path/to/keystore.json  (+ ${ENV_KEYSTORE_PW} or ${ENV_KEYSTORE_PW_FILE})\n` +
      "  (deprecated) ownerPrivateKey in config.json"
  );
}
