/**
 * Subscriptions DAO. Backed by SQLite via db.ts.
 *
 * For production use, callers should `setDb()` once at startup with the
 * shared connection from `openDb()`. Tests pass an in-memory DB.
 */
import type { Database as Db } from "better-sqlite3";
import { openDb } from "./db.js";

export type Channel = { kind: "webhook"; endpoint: string };

export type Subscription = {
  agentOwner: `0x${string}`;
  channel: Channel;
  createdAt: number;
};

let _db: Db | undefined;

/** Inject the shared DB connection. Production callers do this once at boot. */
export function setDb(db: Db): void {
  _db = db;
}

function db(): Db {
  if (!_db) _db = openDb();
  return _db;
}

function normalize(addr: `0x${string}`): `0x${string}` {
  return addr.toLowerCase() as `0x${string}`;
}

export function get(agentOwner: `0x${string}`): Subscription | undefined {
  const row = db()
    .prepare(
      "SELECT agent_owner, channel_kind, channel_endpoint, created_at FROM subscriptions WHERE agent_owner = ?"
    )
    .get(normalize(agentOwner)) as
    | {
        agent_owner: `0x${string}`;
        channel_kind: string;
        channel_endpoint: string;
        created_at: number;
      }
    | undefined;
  if (!row) return undefined;
  return {
    agentOwner: row.agent_owner,
    channel: { kind: "webhook", endpoint: row.channel_endpoint },
    createdAt: row.created_at,
  };
}

export function set(sub: Subscription): void {
  db()
    .prepare(
      `INSERT INTO subscriptions (agent_owner, channel_kind, channel_endpoint, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(agent_owner) DO UPDATE SET
         channel_kind     = excluded.channel_kind,
         channel_endpoint = excluded.channel_endpoint,
         created_at       = excluded.created_at`
    )
    .run(
      normalize(sub.agentOwner),
      sub.channel.kind,
      sub.channel.endpoint,
      sub.createdAt
    );
}

export function remove(agentOwner: `0x${string}`): boolean {
  const info = db()
    .prepare("DELETE FROM subscriptions WHERE agent_owner = ?")
    .run(normalize(agentOwner));
  return info.changes > 0;
}

export function all(): Subscription[] {
  const rows = db()
    .prepare(
      "SELECT agent_owner, channel_kind, channel_endpoint, created_at FROM subscriptions ORDER BY created_at ASC"
    )
    .all() as {
    agent_owner: `0x${string}`;
    channel_kind: string;
    channel_endpoint: string;
    created_at: number;
  }[];
  return rows.map((r) => ({
    agentOwner: r.agent_owner,
    channel: { kind: "webhook", endpoint: r.channel_endpoint },
    createdAt: r.created_at,
  }));
}
