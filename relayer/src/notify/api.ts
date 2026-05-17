/**
 * HTTP endpoints for managing notification subscriptions.
 *
 * Auth: every mutating call carries an EIP-191 signature from the agent owner
 * key over a canonical message that includes a nonce + the subscription
 * details. Read calls are public — subscriptions are not secret, and exposing
 * them lets anyone audit who's listening.
 *
 * Rate limiting: a per-IP token bucket guards the mutating endpoints so a
 * spammer can't hammer the DB with cheap signed-but-no-effect requests.
 */
import type { Express } from "express";
import { verifyMessage, isAddress, type Address } from "viem";
import * as subs from "./subscriptions.js";
import { makeRateLimiter } from "../http/rateLimit.js";

/**
 * Build the canonical message a user signs for a subscribe call. Including the
 * `endpoint` in the signed payload prevents a stolen signature from being
 * replayed against a different webhook URL.
 */
export function subscribeMessage(args: {
  agentOwner: Address;
  endpoint: string;
  nonce: string;
}): string {
  return [
    "Spectre subscribe",
    `agent: ${args.agentOwner.toLowerCase()}`,
    `endpoint: ${args.endpoint}`,
    `nonce: ${args.nonce}`,
  ].join("\n");
}

export function unsubscribeMessage(args: {
  agentOwner: Address;
  nonce: string;
}): string {
  return [
    "Spectre unsubscribe",
    `agent: ${args.agentOwner.toLowerCase()}`,
    `nonce: ${args.nonce}`,
  ].join("\n");
}

// Per-IP token bucket guarding the mutating endpoints: 10 burst, 1/s sustained.
const rateLimit = makeRateLimiter({ capacity: 10, refillPerSec: 1 });

export function registerNotifyRoutes(app: Express): void {
  app.post("/subscribe", rateLimit, async (req, res) => {
    try {
      const { agentOwner, endpoint, nonce, signature } = req.body as {
        agentOwner?: string;
        endpoint?: string;
        nonce?: string;
        signature?: string;
      };
      if (!agentOwner || !endpoint || !nonce || !signature) {
        res.status(400).json({
          error: "agentOwner, endpoint, nonce, signature required",
        });
        return;
      }
      if (!isAddress(agentOwner)) {
        res.status(400).json({ error: "agentOwner is not an address" });
        return;
      }
      if (!isHttpUrl(endpoint)) {
        res
          .status(400)
          .json({ error: "endpoint must be a valid http(s) URL" });
        return;
      }
      const message = subscribeMessage({ agentOwner, endpoint, nonce });
      const ok = await verifyMessage({
        address: agentOwner,
        message,
        signature: signature as `0x${string}`,
      });
      if (!ok) {
        res.status(401).json({ error: "signature does not match agentOwner" });
        return;
      }
      subs.set({
        agentOwner,
        channel: { kind: "webhook", endpoint },
        createdAt: Date.now(),
      });
      res.json({ ok: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.delete("/subscribe/:agentOwner", rateLimit, async (req, res) => {
    try {
      const agentOwner = String(req.params.agentOwner);
      const { nonce, signature } = req.body as {
        nonce?: string;
        signature?: string;
      };
      if (!nonce || !signature) {
        res.status(400).json({ error: "nonce, signature required" });
        return;
      }
      if (!isAddress(agentOwner)) {
        res.status(400).json({ error: "agentOwner is not an address" });
        return;
      }
      const message = unsubscribeMessage({ agentOwner, nonce });
      const ok = await verifyMessage({
        address: agentOwner,
        message,
        signature: signature as `0x${string}`,
      });
      if (!ok) {
        res.status(401).json({ error: "signature does not match agentOwner" });
        return;
      }
      const removed = subs.remove(agentOwner);
      res.json({ ok: removed });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.get("/subscribe/:agentOwner", (req, res) => {
    try {
      const agentOwner = String(req.params.agentOwner);
      if (!isAddress(agentOwner)) {
        res.status(400).json({ error: "agentOwner is not an address" });
        return;
      }
      const sub = subs.get(agentOwner);
      if (!sub) {
        res.status(404).json({ error: "no subscription" });
        return;
      }
      res.json(sub);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
