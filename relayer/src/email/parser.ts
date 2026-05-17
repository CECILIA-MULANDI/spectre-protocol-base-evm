import { simpleParser } from "mailparser";
import type { DKIMFields, ParsedEmail, Sequence } from "./types.js";

const BINDING_PREFIX = "spectre:";

/**
 * Escape regex metacharacters so an attacker-controlled string can be safely
 * interpolated into a `new RegExp(...)`. Kept identical to the SDK's copy;
 * the two parsers having diverged here was audit finding S8. Exported for
 * direct unit testing.
 */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parses a .eml file and extracts the DKIM fields needed by the circuit. */
export async function parseEmail(rawEml: Buffer): Promise<ParsedEmail> {
  const parsed = await simpleParser(rawEml);
  const fromAddress = extractFromAddress(parsed);
  const dkim = extractDKIMFields(rawEml);
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

function extractFromAddress(
  parsed: Awaited<ReturnType<typeof simpleParser>>
): string {
  const from = parsed.from?.value[0]?.address;
  if (!from) throw new Error("No From address found in email");
  return from;
}

function extractDKIMFields(rawEml: Buffer): DKIMFields {
  const emailStr = rawEml.toString("utf-8");
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
  const signatureBytes = Buffer.from(sigB64, "base64");

  const signedHeaders = headers.split(":").map((h) => h.trim());
  const lines: string[] = [];
  const consumed = new Map<string, number>();

  for (const name of signedHeaders) {
    const nameLower = name.toLowerCase();
    const useCount = consumed.get(nameLower) ?? 0;
    consumed.set(nameLower, useCount + 1);
    // S8: `name` comes from the attacker-controlled DKIM `h=` tag. It MUST be
    // regex-escaped before interpolation, or a crafted .eml can inject regex
    // metacharacters into this pattern on the public /prove endpoint (ReDoS /
    // parser confusion). This mirrors the SDK parser, which already escaped.
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

  const canonicalHeader = Buffer.from(lines.join("\r\n"), "utf8");

  return {
    algorithm,
    domain,
    selector,
    canonicalHeader,
    signatureBytes,
  };
}

function findHeaderFieldSequence(canonicalHeader: Buffer, fieldName: string): Sequence {
  const needle = Buffer.from(`${fieldName}:`, "utf-8");
  let pos = 0;
  while (pos <= canonicalHeader.length - needle.length) {
    const idx = canonicalHeader.indexOf(needle, pos);
    if (idx === -1) break;
    const atLineStart =
      idx === 0 ||
      (idx >= 2 &&
        canonicalHeader[idx - 2] === 0x0d &&
        canonicalHeader[idx - 1] === 0x0a);
    if (atLineStart) {
      let end = canonicalHeader.indexOf("\r\n", idx);
      if (end === -1) end = canonicalHeader.length;
      return { index: idx, length: end - idx };
    }
    pos = idx + 1;
  }
  throw new Error(
    `Could not find '${fieldName}:' header at start of a canonical header line`
  );
}

function findFromAddressSequence(
  canonicalHeader: Buffer,
  fromHeaderSeq: Sequence,
  fromAddress: string
): Sequence {
  const fromLine = canonicalHeader.subarray(
    fromHeaderSeq.index,
    fromHeaderSeq.index + fromHeaderSeq.length
  );
  const needle = Buffer.from(fromAddress, "utf8");
  const relativeIndex = fromLine.indexOf(needle);
  if (relativeIndex === -1) {
    throw new Error(`Could not find "${fromAddress}" within the from: header`);
  }
  return {
    index: fromHeaderSeq.index + relativeIndex,
    length: needle.length,
  };
}

function findSubjectValueRange(canonicalHeader: Buffer): {
  subjectValueStart: number;
  subjectValueEnd: number;
} {
  const subjectSeq = findHeaderFieldSequence(canonicalHeader, "subject");
  return {
    subjectValueStart: subjectSeq.index + "subject:".length,
    subjectValueEnd: subjectSeq.index + subjectSeq.length,
  };
}

function findBindingOffset(
  canonicalHeader: Buffer,
  subjectValueStart: number,
  subjectValueEnd: number
): number {
  const subjectValue = canonicalHeader.subarray(subjectValueStart, subjectValueEnd);
  const needle = Buffer.from(BINDING_PREFIX, "utf-8");
  const relative = subjectValue.indexOf(needle);
  if (relative === -1) {
    throw new Error(
      `Subject must contain '${BINDING_PREFIX}<newOwner>:<nonce>' - none found`
    );
  }
  return subjectValueStart + relative;
}
