import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAlert, buildAccountAlert, deliver } from "./channels.js";

test("buildAlert produces the expected serializable shape", () => {
  const alert = buildAlert({
    agentOwner: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    newOwner: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    executeAfterBlock: 9_000_000n,
    mode: 1,
    txHash:
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    blockNumber: 123n,
    chainId: 84532,
  });
  assert.equal(alert.type, "RecoveryInitiated");
  assert.equal(alert.mode, "EmailPersonhood");
  // bigint fields are stringified — matters because JSON.stringify can't handle bigint
  assert.equal(alert.executeAfterBlock, "9000000");
  assert.equal(alert.blockNumber, "123");
  assert.equal(alert.chainId, 84532);
  assert.match(alert.cancelInstructions, /cancelRecovery\(0xaaaa/);
  // content is what chat sinks (Discord, Slack) render as the visible message
  assert.match(alert.content, /\[Spectre\] Recovery initiated/);
  assert.match(alert.content, /Mode: EmailPersonhood/);
  assert.match(alert.content, /Cancel before block 9000000/);
  // Alert must round-trip through JSON unchanged.
  assert.deepEqual(JSON.parse(JSON.stringify(alert)), alert);
});

test("buildAlert clamps unknown mode index to 'None'", () => {
  const alert = buildAlert({
    agentOwner: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    newOwner: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    executeAfterBlock: 1n,
    mode: 99,
    txHash:
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    blockNumber: 1n,
    chainId: 1,
  });
  assert.equal(alert.mode, "None");
});

test("buildAccountAlert produces a JSON-safe AccountActivity shape", () => {
  const alert = buildAccountAlert({
    agentOwner: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    account: "0xcccccccccccccccccccccccccccccccccccccccc",
    target: "0xdddddddddddddddddddddddddddddddddddddddd",
    value: 5_000_000_000_000_000_000n,
    txHash:
      "0x2222222222222222222222222222222222222222222222222222222222222222",
    blockNumber: 777n,
    chainId: 84532,
  });
  assert.equal(alert.type, "AccountActivity");
  assert.equal(alert.value, "5000000000000000000"); // bigint stringified
  assert.equal(alert.blockNumber, "777");
  assert.match(alert.note, /initiate a recovery/);
  // content is what chat sinks render as the visible message
  assert.match(alert.content, /\[Spectre\] SpectreAccount/);
  assert.match(alert.content, /initiate a recovery/);
  assert.deepEqual(JSON.parse(JSON.stringify(alert)), alert);
});

test("deliver POSTs JSON with content-type and rejects on non-2xx", async () => {
  let captured: { url?: string; method?: string; ct?: string; body?: string } = {};
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    captured = {
      url,
      method: init.method,
      ct: (init.headers as Record<string, string>)["content-type"],
      body: init.body as string,
    };
    return new Response("", { status: 200 });
  }) as unknown as typeof fetch;
  try {
    await deliver("https://example.com/hook", '{"a":1}');
    assert.equal(captured.url, "https://example.com/hook");
    assert.equal(captured.method, "POST");
    assert.equal(captured.ct, "application/json");
    assert.equal(captured.body, '{"a":1}');
  } finally {
    globalThis.fetch = original;
  }
});

test("deliver throws on non-2xx response", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("", { status: 503 })) as unknown as typeof fetch;
  try {
    await assert.rejects(
      () => deliver("https://example.com/hook", "{}"),
      /webhook returned 503/
    );
  } finally {
    globalThis.fetch = original;
  }
});
