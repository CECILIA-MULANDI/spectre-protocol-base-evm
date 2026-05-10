/**
 * Durable notification queue. Watcher enqueues; dispatcher consumes.
 *
 * Why this exists (vs. the previous fire-and-forget watcher): a webhook 5xx
 * or network blip used to silently lose alerts because the watcher cursor
 * advanced regardless. The queue gives at-least-once delivery — a delivery
 * either succeeds (row deleted), is retried later (row's next_attempt_at
 * pushed out), or eventually marked dead after exhausting attempts.
 *
 * The (tx_hash, log_index) UNIQUE constraint makes enqueue idempotent: if
 * the watcher re-processes a block range (e.g. on restart), duplicate inserts
 * are silently ignored, preventing duplicate notifications.
 */
import type { Database as Db } from "better-sqlite3";

export const MAX_ATTEMPTS = 10;

export type Pending = {
  id: number;
  agentOwner: `0x${string}`;
  endpoint: string;
  payload: string; // JSON-serialized alert
  attempts: number;
  nextAttemptAt: number; // unix ms
  lastError: string | null;
  createdAt: number;
  txHash: `0x${string}`;
  logIndex: number;
};

export type EnqueueArgs = {
  agentOwner: `0x${string}`;
  endpoint: string;
  payload: string;
  txHash: `0x${string}`;
  logIndex: number;
  /** Override now() — for tests. */
  now?: number;
};

/**
 * Enqueue a notification. Returns true if newly inserted, false if already
 * pending (dedup hit on the (tx_hash, log_index) unique constraint).
 */
export function enqueue(db: Db, args: EnqueueArgs): boolean {
  const now = args.now ?? Date.now();
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO pending_notifications
         (agent_owner, endpoint, payload, attempts, next_attempt_at, created_at, tx_hash, log_index)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?)`
    )
    .run(
      args.agentOwner.toLowerCase(),
      args.endpoint,
      args.payload,
      now,
      now,
      args.txHash.toLowerCase(),
      args.logIndex
    );
  return info.changes > 0;
}

/** Pop up to `limit` pending rows whose next_attempt_at <= now. */
export function due(db: Db, now: number, limit = 50): Pending[] {
  const rows = db
    .prepare(
      `SELECT id, agent_owner, endpoint, payload, attempts, next_attempt_at,
              last_error, created_at, tx_hash, log_index
       FROM pending_notifications
       WHERE dead = 0 AND next_attempt_at <= ?
       ORDER BY next_attempt_at ASC
       LIMIT ?`
    )
    .all(now, limit) as Array<{
    id: number;
    agent_owner: `0x${string}`;
    endpoint: string;
    payload: string;
    attempts: number;
    next_attempt_at: number;
    last_error: string | null;
    created_at: number;
    tx_hash: `0x${string}`;
    log_index: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    agentOwner: r.agent_owner,
    endpoint: r.endpoint,
    payload: r.payload,
    attempts: r.attempts,
    nextAttemptAt: r.next_attempt_at,
    lastError: r.last_error,
    createdAt: r.created_at,
    txHash: r.tx_hash,
    logIndex: r.log_index,
  }));
}

/** Mark a notification as successfully delivered — removes the row. */
export function ack(db: Db, id: number): void {
  db.prepare("DELETE FROM pending_notifications WHERE id = ?").run(id);
}

/**
 * Mark a delivery attempt as failed. Increments `attempts`, schedules the
 * next retry with exponential backoff (capped at 1h), and flags as `dead`
 * once we exceed MAX_ATTEMPTS.
 */
export function fail(
  db: Db,
  id: number,
  error: string,
  now: number = Date.now()
): void {
  const row = db
    .prepare("SELECT attempts FROM pending_notifications WHERE id = ?")
    .get(id) as { attempts: number } | undefined;
  if (!row) return;
  const attempts = row.attempts + 1;
  const dead = attempts >= MAX_ATTEMPTS ? 1 : 0;
  const backoffMs = computeBackoffMs(attempts);
  const nextAt = now + backoffMs;
  db.prepare(
    `UPDATE pending_notifications
        SET attempts = ?, next_attempt_at = ?, last_error = ?, dead = ?
      WHERE id = ?`
  ).run(attempts, nextAt, error, dead, id);
}

/**
 * Exponential backoff: 30s, 1m, 2m, 4m, 8m, 16m, 32m, 1h (capped).
 * Total budget across MAX_ATTEMPTS=10 attempts ≈ 7-8 hours.
 */
export function computeBackoffMs(attempts: number): number {
  const base = 30_000;
  const cap = 60 * 60 * 1000;
  const exp = Math.min(base * 2 ** (attempts - 1), cap);
  return exp;
}

/** Visibility / debugging: how many rows are pending or dead. */
export function counts(db: Db): { pending: number; dead: number } {
  const r = db
    .prepare(
      `SELECT
         SUM(CASE WHEN dead = 0 THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN dead = 1 THEN 1 ELSE 0 END) AS dead
       FROM pending_notifications`
    )
    .get() as { pending: number | null; dead: number | null };
  return { pending: r.pending ?? 0, dead: r.dead ?? 0 };
}
