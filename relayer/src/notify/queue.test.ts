import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Database as Db } from "better-sqlite3";
import { openDb } from "./db.js";
import * as queue from "./queue.js";

let db: Db;
beforeEach(() => {
  db = openDb(":memory:");
});

const args = (overrides: Partial<queue.EnqueueArgs> = {}): queue.EnqueueArgs => ({
  agentOwner: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  endpoint: "https://example.com/hook",
  payload: '{"type":"RecoveryInitiated"}',
  txHash:
    "0x1111111111111111111111111111111111111111111111111111111111111111",
  logIndex: 0,
  ...overrides,
});

test("enqueue inserts a new row and returns true", () => {
  const inserted = queue.enqueue(db, args({ now: 1000 }));
  assert.equal(inserted, true);
  const due = queue.due(db, 1000);
  assert.equal(due.length, 1);
  assert.equal(due[0]?.attempts, 0);
});

test("enqueue is idempotent on (tx_hash, log_index)", () => {
  // Same event delivered twice (e.g. on watcher restart) → only one row.
  assert.equal(queue.enqueue(db, args({ now: 1000 })), true);
  assert.equal(queue.enqueue(db, args({ now: 2000 })), false);
  assert.equal(queue.due(db, 3000).length, 1);
});

test("due returns nothing when no rows are ready", () => {
  queue.enqueue(db, args({ now: 5000 }));
  // Time hasn't reached next_attempt_at yet
  assert.equal(queue.due(db, 4999).length, 0);
});

test("ack removes the row", () => {
  queue.enqueue(db, args({ now: 1000 }));
  const [row] = queue.due(db, 1000);
  assert.ok(row);
  queue.ack(db, row.id);
  assert.equal(queue.due(db, 9999).length, 0);
});

test("fail increments attempts and pushes next_attempt_at out", () => {
  queue.enqueue(db, args({ now: 1000 }));
  const [row] = queue.due(db, 1000);
  assert.ok(row);

  queue.fail(db, row.id, "boom", 1000);

  const stillDue = queue.due(db, 1000);
  // attempt 1 backoff is 30s; not due yet
  assert.equal(stillDue.length, 0);

  const [later] = queue.due(db, 1000 + 30_000);
  assert.ok(later);
  assert.equal(later.attempts, 1);
  assert.equal(later.lastError, "boom");
});

test("fail eventually marks the row dead and stops returning it", () => {
  queue.enqueue(db, args({ now: 0 }));
  const [row] = queue.due(db, 0);
  assert.ok(row);

  for (let i = 0; i < queue.MAX_ATTEMPTS; i++) {
    queue.fail(db, row.id, `fail ${i}`, 0);
  }
  // Even at far-future time, dead rows are NOT returned.
  assert.equal(queue.due(db, 1e15).length, 0);

  const c = queue.counts(db);
  assert.equal(c.dead, 1);
  assert.equal(c.pending, 0);
});

test("computeBackoffMs grows exponentially and caps at 1h", () => {
  assert.equal(queue.computeBackoffMs(1), 30_000);
  assert.equal(queue.computeBackoffMs(2), 60_000);
  assert.equal(queue.computeBackoffMs(3), 120_000);
  // cap
  assert.equal(queue.computeBackoffMs(20), 60 * 60 * 1000);
});
