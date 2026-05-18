import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  pbkdf2Sync,
  scryptSync,
  createCipheriv,
  randomBytes,
} from "node:crypto";
import { keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  resolveAccount,
  decryptKeystore,
  _resetPlaintextWarning,
  ENV_KEY,
  ENV_KEYSTORE,
  ENV_KEYSTORE_PW,
} from "./signer.js";

// Anvil account #1 — deterministic test key.
const KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const ADDR = privateKeyToAccount(KEY).address;

// In-test v3 encryptor — mirrors signer.ts decrypt so the round-trip proves
// spec-shaped keystores (as produced by geth/web3) decrypt correctly.
function encryptV3(
  pk: Hex,
  password: string,
  kdf: "pbkdf2" | "scrypt"
): string {
  const pkBytes = Buffer.from(pk.slice(2), "hex");
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  let derived: Buffer;
  let kdfparams: Record<string, unknown>;
  if (kdf === "pbkdf2") {
    const c = 4096;
    derived = pbkdf2Sync(Buffer.from(password), salt, c, 32, "sha256");
    kdfparams = { c, dklen: 32, prf: "hmac-sha256", salt: salt.toString("hex") };
  } else {
    const N = 4096,
      r = 8,
      p = 1;
    derived = scryptSync(Buffer.from(password), salt, 32, {
      N,
      r,
      p,
      maxmem: 128 * N * r + (1 << 20),
    });
    kdfparams = { n: N, r, p, dklen: 32, salt: salt.toString("hex") };
  }
  const cipher = createCipheriv("aes-128-ctr", derived.subarray(0, 16), iv);
  const ct = Buffer.concat([cipher.update(pkBytes), cipher.final()]);
  const mac = keccak256(
    new Uint8Array([...derived.subarray(16, 32), ...ct])
  ).slice(2);
  return JSON.stringify({
    version: 3,
    crypto: {
      cipher: "aes-128-ctr",
      ciphertext: ct.toString("hex"),
      cipherparams: { iv: iv.toString("hex") },
      kdf,
      kdfparams,
      mac,
    },
  });
}

beforeEach(() => {
  delete process.env[ENV_KEY];
  delete process.env[ENV_KEYSTORE];
  delete process.env[ENV_KEYSTORE_PW];
  delete process.env.SPECTRE_KEYSTORE_PASSWORD_FILE;
  _resetPlaintextWarning();
});

test("decryptKeystore round-trips a pbkdf2 v3 keystore", async () => {
  const pk = await decryptKeystore(encryptV3(KEY, "pw123", "pbkdf2"), "pw123");
  assert.equal(pk, KEY);
});

test("decryptKeystore round-trips a scrypt v3 keystore", async () => {
  const pk = await decryptKeystore(encryptV3(KEY, "hunter2", "scrypt"), "hunter2");
  assert.equal(pk, KEY);
});

test("decryptKeystore rejects a wrong password via MAC", async () => {
  await assert.rejects(
    () => decryptKeystore(encryptV3(KEY, "right", "pbkdf2"), "wrong"),
    /MAC mismatch/
  );
});

test("decryptKeystore rejects non-v3 files", async () => {
  await assert.rejects(
    () => decryptKeystore(JSON.stringify({ version: 1 }), "x"),
    /v3/
  );
});

test("resolveAccount: env key takes precedence over config plaintext", async () => {
  process.env[ENV_KEY] = KEY;
  const other =
    "0x0000000000000000000000000000000000000000000000000000000000000001" as Hex;
  const acct = await resolveAccount({ ownerPrivateKey: other });
  assert.equal(acct.address, ADDR); // env won, not the config key
});

test("resolveAccount: resolves from a keystore file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "spectre-ks-"));
  const ksPath = join(dir, "keystore.json");
  await writeFile(ksPath, encryptV3(KEY, "pw", "pbkdf2"));
  process.env[ENV_KEYSTORE] = ksPath;
  process.env[ENV_KEYSTORE_PW] = "pw";
  const acct = await resolveAccount({});
  assert.equal(acct.address, ADDR);
});

test("resolveAccount: config plaintext works but warns loudly", async () => {
  const chunks: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((s: string) => (chunks.push(String(s)), true)) as typeof process.stderr.write;
  try {
    const acct = await resolveAccount({ ownerPrivateKey: KEY });
    assert.equal(acct.address, ADDR);
  } finally {
    process.stderr.write = orig;
  }
  assert.match(chunks.join(""), /DEPRECATED/);
});

test("resolveAccount: throws with guidance when nothing is configured", async () => {
  await assert.rejects(() => resolveAccount({}), /No signer configured/);
});
