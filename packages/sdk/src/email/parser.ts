import { decodeUtf8, encodeUtf8, indexOfBytes } from "./bytes.js";
import type { DKIMFields, ParsedEmail, Sequence } from "./types.js";

const BINDING_PREFIX = "spectre:";

export async function parseEmail(rawEml: Uint8Array): Promise<ParsedEmail> {
  const emailStr = decodeUtf8(rawEml);
  const fromAddress = extractFromAddress(emailStr);
  const dkim = extractDKIMFields(emailStr);
  const fromHeaderSequence = findHeaderFieldSequence(dkim.canonicalHeader, "from");
  const fromAddressSequence = findFromAddressSequence(
    dkim.canonicalHeader,
    fromHeaderSequence,
    fromAddress
  );
  const { subjectValueStart, subjectValueEnd } = findSubjectValueRange(dkim.canonicalHeader);
  const bindingOffset = findBindingOffset(
    dkim.canonicalHeader,
    subjectValueStart,
    subjectValueEnd
  );
  return {
    fromAddress,
    dkim,
    fromHeaderSequence,
    fromAddressSequence,
    subjectValueStart,
    subjectValueEnd,
    bindingOffset,
  };
}

function extractFromAddress(emailStr: string): string {
  const match = emailStr.match(/^From:[ \t]*([\s\S]*?)(?=\r?\n[^ \t])/im);
  if (!match?.[1]) throw new Error("No From header found in email");
  const headerValue = match[1].replace(/\r?\n[ \t]+/g, " ").trim();
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

  return {
    algorithm,
    domain,
    selector,
    canonicalHeader,
    signatureBytes,
  };
}

function findHeaderFieldSequence(canonicalHeader: Uint8Array, fieldName: string): Sequence {
  const needle = encodeUtf8(`${fieldName}:`);
  // Look for the field anchored at start-of-line: either at offset 0 or preceded by CRLF.
  let pos = 0;
  while (pos <= canonicalHeader.length - needle.length) {
    const idx = indexOfBytes(canonicalHeader, needle, pos);
    if (idx === -1) break;
    const atLineStart =
      idx === 0 ||
      (idx >= 2 &&
        canonicalHeader[idx - 2] === 0x0d &&
        canonicalHeader[idx - 1] === 0x0a);
    if (atLineStart) {
      const crlf = indexOfBytes(canonicalHeader, encodeUtf8("\r\n"), idx);
      const end = crlf === -1 ? canonicalHeader.length : crlf;
      return { index: idx, length: end - idx };
    }
    pos = idx + 1;
  }
  throw new Error(`Could not find '${fieldName}:' header at start of a canonical header line`);
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
  if (relativeIndex === -1) {
    throw new Error(`Could not find "${fromAddress}" within the from: header`);
  }
  return {
    index: fromHeaderSeq.index + relativeIndex,
    length: needle.length,
  };
}

function findSubjectValueRange(canonicalHeader: Uint8Array): {
  subjectValueStart: number;
  subjectValueEnd: number;
} {
  const subjectSeq = findHeaderFieldSequence(canonicalHeader, "subject");
  // Skip past "subject:" (8 bytes) to reach the value.
  return {
    subjectValueStart: subjectSeq.index + "subject:".length,
    subjectValueEnd: subjectSeq.index + subjectSeq.length,
  };
}

function findBindingOffset(
  canonicalHeader: Uint8Array,
  subjectValueStart: number,
  subjectValueEnd: number
): number {
  const subjectValue = canonicalHeader.subarray(subjectValueStart, subjectValueEnd);
  const needle = encodeUtf8(BINDING_PREFIX);
  const relative = indexOfBytes(subjectValue, needle);
  if (relative === -1) {
    throw new Error(
      `Subject must contain '${BINDING_PREFIX}<newOwner>:<nonce>' - none found`
    );
  }
  return subjectValueStart + relative;
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
