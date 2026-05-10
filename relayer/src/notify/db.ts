/**
 * SQLite schema + connection manager for the notification subsystem.
 *
 * Tables:
 *   subscriptions          — one row per subscribed agent owner
 *   watcher_cursor         — single-row table holding the last-processed block
 *   processed_events       — (txHash, logIndex) idempotency set
 *   pending_notifications  — durable retry queue for outbound webhooks
 *
 * The DB lives at relayer/state/spectre.db by default. Tests pass `:memory:`.
 *
 * Design notes:
 * - WAL mode for concurrent readers/writers without blocking.
 * - bigint values (block numbers, timestamps) stored as TEXT to avoid the
 *   IEEE-754 issues SQLite's INTEGER affinity has past 2^53.
 * - Foreign keys NOT used — the queue and processed_events are append-mostly
 *   logs, not normalized data. Keeping them denormalized makes ops simpler.
 */
import Database, { type Database as Db } from "better-sqlite3";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DB_PATH = resolve(__dirname, "../../state/spectre.db");

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS subscriptions (
  agent_owner       TEXT PRIMARY KEY NOT NULL,
  channel_kind      TEXT NOT NULL,
  channel_endpoint  TEXT NOT NULL,
  created_at        INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS watcher_cursor (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  last_processed_block  TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS processed_events (
  tx_hash       TEXT NOT NULL,
  log_index     INTEGER NOT NULL,
  processed_at  INTEGER NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
) STRICT;

CREATE TABLE IF NOT EXISTS pending_notifications (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_owner      TEXT NOT NULL,
  endpoint         TEXT NOT NULL,
  payload          TEXT NOT NULL,
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  INTEGER NOT NULL,
  last_error       TEXT,
  dead             INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  tx_hash          TEXT NOT NULL,
  log_index        INTEGER NOT NULL,
  UNIQUE (tx_hash, log_index)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_pending_due
  ON pending_notifications (next_attempt_at)
  WHERE dead = 0;
`;

export function openDb(path: string = DEFAULT_DB_PATH): Db {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.exec(SCHEMA);
  return db;
}
