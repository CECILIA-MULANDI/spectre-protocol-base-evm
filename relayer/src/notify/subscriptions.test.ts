import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "./db.js";
import * as subs from "./subscriptions.js";

beforeEach(() => {
  // Each test gets a fresh in-memory DB. setDb() points the module-level
  // singleton at it so calls don't leak between tests.
  subs.setDb(openDb(":memory:"));
});

test("get returns undefined for an unregistered owner", () => {
  assert.equal(subs.get("0x1111111111111111111111111111111111111111"), undefined);
});

test("set then get round-trips", () => {
  subs.set({
    agentOwner: "0xAaAaaaAaAaaaaaAaAaaaAAAaAaaaAAaAAaAaaAaA",
    channel: { kind: "webhook", endpoint: "https://example.com/hook" },
    createdAt: 1234,
  });
  const found = subs.get("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.deepEqual(found, {
    // address normalized to lowercase on write
    agentOwner: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    channel: { kind: "webhook", endpoint: "https://example.com/hook" },
    createdAt: 1234,
  });
});

test("address comparison is case-insensitive", () => {
  subs.set({
    agentOwner: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    channel: { kind: "webhook", endpoint: "https://example.com/hook" },
    createdAt: 1234,
  });
  // checksum and lowercase forms must both find the same record
  assert.ok(subs.get("0xAaAaaaAaAaaaaaAaAaaaAAAaAaaaAAaAAaAaaAaA"));
  assert.ok(subs.get("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
});

test("set replaces an existing subscription (upsert)", () => {
  const owner = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
  subs.set({
    agentOwner: owner,
    channel: { kind: "webhook", endpoint: "https://old.example/hook" },
    createdAt: 1,
  });
  subs.set({
    agentOwner: owner,
    channel: { kind: "webhook", endpoint: "https://new.example/hook" },
    createdAt: 2,
  });
  const found = subs.get(owner);
  assert.equal(found?.channel.endpoint, "https://new.example/hook");
  assert.equal(found?.createdAt, 2);
  assert.equal(subs.all().length, 1);
});

test("remove deletes and reports whether anything was removed", () => {
  const owner = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
  subs.set({
    agentOwner: owner,
    channel: { kind: "webhook", endpoint: "https://example.com/hook" },
    createdAt: 1,
  });
  assert.equal(subs.remove(owner), true);
  assert.equal(subs.get(owner), undefined);
  assert.equal(subs.remove(owner), false);
});

test("all returns subscriptions ordered by created_at", () => {
  subs.set({
    agentOwner: "0x2222222222222222222222222222222222222222",
    channel: { kind: "webhook", endpoint: "https://b.example/hook" },
    createdAt: 200,
  });
  subs.set({
    agentOwner: "0x1111111111111111111111111111111111111111",
    channel: { kind: "webhook", endpoint: "https://a.example/hook" },
    createdAt: 100,
  });
  const list = subs.all();
  assert.equal(list.length, 2);
  assert.equal(list[0]?.createdAt, 100);
  assert.equal(list[1]?.createdAt, 200);
});
