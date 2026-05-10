import { test } from "node:test";
import assert from "node:assert/strict";
import { nextWindow, MAX_BLOCK_RANGE } from "./watcher.js";

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
