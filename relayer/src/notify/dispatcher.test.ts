import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Database as Db } from "better-sqlite3";
import { openDb } from "./db.js";
import * as queue from "./queue.js";
import { tickOnce } from "./dispatcher.js";
import type { DeliverFn } from "./channels.js";

let db: Db;
beforeEach(() => {
  db = openDb(":memory:");
});

function enqueue(now: number, logIndex = 0): void {
  queue.enqueue(db, {
    agentOwner: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    endpoint: "https://example.com/hook",
    payload: '{"type":"RecoveryInitiated"}',
    txHash:
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    logIndex,
    now,
  });
}

test("tickOnce delivers due rows and acks them", async () => {
  enqueue(1000);
  const calls: string[] = [];
  const deliver: DeliverFn = async (endpoint, payload) => {
    calls.push(`${endpoint}|${payload}`);
  };
  await tickOnce(db, deliver, () => 1000, 50);

  assert.equal(calls.length, 1);
  assert.match(calls[0]!, /example\.com\/hook/);
  assert.equal(queue.counts(db).pending, 0);
});

test("tickOnce schedules a retry on delivery failure", async () => {
  enqueue(1000);
  const failing: DeliverFn = async () => {
    throw new Error("502");
  };
  await tickOnce(db, failing, () => 1000, 50);

  // Row is still pending (now with attempts=1, backed off)
  assert.equal(queue.counts(db).pending, 1);
  // Not due immediately
  assert.equal(queue.due(db, 1000).length, 0);
  // Becomes due after first backoff (30s)
  const after = queue.due(db, 1000 + 30_000);
  assert.equal(after.length, 1);
  assert.equal(after[0]?.attempts, 1);
  assert.equal(after[0]?.lastError, "502");
});

test("repeated failure across many ticks marks the row dead", async () => {
  enqueue(0);
  const failing: DeliverFn = async () => {
    throw new Error("nope");
  };
  // Drive far enough into the future on each tick that the row is always due.
  let now = 0;
  for (let i = 0; i < queue.MAX_ATTEMPTS; i++) {
    await tickOnce(db, failing, () => now, 50);
    now += 60 * 60 * 1000; // jump 1h to guarantee due-ness
  }

  const c = queue.counts(db);
  assert.equal(c.dead, 1);
  assert.equal(c.pending, 0);
});

test("tickOnce ignores rows whose backoff hasn't elapsed", async () => {
  enqueue(1000);
  const failing: DeliverFn = async () => {
    throw new Error("503");
  };
  // First failure
  await tickOnce(db, failing, () => 1000, 50);

  // Run another tick at t=1500 — still inside the 30s backoff window
  let calls = 0;
  const counting: DeliverFn = async () => {
    calls++;
  };
  await tickOnce(db, counting, () => 1500, 50);
  assert.equal(calls, 0); // row not due yet, no delivery attempt
});
