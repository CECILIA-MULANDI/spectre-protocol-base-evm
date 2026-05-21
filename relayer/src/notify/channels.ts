/**
 * Notification channels — currently webhook only.
 *
 * Email is intentionally not implemented: it requires SMTP credentials and
 * operational handling we don't want in v1. Users who want email today can
 * run a webhook→email bridge (Cloudflare Worker, AWS Lambda, Zapier, etc.).
 *
 * The dispatcher hands us an endpoint + serialized payload. We don't know
 * what's in the payload — that's deliberate, the channel is a transport.
 * Alert shape is defined by `buildAlert()` and consumed by the user's webhook.
 */

const RECOVERY_MODE_NAMES = ["None", "EmailPersonhood", "Social", "Backup"] as const;

export type RecoveryAlert = {
  type: "RecoveryInitiated";
  agentOwner: `0x${string}`;
  newOwner: `0x${string}`;
  executeAfterBlock: string; // bigint serialized
  mode: (typeof RECOVERY_MODE_NAMES)[number];
  txHash: `0x${string}`;
  blockNumber: string; // bigint serialized
  chainId: number;
  cancelInstructions: string;
};

export type AccountActivityAlert = {
  type: "AccountActivity";
  agentOwner: `0x${string}`;
  account: `0x${string}`;
  target: `0x${string}`;
  value: string; // wei, serialized
  txHash: `0x${string}`;
  blockNumber: string; // bigint serialized
  chainId: number;
  note: string;
};

export type DeliverFn = (endpoint: string, payload: string) => Promise<void>;

/**
 * Spend detected from a watched SpectreAccount. This is the closest Spectre
 * gets to compromise detection: it does not prove a hack, only that the
 * account moved value — the owner decides if it was authorized and, if not,
 * initiates a recovery (which freezes the account).
 */
export function buildAccountAlert(args: {
  agentOwner: `0x${string}`;
  account: `0x${string}`;
  target: `0x${string}`;
  value: bigint;
  txHash: `0x${string}`;
  blockNumber: bigint;
  chainId: number;
}): AccountActivityAlert {
  return {
    type: "AccountActivity",
    agentOwner: args.agentOwner,
    account: args.account,
    target: args.target,
    value: args.value.toString(),
    txHash: args.txHash,
    blockNumber: args.blockNumber.toString(),
    chainId: args.chainId,
    note:
      `SpectreAccount ${args.account} executed a call to ${args.target} ` +
      `(value ${args.value.toString()} wei). If you did not authorize this, ` +
      `initiate a recovery now — once it is pending the account freezes.`,
  };
}

export function buildAlert(args: {
  agentOwner: `0x${string}`;
  newOwner: `0x${string}`;
  executeAfterBlock: bigint;
  mode: number;
  txHash: `0x${string}`;
  blockNumber: bigint;
  chainId: number;
}): RecoveryAlert {
  const modeName = RECOVERY_MODE_NAMES[args.mode] ?? "None";
  return {
    type: "RecoveryInitiated",
    agentOwner: args.agentOwner,
    newOwner: args.newOwner,
    executeAfterBlock: args.executeAfterBlock.toString(),
    mode: modeName,
    txHash: args.txHash,
    blockNumber: args.blockNumber.toString(),
    chainId: args.chainId,
    cancelInstructions:
      `If this was not initiated by you, call cancelRecovery(${args.agentOwner}) ` +
      `from your owner key BEFORE block ${args.executeAfterBlock.toString()}.`,
  };
}

/** Default delivery: HTTP POST with a 5s timeout. */
export const deliver: DeliverFn = async (endpoint, payload) => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5_000);
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      signal: ac.signal,
    });
    if (!resp.ok) {
      throw new Error(`webhook returned ${resp.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
};
