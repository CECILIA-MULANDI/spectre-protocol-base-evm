import { decodeUtf8, encodeUtf8, indexOfBytes, lastIndexOfBytes } from "./bytes.js";
import type { DKIMFields, ParsedEmail, Sequence } from "./types.js";

export async function parseEmail(rawEml: Uint8Array): Promise<ParsedEmail> {
  const emailStr = decodeUtf8(rawEml);
  const fromAddress = extractFromAddress(emailStr);
  const dkim = extractDKIMFields(emailStr);
  const fromHeaderSequence = findFromHeaderSequence(dkim.canonicalHeader);
  const fromAddressSequence = findFromAddressSequence(
    dkim.canonicalHeader,
    fromHeaderSequence,
    fromAddress
  );
  const canonicalBody = extractCanonicalBody(emailStr);
  return { fromAddress, dkim, fromHeaderSequence, fromAddressSequence, canonicalBody };
}

function extractFromAddress(emailStr: string): string {
  // RFC 5322 From: header. Stop at end-of-line that isn't followed by whitespace (folding).
  const match = emailStr.match(/^From:[ \t]*([\s\S]*?)(?=\r?\n[^ \t])/im);
  if (!match?.[1]) throw new Error("No From header found in email");
  const headerValue = match[1].replace(/\r?\n[ \t]+/g, " ").trim();
  // Address can be either "Name <addr@host>" or just "addr@host"
  const bracketMatch = headerValue.match(/<([^>]+)>/);
  const candidate = (bracketMatch?.[1] ?? headerValue).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) {
    throw new Error(`Could not extract a valid email address from From header: ${headerValue}`);
  }
  return candidate;
}

function extractDKIMFields(emailStr: string): DKIMFields {
  const dkimMatch = emailStr.match(
    /DKIM-Signature:([\s\S]*?)(?=\r?\n\S|\r?\n\r?\n)/i
  );
  if (!dkimMatch?.[1]) throw new Error("No DKIM-Signature header found");
  const dkimHeader = dkimMatch[1].replace(/\r?\n/g, "").replace(/\s+/g, " ");

  const get = (tag: string): string => {
    const m = dkimHeader.match(new RegExp(`(?:^|;)\\s*${tag}=([^;]+)`));
    if (!m?.[1]) throw new Error(`DKIM tag '${tag}' not found`);
    return m[1].trim();
  };

  const algorithm = get("a");
  const domain = get("d");
  const selector = get("s");
  const headers = get("h");
  const sigB64 = get("b").replace(/\s/g, "");
  const signatureBytes = base64Decode(sigB64);

  const signedHeaders = headers.split(":").map((h) => h.trim());
  const lines: string[] = [];
  const consumed = new Map<string, number>();

  for (const name of signedHeaders) {
    const nameLower = name.toLowerCase();
    const useCount = consumed.get(nameLower) ?? 0;
    consumed.set(nameLower, useCount + 1);
    const allMatches = [
      ...emailStr.matchAll(new RegExp(`^${escapeRegex(name)}:[^\r\n]*`, "gim")),
    ];
    const targetIndex = allMatches.length - 1 - useCount;
    if (targetIndex < 0) continue;
    const raw = allMatches[targetIndex]![0];
    const [headerName, ...rest] = raw.split(":");
    const value = rest.join(":").trim().replace(/\s+/g, " ");
    lines.push(`${headerName!.toLowerCase()}:${value}`);
  }

  const dkimLineClean = `dkim-signature:${dkimHeader
    .replace(/b=[^;]+/, "b=")
    .trim()}`;
  lines.push(dkimLineClean);

  const canonicalHeader = encodeUtf8(lines.join("\r\n"));

  const dkimFieldStart = lastIndexOfBytes(canonicalHeader, encodeUtf8("dkim-signature:"));
  if (dkimFieldStart === -1)
    throw new Error("dkim-signature field not found in canonical header");
  const dkimHeaderSequence: Sequence = {
    index: dkimFieldStart,
    length: canonicalHeader.length - dkimFieldStart,
  };

  const dkimFieldStr = decodeUtf8(canonicalHeader.subarray(dkimFieldStart));
  const bhTagMatch = dkimFieldStr.match(/[;:][ \t]*bh=([A-Za-z0-9+/=]+)/);
  if (!bhTagMatch) throw new Error("bh= tag not found in dkim-signature field");
  const bhValueStart = dkimFieldStr.indexOf(bhTagMatch[1]!);
  const bodyHashIndex = dkimFieldStart + bhValueStart;

  return {
    algorithm,
    domain,
    selector,
    canonicalHeader,
    signatureBytes,
    dkimHeaderSequence,
    bodyHashIndex,
  };
}

function extractCanonicalBody(emailStr: string): Uint8Array {
  const separatorMatch = emailStr.match(/\r?\n\r?\n/);
  if (!separatorMatch || separatorMatch.index === undefined)
    throw new Error("No header/body separator found in email");
  const rawBody = emailStr.slice(separatorMatch.index + separatorMatch[0].length);

  const lines = rawBody.split(/\r?\n/);
  const canonicalized = lines.map((line) =>
    line.replace(/[ \t]+$/, "").replace(/[ \t]+/g, " ")
  );
  while (canonicalized.length > 0 && canonicalized[canonicalized.length - 1] === "") {
    canonicalized.pop();
  }
  canonicalized.push("");
  return encodeUtf8(canonicalized.join("\r\n"));
}

function findFromHeaderSequence(canonicalHeader: Uint8Array): Sequence {
  const needle = encodeUtf8("from:");
  const idx = indexOfBytes(canonicalHeader, needle);
  if (idx === -1)
    throw new Error("Could not find 'from:' header in canonicalized header");
  const crlf = indexOfBytes(canonicalHeader, encodeUtf8("\r\n"), idx);
  const end = crlf === -1 ? canonicalHeader.length : crlf;
  return { index: idx, length: end - idx };
}

function findFromAddressSequence(
  canonicalHeader: Uint8Array,
  fromHeaderSeq: Sequence,
  fromAddress: string
): Sequence {
  const fromLine = canonicalHeader.subarray(
    fromHeaderSeq.index,
    fromHeaderSeq.index + fromHeaderSeq.length
  );
  const needle = encodeUtf8(fromAddress);
  const relativeIndex = indexOfBytes(fromLine, needle);
  if (relativeIndex === -1)
    throw new Error(`Could not find "${fromAddress}" within the from: header`);
  return {
    index: fromHeaderSeq.index + relativeIndex,
    length: needle.length,
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function base64Decode(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const buf = (globalThis as { Buffer?: { from(s: string, enc: string): Uint8Array } }).Buffer;
  if (!buf) throw new Error("base64 decode unavailable");
  return new Uint8Array(buf.from(b64, "base64"));
}
