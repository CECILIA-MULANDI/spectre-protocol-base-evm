import { simpleParser } from "mailparser";
import type { DKIMFields, ParsedEmail, Sequence } from "./types.js";

/** Parses a .eml file and extracts DKIM fields for the circuit. */
export async function parseEmail(rawEml: Buffer): Promise<ParsedEmail> {
  const parsed = await simpleParser(rawEml);
  const fromAddress = extractFromAddress(parsed);
  const dkim = extractDKIMFields(rawEml);
  const fromHeaderSequence = findFromHeaderSequence(dkim.canonicalHeader);
  const fromAddressSequence = findFromAddressSequence(
    dkim.canonicalHeader,
    fromHeaderSequence,
    fromAddress
  );
  return { fromAddress, dkim, fromHeaderSequence, fromAddressSequence };
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
  // Unfold continuation lines + collapse whitespace per RFC 6376 §3.4.2
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

  // Relaxed canonicalization per RFC 6376 §3.4.2
  const signedHeaders = headers.split(":").map((h) => h.trim());
  const lines: string[] = [];

  // RFC 6376 §3.7: consume repeated header names in reverse order
  const consumed = new Map<string, number>();

  for (const name of signedHeaders) {
    const nameLower = name.toLowerCase();
    const useCount = consumed.get(nameLower) ?? 0;
    consumed.set(nameLower, useCount + 1);

    const allMatches = [
      ...emailStr.matchAll(new RegExp(`^${name}:[^\r\n]*`, "gim")),
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

  return { algorithm, domain, selector, canonicalHeader, signatureBytes };
}
function findFromHeaderSequence(canonicalHeader: Buffer): Sequence {
  const neddle = Buffer.from("from:", "utf-8");
  for (let i = 0; i <= canonicalHeader.length - neddle.length; i++) {
    if (canonicalHeader.subarray(i, i + neddle.length).equals(neddle)) {
      let end = canonicalHeader.indexOf("\r\n", i);
      if (end === -1) end = canonicalHeader.length;
      return { index: i, length: end - i };
    }
  }
  throw new Error("Could not find 'from:' header in canonicalized header");
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
    index: fromHeaderSeq.index + relativeIndex, // absolute position in canonicalHeader
    length: needle.length,
  };
}
