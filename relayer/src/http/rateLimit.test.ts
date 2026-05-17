import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRateLimiter } from "./rateLimit.js";

interface Ctx {
  req: { ip: string };
  res: { status(c: number): unknown; json(b: unknown): unknown };
  next: () => void;
  statusCode: number;
  body: unknown;
  nextCalls: number;
}

function ctx(ip = "1.2.3.4"): Ctx {
  const c = { statusCode: 0, body: null as unknown, nextCalls: 0 } as Ctx;
  c.req = { ip };
  c.res = {
    status(code: number) {
      c.statusCode = code;
      return c.res;
    },
    json(b: unknown) {
      c.body = b;
      return c.res;
    },
  };
  c.next = () => {
    c.nextCalls += 1;
  };
  return c;
}

test("allows up to capacity, then 429s further requests from the same IP", () => {
  const limit = makeRateLimiter({ capacity: 3, refillPerSec: 0.00001 });

  for (let i = 0; i < 3; i++) {
    const c = ctx();
    limit(c.req as never, c.res as never, c.next);
    assert.equal(c.nextCalls, 1, `request ${i} should pass`);
  }

  const blocked = ctx();
  limit(blocked.req as never, blocked.res as never, blocked.next);
  assert.equal(blocked.nextCalls, 0);
  assert.equal(blocked.statusCode, 429);
  assert.deepEqual(blocked.body, { error: "rate limit exceeded" });
});

test("buckets are per-IP — one IP's exhaustion does not affect another", () => {
  const limit = makeRateLimiter({ capacity: 1, refillPerSec: 0.00001 });

  const a1 = ctx("10.0.0.1");
  limit(a1.req as never, a1.res as never, a1.next);
  assert.equal(a1.nextCalls, 1);

  const a2 = ctx("10.0.0.1");
  limit(a2.req as never, a2.res as never, a2.next);
  assert.equal(a2.statusCode, 429); // same IP, exhausted

  const b1 = ctx("10.0.0.2");
  limit(b1.req as never, b1.res as never, b1.next);
  assert.equal(b1.nextCalls, 1); // different IP, fresh bucket
});

test("tokens refill over time", async () => {
  const limit = makeRateLimiter({ capacity: 1, refillPerSec: 1000 });

  const first = ctx();
  limit(first.req as never, first.res as never, first.next);
  assert.equal(first.nextCalls, 1);

  const exhausted = ctx();
  limit(exhausted.req as never, exhausted.res as never, exhausted.next);
  assert.equal(exhausted.statusCode, 429);

  await new Promise((r) => setTimeout(r, 25)); // 25ms * 1000/s ≫ 1 token

  const afterRefill = ctx();
  limit(afterRefill.req as never, afterRefill.res as never, afterRefill.next);
  assert.equal(afterRefill.nextCalls, 1);
});

test("rejects nonsensical configuration", () => {
  assert.throws(() => makeRateLimiter({ capacity: 0, refillPerSec: 1 }));
  assert.throws(() => makeRateLimiter({ capacity: 5, refillPerSec: 0 }));
});
