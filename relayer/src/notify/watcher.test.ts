import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextWindow,
  confirmedHead,
  MAX_BLOCK_RANGE,
  DEFAULT_CONFIRMATIONS,
} from "./watcher.js";

// The watcher loop itself depends on a real RPC and is exercised by manual
// E2E. The pure block-range arithmetic is exposed for direct testing here so
// off-by-one and bounds bugs get caught.

test("returns null when head has not advanced", () => {
  assert.equal(nextWindow(100n, 100n), null);
  assert.equal(nextWindow(100n, 99n), null);
});

test("returns the full open range when head is close", () => {
  // fromBlock=100, head=105 → window [101, 105]
  assert.deepEqual(nextWindow(100n, 105n), { start: 101n, end: 105n });
});

test("clamps the window to MAX_BLOCK_RANGE", () => {
  // fromBlock=0, head=100000 → first chunk [1, 5000]
  const w = nextWindow(0n, 100_000n);
  assert.ok(w);
  assert.equal(w.start, 1n);
  assert.equal(w.end, MAX_BLOCK_RANGE); // 5000n
  // Window length is exactly MAX_BLOCK_RANGE blocks
  assert.equal(w.end - w.start + 1n, MAX_BLOCK_RANGE);
});

test("respects a custom maxRange", () => {
  const w = nextWindow(0n, 100n, 10n);
  assert.deepEqual(w, { start: 1n, end: 10n });
});

test("returns single-block window when head is exactly fromBlock+1", () => {
  assert.deepEqual(nextWindow(50n, 51n), { start: 51n, end: 51n });
});

// ── confirmedHead: reorg buffer (audit #5) ───────────────────────────────────

test("confirmedHead subtracts the default depth", () => {
  assert.equal(confirmedHead(100n), 100n - DEFAULT_CONFIRMATIONS); // 88n
});

test("confirmedHead subtracts a custom depth", () => {
  assert.equal(confirmedHead(100n, 5n), 95n);
});

test("confirmedHead returns null when the chain is shallower than the depth", () => {
  assert.equal(confirmedHead(5n, 12n), null);
});

test("confirmedHead returns 0 when head equals the depth", () => {
  assert.equal(confirmedHead(12n, 12n), 0n);
});

test("confirmedHead with 0 confirmations is the tip (opt-out)", () => {
  assert.equal(confirmedHead(100n, 0n), 100n);
});

test("confirmedHead rejects a negative depth", () => {
  assert.throws(() => confirmedHead(100n, -1n), /confirmations must be >= 0/);
});

// The core reorg-safety invariant: feeding confirmedHead() into nextWindow(),
// the processed window can never reach into the unconfirmed tip, and the
// cursor can never be advanced past the confirmed head.
test("cursor cannot outrun the confirmed head", () => {
  const head = 100n;
  const conf = 12n;
  const safe = confirmedHead(head, conf)!; // 88n

  // Behind the safe head → processes only confirmed blocks, never past 88.
  const w = nextWindow(80n, safe);
  assert.deepEqual(w, { start: 81n, end: 88n });
  assert.ok(w!.end <= safe);

  // Cursor already at the confirmed head → nothing to do (won't touch 89..100,
  // the unconfirmed/reorg-prone tip).
  assert.equal(nextWindow(safe, safe), null);

  // Cursor somehow inside the unconfirmed zone → still no window: a shallow
  // reorg there can't have produced an alert.
  assert.equal(nextWindow(95n, safe), null);
});
