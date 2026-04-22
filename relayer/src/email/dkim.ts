import { Resolver } from "dns/promises";
import { createPublicKey } from "crypto";

export type RSAPublicKey = {
  modulus: bigint;
  exponent: bigint;
};

export async function fetchDKIMPublicKey(
  selector: string,
  domain: string
): Promise<RSAPublicKey> {
  const dnsName = `${selector}._domainkey.${domain}`;
  const resolver = new Resolver();
  const records = await resolver.resolveTxt(dnsName);
  const txt = records.map((r) => r.join("")).join("");
  const match = txt.match(/p=([A-Za-z0-9+/=]+)/);
  if (!match?.[1]) throw new Error(`No public key found in DNS for ${dnsName}`);
  const pubkeyB64 = match[1];
  const key = createPublicKey({
    key: `-----BEGIN PUBLIC KEY-----\n${pubkeyB64}\n-----END PUBLIC KEY-----`,
    format: "pem",
    type: "spki",
  });

  const jwk = key.export({ format: "jwk" });
  if (!jwk.n || !jwk.e) throw new Error("Failed to extract RSA key components");

  const modulus = BigInt("0x" + Buffer.from(jwk.n, "base64url").toString("hex"));
  const exponent = BigInt("0x" + Buffer.from(jwk.e, "base64url").toString("hex"));

  return { modulus, exponent };
}
