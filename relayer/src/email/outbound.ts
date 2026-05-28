/**
 * Email-ownership confirmation challenges.
 *
 * Issue a one-time code to an email address, then verify it back. Used by the
 * `/email/challenge` + `/email/verify` HTTP routes (see server.ts) to give the
 * UI a way to confirm a user controls an email address *before* they sign the
 * on-chain `register(emailHash)` transaction.
 *
 * The on-chain registry intentionally does not validate email ownership — see
 * `project_gas_sponsorship_oos` and the registry's `_register`. This file is
 * the recommended product UX layer that catches honest typos. A user can still
 * bypass it by calling `register(emailHash)` directly.
 *
 * Required env:
 *   RESEND_API_KEY  — Resend API key
 *   EMAIL_FROM      — verified sender, e.g. "Spectre <noreply@yourdomain.com>"
 *
 * State is in-memory (Map). Acceptable for v1 single-instance relayer.
 * Persist via SQLite (relayer/src/notify/db.ts pattern) when scaling out.
 */
import { Resend } from "resend";

const COOLDOWN_MS = 60_000; // per-email cooldown between sends
const TTL_MS = 10 * 60_000; // challenge validity window
const CODE_LENGTH = 6;

export class ChallengeCooldownError extends Error {
  readonly name = "ChallengeCooldownError";
  constructor(public readonly retryAfterMs: number) {
    super(`challenge cooldown — retry in ${Math.ceil(retryAfterMs / 1000)}s`);
  }
}

export class EmailConfigError extends Error {
  readonly name = "EmailConfigError";
}

type ChallengeEntry = { code: string; expiresAt: number };

const challenges = new Map<string, ChallengeEntry>();
const lastSent = new Map<string, number>();

let resendClient: Resend | null | undefined;
function getResend(): Resend {
  if (resendClient === undefined) {
    const key = process.env.RESEND_API_KEY;
    resendClient = key ? new Resend(key) : null;
  }
  if (!resendClient) throw new EmailConfigError("RESEND_API_KEY is not set");
  return resendClient;
}

function getFromAddress(): string {
  const from = process.env.EMAIL_FROM;
  if (!from) throw new EmailConfigError("EMAIL_FROM is not set");
  return from;
}

function randomDigits(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

// Must match the SDK's normalization at packages/sdk/src/contracts/registry.ts:264.
// Any divergence means we confirm one string and the user hashes a different one.
function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

export async function issueChallenge(email: string): Promise<void> {
  const key = normalizeEmail(email);
  const now = Date.now();
  const lastAt = lastSent.get(key) ?? 0;
  if (now - lastAt < COOLDOWN_MS) {
    throw new ChallengeCooldownError(COOLDOWN_MS - (now - lastAt));
  }

  const resend = getResend();
  const from = getFromAddress();
  const code = randomDigits(CODE_LENGTH);

  await resend.emails.send({
    from,
    to: email,
    subject: "Confirm your Spectre recovery email",
    text:
      `Your Spectre confirmation code is ${code}.\n\n` +
      `It expires in 10 minutes. If you didn't request this, you can ignore this email.`,
  });

  // Record only after send succeeds, so a Resend outage doesn't lock the user
  // out of retrying.
  challenges.set(key, { code, expiresAt: now + TTL_MS });
  lastSent.set(key, now);
}

export function verifyChallenge(email: string, code: string): boolean {
  const key = normalizeEmail(email);
  const c = challenges.get(key);
  if (!c) return false;
  if (Date.now() > c.expiresAt) {
    challenges.delete(key);
    return false;
  }
  if (c.code !== code) return false;
  challenges.delete(key); // single-use
  return true;
}
