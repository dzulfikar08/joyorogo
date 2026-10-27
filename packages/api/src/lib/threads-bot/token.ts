// The brand account's long-lived Threads token (60 days) lives in D1 and is refreshed from here before it lapses: a Worker
// secret cannot be rotated from code (pattern: intip src/worker/threads/client.ts ensureToken). The first token comes from
// the admin Connect flow or from the THREADS_ACCESS_TOKEN secret, which only seeds the row.

import { eq } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { threadsAccount } from "@joyorogo/db/schema/threads";

import { getMe, refreshToken } from "./graph";

const DAY_MS = 86_400_000;
/** Refresh once less than this is left. */
export const REFRESH_WINDOW_MS = 7 * DAY_MS;
/** A failed refresh is retried at most this often, so a bad token does not hit Meta every cron tick. */
export const REFRESH_RETRY_MS = 6 * 3_600_000;
/** What a seeded token is assumed to have left: its real expiry is unknown, the first refresh finds out. */
const SEED_ASSUMED_LEFT_MS = 3 * DAY_MS;

export type TokenStatus = "ok" | "expiring" | "expired";

export function statusFor(expiresAt: number, now: number): TokenStatus {
  if (expiresAt <= now) return "expired";
  return expiresAt - now < REFRESH_WINDOW_MS ? "expiring" : "ok";
}

export type BotAccount = { token: string; userId: string; username: string };

type Row = typeof threadsAccount.$inferSelect;

export async function readAccount(db: Database): Promise<Row | null> {
  const [row] = await db.select().from(threadsAccount).where(eq(threadsAccount.id, 1)).limit(1);
  return row ?? null;
}

/** Stores a token from the Connect flow (replaces any row, keeps the mentions cursor so a reconnect does not replay). */
export async function saveConnectedToken(
  db: Database,
  token: { accessToken: string; expiresIn: number },
  now: number,
): Promise<Row> {
  const me = await getMe(token.accessToken);
  const expiresAt = now + token.expiresIn * 1000;
  const values = {
    threadsUserId: me.id,
    username: me.username.toLowerCase(),
    accessToken: token.accessToken,
    expiresAt: new Date(expiresAt),
    status: statusFor(expiresAt, now),
    source: "oauth" as const,
    refreshedAt: new Date(now),
    refreshAttemptedAt: null,
    lastError: null,
    updatedAt: new Date(now),
  };
  await db
    .insert(threadsAccount)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: threadsAccount.id, set: values });
  return (await readAccount(db))!;
}

async function tryRefresh(db: Database, row: Row, now: number): Promise<Row> {
  try {
    const fresh = await refreshToken(row.accessToken);
    const expiresAt = now + fresh.expiresIn * 1000;
    const set = {
      accessToken: fresh.accessToken,
      expiresAt: new Date(expiresAt),
      status: statusFor(expiresAt, now),
      refreshedAt: new Date(now),
      refreshAttemptedAt: new Date(now),
      lastError: null,
      updatedAt: new Date(now),
    };
    await db.update(threadsAccount).set(set).where(eq(threadsAccount.id, 1));
    return { ...row, ...set, expiresAt: new Date(expiresAt) };
  } catch (error) {
    const set = {
      refreshAttemptedAt: new Date(now),
      status: statusFor(row.expiresAt.getTime(), now),
      lastError: `refresh: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
      updatedAt: new Date(now),
    };
    await db.update(threadsAccount).set(set).where(eq(threadsAccount.id, 1));
    // The old token still works until Meta says otherwise.
    return { ...row, ...set };
  }
}

/**
 * The token to use now, refreshed first when it is inside the 7-day window (and the last attempt is over 6 hours old).
 * Returns null when no token exists at all (no row and no seed): callers do nothing. The own user id and username are
 * resolved once with GET /me and kept on the row.
 */
export async function ensureAccount(
  db: Database,
  seedToken: string | undefined,
  now: number,
): Promise<BotAccount | null> {
  let row = await readAccount(db);
  if (!row) {
    if (!seedToken) return null;
    const expiresAt = now + SEED_ASSUMED_LEFT_MS;
    await db
      .insert(threadsAccount)
      .values({
        id: 1,
        accessToken: seedToken,
        expiresAt: new Date(expiresAt),
        status: "expiring",
        source: "seed",
        updatedAt: new Date(now),
      })
      .onConflictDoNothing();
    row = await readAccount(db);
    if (!row) return null;
  }

  const due = row.expiresAt.getTime() - now < REFRESH_WINDOW_MS;
  const attemptedRecently =
    row.refreshAttemptedAt !== null && now - row.refreshAttemptedAt.getTime() < REFRESH_RETRY_MS;
  if (due && !attemptedRecently) row = await tryRefresh(db, row, now);
  else if (row.status !== statusFor(row.expiresAt.getTime(), now)) {
    const status = statusFor(row.expiresAt.getTime(), now);
    await db.update(threadsAccount).set({ status }).where(eq(threadsAccount.id, 1));
    row = { ...row, status };
  }

  if (!row.threadsUserId || !row.username) {
    try {
      const me = await getMe(row.accessToken);
      const set = {
        threadsUserId: me.id,
        username: me.username.toLowerCase(),
        updatedAt: new Date(now),
      };
      await db.update(threadsAccount).set(set).where(eq(threadsAccount.id, 1));
      row = { ...row, ...set };
    } catch (error) {
      await db
        .update(threadsAccount)
        .set({
          lastError: `me: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
          updatedAt: new Date(now),
        })
        .where(eq(threadsAccount.id, 1));
      return null;
    }
  }
  return { token: row.accessToken, userId: row.threadsUserId!, username: row.username! };
}
