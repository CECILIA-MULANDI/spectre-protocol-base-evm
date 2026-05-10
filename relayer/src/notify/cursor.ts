/**
 * Watcher cursor — single-row table holding the last block we've processed.
 *
 * Stored as TEXT to handle bigint cleanly. SQLite's INTEGER affinity fails
 * past 2^53 and we don't want a future >9 quadrillion-block chain to be a
 * silent integer-truncation bug.
 */
import type { Database as Db } from "better-sqlite3";

export function getCursor(db: Db): bigint | undefined {
  const row = db
    .prepare("SELECT last_processed_block FROM watcher_cursor WHERE id = 1")
    .get() as { last_processed_block: string } | undefined;
  return row ? BigInt(row.last_processed_block) : undefined;
}

export function setCursor(db: Db, block: bigint): void {
  db.prepare(
    `INSERT INTO watcher_cursor (id, last_processed_block) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET last_processed_block = excluded.last_processed_block`
  ).run(block.toString());
}
