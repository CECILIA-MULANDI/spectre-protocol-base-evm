import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeRegex } from "./parser.js";

test("escapeRegex escapes every regex metacharacter", () => {
  const meta = ".*+?^${}()|[]\\";
  const escaped = escapeRegex(meta);

  assert.equal(
    escaped,
    "\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\"
  );

  // Used as a pattern, the escaped form matches only the literal string.
  assert.ok(new RegExp(`^${escaped}$`).test(meta));
});

test("escapeRegex is identical to the SDK's implementation (no drift)", () => {
  // The relayer parser having diverged from the SDK here — losing this very
  // escaping — was audit finding S8. Pin the exact transformation.
  const sdkEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const s of [
    "subject",
    "x-mailer",
    "(.*a)+$",
    "a|b",
    "[A-Z]{99}",
    "weird.header+name",
  ]) {
    assert.equal(escapeRegex(s), sdkEscape(s));
  }
});

test("a malicious DKIM h= header name cannot inject regex or trigger ReDoS", () => {
  // What a hostile .eml could place in the DKIM `h=` tag. Pre-fix this went
  // raw into `new RegExp(\`^${name}:...\`)` on the public /prove endpoint.
  const evil = "(.*a){30}$";

  // Escaped, it is an inert literal — building the RegExp must not throw...
  const re = new RegExp(`^${escapeRegex(evil)}:[^\r\n]*`, "gim");

  // ...and running it over hostile input must not catastrophically backtrack.
  const hostileInput = "x".repeat(50_000) + "\n";
  const start = Date.now();
  const noMatch = [...hostileInput.matchAll(re)];
  const elapsedMs = Date.now() - start;
  assert.equal(noMatch.length, 0);
  assert.ok(elapsedMs < 250, `regex took ${elapsedMs}ms — possible ReDoS`);

  // The escaped pattern still matches the header name verbatim (parser still
  // works for a legitimately-named header that happens to contain symbols).
  const legit = `${evil}:some value\r\n`;
  assert.equal([...legit.matchAll(re)].length, 1);
});
