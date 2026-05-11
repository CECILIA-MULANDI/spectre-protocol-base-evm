const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8");

export function encodeUtf8(s: string): Uint8Array {
  return TEXT_ENCODER.encode(s);
}

export function decodeUtf8(bytes: Uint8Array): string {
  return TEXT_DECODER.decode(bytes);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function indexOfBytes(
  haystack: Uint8Array,
  needle: Uint8Array,
  fromIndex = 0
): number {
  const n = needle.length;
  if (n === 0) return fromIndex;
  const end = haystack.length - n;
  outer: for (let i = fromIndex; i <= end; i++) {
    for (let j = 0; j < n; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export function lastIndexOfBytes(
  haystack: Uint8Array,
  needle: Uint8Array
): number {
  const n = needle.length;
  if (n === 0) return haystack.length;
  outer: for (let i = haystack.length - n; i >= 0; i--) {
    for (let j = 0; j < n; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s/g, "");
  if (typeof atob === "function") {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node fallback (no DOM atob): rely on Buffer if available
  const buf = (globalThis as { Buffer?: { from(s: string, enc: string): Uint8Array } }).Buffer;
  if (!buf) throw new Error("base64 decode unavailable");
  return new Uint8Array(buf.from(clean, "base64"));
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

export function base64UrlToBigInt(b64url: string): bigint {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = base64ToBytes(b64);
  return BigInt("0x" + bytesToHex(bytes));
}
