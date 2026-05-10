/**
 * Dispatcher — drains pending_notifications, delivers via the channel module,
 * and ack/fails entries with exponential backoff.
 *
 * Runs alongside the watcher. Decoupling them means a slow webhook never
 * holds up log ingestion: the watcher writes a row and moves on; the
 * dispatcher retries until success or until MAX_ATTEMPTS is reached.
 */
import type { Database as Db } from "better-sqlite3";
import { deliver, type DeliverFn } from "./channels.js";
import * as queue from "./queue.js";

export type DispatcherConfig = {
  db: Db;
  /** Polling interval in ms. Default 1000. */
  intervalMs?: number;
  /** Max rows pulled per tick. Default 50. */
  batchSize?: number;
  /** Override delivery function — for tests. Default uses the webhook channel. */
  deliverFn?: DeliverFn;
  /** Override Date.now — for tests. */
  now?: () => number;
  signal?: AbortSignal;
};

export async function startDispatcher(config: DispatcherConfig): Promise<void> {
  const interval = config.intervalMs ?? 1_000;
  const batch = config.batchSize ?? 50;
  const deliverImpl = config.deliverFn ?? deliver;
  const now = config.now ?? (() => Date.now());
  const signal = config.signal;
  const db = config.db;

  console.log("[dispatcher] started");

  while (!signal?.aborted) {
    try {
      await tickOnce(db, deliverImpl, now, batch);
    } catch (err) {
      console.error("[dispatcher] tick failed:", err);
    }
    if (signal?.aborted) break;
    await abortableSleep(interval, signal);
  }

  console.log("[dispatcher] stopped gracefully");
}

/**
 * Process one batch of due notifications. Pure-ish — pulled out so tests
 * can drive a single tick without spinning the loop.
 */
export async function tickOnce(
  db: Db,
  deliverImpl: DeliverFn,
  now: () => number,
  batchSize: number
): Promise<void> {
  const pending = queue.due(db, now(), batchSize);
  for (const row of pending) {
    try {
      await deliverImpl(row.endpoint, row.payload);
      queue.ack(db, row.id);
      console.log(
        `[dispatcher] delivered id=${row.id} agent=${row.agentOwner} attempts=${row.attempts}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      queue.fail(db, row.id, msg, now());
      console.warn(
        `[dispatcher] delivery failed id=${row.id} attempts=${row.attempts + 1}: ${msg}`
      );
    }
  }
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
