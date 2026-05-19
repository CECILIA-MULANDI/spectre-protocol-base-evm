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
  /** Optional SpectreAccount to also watch for spend activity. */
  accountAddress?: `0x${string}`;
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

type Row = {
  agent_owner: `0x${string}`;
  channel_kind: string;
  channel_endpoint: string;
  created_at: number;
  account_address: string | null;
};

const COLS =
  "agent_owner, channel_kind, channel_endpoint, created_at, account_address";

function rowToSub(row: Row): Subscription {
  const sub: Subscription = {
    agentOwner: row.agent_owner,
    channel: { kind: "webhook", endpoint: row.channel_endpoint },
    createdAt: row.created_at,
  };
  if (row.account_address) {
    sub.accountAddress = row.account_address as `0x${string}`;
  }
  return sub;
}

export function get(agentOwner: `0x${string}`): Subscription | undefined {
  const row = db()
    .prepare(`SELECT ${COLS} FROM subscriptions WHERE agent_owner = ?`)
    .get(normalize(agentOwner)) as Row | undefined;
  return row ? rowToSub(row) : undefined;
}

/** Reverse lookup: the subscription whose watched account is `account`. */
export function byAccount(
  account: `0x${string}`
): Subscription | undefined {
  const row = db()
    .prepare(`SELECT ${COLS} FROM subscriptions WHERE account_address = ?`)
    .get(normalize(account)) as Row | undefined;
  return row ? rowToSub(row) : undefined;
}

/** Distinct SpectreAccount addresses any subscription wants watched. */
export function watchedAccounts(): `0x${string}`[] {
  const rows = db()
    .prepare(
      "SELECT DISTINCT account_address FROM subscriptions WHERE account_address IS NOT NULL"
    )
    .all() as { account_address: `0x${string}` }[];
  return rows.map((r) => r.account_address);
}

export function set(sub: Subscription): void {
  db()
    .prepare(
      `INSERT INTO subscriptions (agent_owner, channel_kind, channel_endpoint, created_at, account_address)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(agent_owner) DO UPDATE SET
         channel_kind     = excluded.channel_kind,
         channel_endpoint = excluded.channel_endpoint,
         created_at       = excluded.created_at,
         account_address  = excluded.account_address`
    )
    .run(
      normalize(sub.agentOwner),
      sub.channel.kind,
      sub.channel.endpoint,
      sub.createdAt,
      sub.accountAddress ? normalize(sub.accountAddress) : null
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
    .prepare(`SELECT ${COLS} FROM subscriptions ORDER BY created_at ASC`)
    .all() as Row[];
  return rows.map(rowToSub);
}
