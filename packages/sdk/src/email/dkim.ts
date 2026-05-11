import { base64ToBytes, base64UrlToBigInt } from "./bytes.js";
import type { RSAPublicKey } from "./types.js";

const DEFAULT_DOH_URL = "https://cloudflare-dns.com/dns-query";

export type DKIMLookupOptions = {
  dohUrl?: string;
  fetchImpl?: typeof fetch;
};

export async function fetchDKIMPublicKey(
  selector: string,
  domain: string,
  options: DKIMLookupOptions = {}
): Promise<RSAPublicKey> {
  const dohUrl = options.dohUrl ?? DEFAULT_DOH_URL;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) throw new Error("fetch is not available in this environment");

  const dnsName = `${selector}._domainkey.${domain}`;
  const url = `${dohUrl}?name=${encodeURIComponent(dnsName)}&type=TXT`;
  const resp = await fetchImpl(url, { headers: { Accept: "application/dns-json" } });
  if (!resp.ok) throw new Error(`DoH lookup failed for ${dnsName}: ${resp.status}`);
  const json = (await resp.json()) as { Answer?: { data: string }[] };

  if (!json.Answer?.length) throw new Error(`No DKIM TXT record found for ${dnsName}`);
  // Multiple TXT chunks may be concatenated and each chunk is surrounded by quotes.
  const txt = json.Answer.map((a) => a.data.replace(/^"|"$/g, "").replace(/"\s*"/g, "")).join("");
  const match = txt.match(/p=([A-Za-z0-9+/=]+)/);
  if (!match?.[1]) throw new Error(`No public key (p=) found in DNS for ${dnsName}`);

  return parseSpkiPublicKey(match[1]);
}

async function parseSpkiPublicKey(spkiBase64: string): Promise<RSAPublicKey> {
  const spki = base64ToBytes(spkiBase64);
  const key = await crypto.subtle.importKey(
    "spki",
    spki as unknown as BufferSource,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["verify"]
  );
  const jwk = await crypto.subtle.exportKey("jwk", key);
  if (!jwk.n || !jwk.e) throw new Error("Exported JWK missing RSA modulus or exponent");
  return {
    modulus: base64UrlToBigInt(jwk.n),
    exponent: base64UrlToBigInt(jwk.e),
  };
}
