import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { openDb } from "./db.js";
import { setDb as setSubsDb } from "./subscriptions.js";
import {
  registerNotifyRoutes,
  subscribeMessage,
  unsubscribeMessage,
} from "./api.js";

beforeEach(() => {
  setSubsDb(openDb(":memory:"));
});

async function withServer<T>(
  fn: (baseUrl: string) => Promise<T>
): Promise<T> {
  const app = express();
  app.use(express.json());
  registerNotifyRoutes(app);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("POST /subscribe accepts a valid signature and persists", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const endpoint = "https://example.com/hook";
  const nonce = "0xdeadbeef";
  const message = subscribeMessage({
    agentOwner: account.address,
    endpoint,
    nonce,
  });
  const signature = await account.signMessage({ message });

  await withServer(async (baseUrl) => {
    const r = await fetch(`${baseUrl}/subscribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentOwner: account.address,
        endpoint,
        nonce,
        signature,
      }),
    });
    assert.equal(r.status, 200);

    // GET reflects the subscription
    const g = await fetch(`${baseUrl}/subscribe/${account.address}`);
    assert.equal(g.status, 200);
    const body = (await g.json()) as { channel: { endpoint: string } };
    assert.equal(body.channel.endpoint, endpoint);
  });
});

test("POST /subscribe rejects a signature signed by the wrong key", async () => {
  const real = privateKeyToAccount(generatePrivateKey());
  const imposter = privateKeyToAccount(generatePrivateKey());
  const endpoint = "https://example.com/hook";
  const nonce = "0x1";
  const message = subscribeMessage({
    agentOwner: real.address, // claims to be `real`
    endpoint,
    nonce,
  });
  // ...but signed by imposter
  const signature = await imposter.signMessage({ message });

  await withServer(async (baseUrl) => {
    const r = await fetch(`${baseUrl}/subscribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentOwner: real.address,
        endpoint,
        nonce,
        signature,
      }),
    });
    assert.equal(r.status, 401);
  });
});

test("POST /subscribe rejects a non-http(s) endpoint", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const endpoint = "ftp://example.com/x";
  const nonce = "0x2";
  const message = subscribeMessage({
    agentOwner: account.address,
    endpoint,
    nonce,
  });
  const signature = await account.signMessage({ message });

  await withServer(async (baseUrl) => {
    const r = await fetch(`${baseUrl}/subscribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentOwner: account.address,
        endpoint,
        nonce,
        signature,
      }),
    });
    assert.equal(r.status, 400);
  });
});

test("DELETE /subscribe removes the subscription with valid signature", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const endpoint = "https://example.com/hook";

  await withServer(async (baseUrl) => {
    // Create
    {
      const nonce = "0x3";
      const message = subscribeMessage({
        agentOwner: account.address,
        endpoint,
        nonce,
      });
      const signature = await account.signMessage({ message });
      const r = await fetch(`${baseUrl}/subscribe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentOwner: account.address,
          endpoint,
          nonce,
          signature,
        }),
      });
      assert.equal(r.status, 200);
    }

    // Remove
    {
      const nonce = "0x4";
      const message = unsubscribeMessage({
        agentOwner: account.address,
        nonce,
      });
      const signature = await account.signMessage({ message });
      const r = await fetch(`${baseUrl}/subscribe/${account.address}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nonce, signature }),
      });
      assert.equal(r.status, 200);
    }

    // Confirm gone
    const g = await fetch(`${baseUrl}/subscribe/${account.address}`);
    assert.equal(g.status, 404);
  });
});

test("GET /subscribe/:agentOwner rejects a malformed address", async () => {
  await withServer(async (baseUrl) => {
    const r = await fetch(`${baseUrl}/subscribe/not-an-address`);
    assert.equal(r.status, 400);
  });
});
