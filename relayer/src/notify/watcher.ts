/**
 * Watcher — polls the chain for `RecoveryInitiated` events, enqueues them as
 * notifications for any subscribed agent owner, and advances its cursor.
 *
 * Delivery itself happens in the dispatcher (queue → webhook). This split
 * keeps the watcher focused on RPC + persistence and means a slow webhook
 * doesn't slow down log ingestion.
 *
 * Idempotency: enqueue() uses INSERT OR IGNORE on (tx_hash, log_index), so
 * cursor replay or RPC duplication never produces duplicate alerts.
 */
import type { Database as Db } from "better-sqlite3";
import { createPublicClient, http, parseAbiItem } from "viem";
import { base, baseSepolia } from "viem/chains";
import { buildAlert } from "./channels.js";
import * as subs from "./subscriptions.js";
import { getCursor, setCursor } from "./cursor.js";
import { enqueue } from "./queue.js";

const RECOVERY_INITIATED_EVENT = parseAbiItem(
  "event RecoveryInitiated(address indexed owner, address indexed newOwner, uint64 executeAfterBlock, uint8 mode)"
);

/** Largest single eth_getLogs window. Bounds catch-up after long downtime. */
export const MAX_BLOCK_RANGE = 5_000n;

export type WatcherConfig = {
  rpcUrl: string;
  registryAddress: `0x${string}`;
  /** SQLite connection. Caller manages lifecycle. */
  db: Db;
  /** Polling interval in ms. Default 5000. */
  pollIntervalMs?: number;
  /** Block to start from on a fresh DB. Default: current head. */
  startFromBlock?: bigint;
  /** Abort signal — stops the loop after the current iteration. */
  signal?: AbortSignal;
};

/**
 * Compute the next [start, end] block window. Pure — exposed for tests.
 */
export function nextWindow(
  fromBlock: bigint,
  head: bigint,
  maxRange: bigint = MAX_BLOCK_RANGE
): { start: bigint; end: bigint } | null {
  if (head <= fromBlock) return null;
  const start = fromBlock + 1n;
  const end = head - start + 1n > maxRange ? start + maxRange - 1n : head;
  return { start, end };
}

export async function startWatcher(config: WatcherConfig): Promise<void> {
  const chain = config.rpcUrl.includes("sepolia") ? baseSepolia : base;
  const client = createPublicClient({ chain, transport: http(config.rpcUrl) });
  const chainId = chain.id;
  const interval = config.pollIntervalMs ?? 5_000;
  const signal = config.signal;
  const db = config.db;

  let cursor = getCursor(db);
  if (cursor === undefined) {
    cursor = config.startFromBlock ?? (await client.getBlockNumber());
    setCursor(db, cursor);
    console.log(`[watcher] no cursor found; starting from block ${cursor}`);
  } else {
    console.log(`[watcher] resuming from block ${cursor}`);
  }

  const pollOnce = async (fromBlock: bigint): Promise<bigint> => {
    const head = await client.getBlockNumber();
    const win = nextWindow(fromBlock, head);
    if (!win) return fromBlock;

    const logs = await client.getLogs({
      address: config.registryAddress,
      event: RECOVERY_INITIATED_EVENT,
      fromBlock: win.start,
      toBlock: win.end,
    });

    for (const log of logs) {
      const owner = log.args.owner!;
      const sub = subs.get(owner);
      if (!sub) continue;

      const alert = buildAlert({
        agentOwner: owner,
        newOwner: log.args.newOwner!,
        executeAfterBlock: log.args.executeAfterBlock!,
        mode: log.args.mode!,
        txHash: log.transactionHash!,
        blockNumber: log.blockNumber!,
        chainId,
      });

      const inserted = enqueue(db, {
        agentOwner: owner,
        endpoint: sub.channel.endpoint,
        payload: JSON.stringify(alert),
        txHash: log.transactionHash!,
        logIndex: log.logIndex!,
      });
      if (inserted) {
        console.log(
          `[watcher] queued notification for ${owner} tx=${log.transactionHash} mode=${alert.mode}`
        );
      }
    }

    return win.end;
  };

  while (!signal?.aborted) {
    try {
      cursor = await pollOnce(cursor);
      setCursor(db, cursor);
    } catch (err) {
      console.error("[watcher] poll failed:", err);
    }
    if (signal?.aborted) break;
    await abortableSleep(interval, signal);
  }

  console.log("[watcher] stopped gracefully");
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
