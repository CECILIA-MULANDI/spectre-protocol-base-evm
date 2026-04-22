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
  const canonicalBody = extractCanonicalBody(rawEml);
  return { fromAddress, dkim, fromHeaderSequence, fromAddressSequence, canonicalBody };
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

  // Find dkim-signature field position in canonicalHeader
  const dkimFieldStart = canonicalHeader.lastIndexOf(
    Buffer.from("dkim-signature:", "utf8")
  );
  if (dkimFieldStart === -1) throw new Error("dkim-signature field not found in canonical header");
  const dkimHeaderSequence: Sequence = {
    index: dkimFieldStart,
    length: canonicalHeader.length - dkimFieldStart,
  };

  // Find the base64 body hash value — locate "; bh=" or ":bh=" then skip past "bh="
  const dkimFieldStr = canonicalHeader.toString("utf8", dkimFieldStart);
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

/**
 * Extracts and DKIM relaxed-canonicalizes the plain-text body.
 * RFC 6376 §3.4.4 relaxed body: strip trailing whitespace per line,
 * normalize line endings to CRLF, strip excess trailing blank lines,
 * ensure exactly one trailing CRLF.
 */
function extractCanonicalBody(rawEml: Buffer): Buffer {
  const emailStr = rawEml.toString("utf-8");
  // Split on the blank line separating headers from body
  const separatorMatch = emailStr.match(/\r?\n\r?\n/);
  if (!separatorMatch || separatorMatch.index === undefined)
    throw new Error("No header/body separator found in email");
  const rawBody = emailStr.slice(separatorMatch.index + separatorMatch[0].length);

  const lines = rawBody.split(/\r?\n/);
  const canonicalized = lines.map((line) =>
    line.replace(/[ \t]+$/, "").replace(/[ \t]+/g, " ")
  );
  // Strip trailing empty lines
  while (canonicalized.length > 0 && canonicalized[canonicalized.length - 1] === "") {
    canonicalized.pop();
  }
  // Add single trailing CRLF (RFC 6376 §3.4.4 minimum body)
  canonicalized.push("");
  return Buffer.from(canonicalized.join("\r\n"), "utf8");
}

function findFromHeaderSequence(canonicalHeader: Buffer): Sequence {
  const needle = Buffer.from("from:", "utf-8");
  for (let i = 0; i <= canonicalHeader.length - needle.length; i++) {
    if (canonicalHeader.subarray(i, i + needle.length).equals(needle)) {
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
    index: fromHeaderSeq.index + relativeIndex,
    length: needle.length,
  };
}
