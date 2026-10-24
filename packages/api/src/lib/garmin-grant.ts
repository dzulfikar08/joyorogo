import { and, eq } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { dailyActivity, exerciseLog, garminAccount, weightLog } from "@joyorogo/db/schema/fitness";

/**
 * The Garmin connection of one user (docs/garmin.md), Personal API kind: the user creates an API key at
 * connect.garmin.com (Settings → Personal API Key) and pastes it. The key is exchanged for a bearer token that lives 24 hours
 * and has no refresh token: a new one is minted from the key. Both are secrets: they are stored in `garmin_account`,
 * never returned to a client, and never put in an error message or a log.
 */

export type GarminEnv = { GARMIN_USER_IDS?: string };

const TOKEN_URL = "https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token";
const TIMEOUT_MS = 10_000;
/** A token that expires within this long is replaced before it is used. */
export const TOKEN_REFRESH_MARGIN_MS = 60 * 60_000;
/** Expiry assumed for a token whose own `exp` cannot be read: Garmin documents 24 hours. */
const ASSUMED_LIFETIME_MS = 23 * 60 * 60_000;

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: Fetcher = (input, init) => fetch(input, init);

/** `rejected`: Garmin refused the key (wrong, revoked or expired). `unavailable`: Garmin or the network failed. */
export type GarminGrantFailure = "rejected" | "unavailable";

export class GarminGrantError extends Error {
  constructor(readonly failure: GarminGrantFailure) {
    super(`Garmin grant: ${failure}`);
    this.name = "GarminGrantError";
  }
}

/**
 * Whether Garmin is offered to this user: the `GARMIN_USER_IDS` allowlist (comma-separated user ids, or `*` for everyone;
 * empty or unset = nobody). The Personal API's terms cover a person's own data only, so until a business (OAuth) agreement
 * exists it is offered to the owner and QA. Off means the feature does not exist for them.
 */
export function garminEnabled(env: GarminEnv, userId: string): boolean {
  return (env.GARMIN_USER_IDS ?? "").split(",").some((id) => id.trim() === "*" || (id.trim() !== "" && id.trim() === userId));
}

/** The `exp` of a JWT as a date, or null when the token is not a readable JWT. */
export function tokenExpiry(jwt: string): Date | null {
  const payload = jwt.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "="));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" && Number.isFinite(exp) ? new Date(exp * 1000) : null;
  } catch {
    return null;
  }
}

/** Exchanges the key for a bearer token. 401 = the key is wrong or no longer valid. */
export async function mintToken(apiKey: string, fetcher: Fetcher = defaultFetch, now: Date = new Date()): Promise<{ token: string; expiresAt: Date }> {
  let response: Response;
  try {
    response = await fetcher(TOKEN_URL, {
      method: "POST",
      headers: { Accept: "*/*", Authorization: `ApiKey ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new GarminGrantError("unavailable");
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    throw new GarminGrantError("rejected");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new GarminGrantError("unavailable");
  }
  // The answer is the raw JWT as text, not JSON.
  const token = (await response.text()).trim();
  if (token.split(".").length !== 3) throw new GarminGrantError("unavailable");
  return { token, expiresAt: tokenExpiry(token) ?? new Date(now.getTime() + ASSUMED_LIFETIME_MS) };
}

/**
 * Connects (or reconnects with a new key) after proving the key works by minting a token with it. A wrong key throws
 * `GarminGrantError("rejected")` and stores nothing.
 */
export async function connectGarmin(
  db: Database,
  userId: string,
  apiKey: string,
  options: { now?: Date } = {},
  fetcher: Fetcher = defaultFetch,
): Promise<void> {
  const now = options.now ?? new Date();
  const minted = await mintToken(apiKey, fetcher, now);
  await db
    .insert(garminAccount)
    .values({ userId, authKind: "personal_key", apiKey, token: minted.token, tokenExpiresAt: minted.expiresAt, connectedAt: now })
    .onConflictDoUpdate({
      target: garminAccount.userId,
      set: { authKind: "personal_key", apiKey, token: minted.token, tokenExpiresAt: minted.expiresAt, lastError: null },
    });
}

export type GarminStatus =
  | { connected: false }
  | { connected: true; connectedAt: Date; lastSyncAt?: Date; lastError?: string };

/** What the account row says, without any secret. */
export async function garminStatus(db: Database, userId: string): Promise<GarminStatus> {
  const [row] = await db
    .select({ connectedAt: garminAccount.connectedAt, lastSyncAt: garminAccount.lastSyncAt, lastError: garminAccount.lastError })
    .from(garminAccount)
    .where(eq(garminAccount.userId, userId));
  if (!row) return { connected: false };
  return {
    connected: true,
    connectedAt: row.connectedAt,
    ...(row.lastSyncAt ? { lastSyncAt: row.lastSyncAt } : {}),
    ...(row.lastError ? { lastError: row.lastError } : {}),
  };
}

/**
 * A usable bearer token: the stored one until an hour before it expires (or when `force`, after Garmin answered 401),
 * else a new one minted from the key and stored. `null` when the user has no connection. A key Garmin refuses ends the
 * connection (the row is deleted, the user is asked to paste a new key; what was already imported stays).
 */
export async function freshToken(
  db: Database,
  userId: string,
  options: { force?: boolean; now?: Date } = {},
  fetcher: Fetcher = defaultFetch,
): Promise<string | null> {
  const now = options.now ?? new Date();
  const [row] = await db.select().from(garminAccount).where(eq(garminAccount.userId, userId));
  if (!row) return null;
  if (!options.force && row.token && row.tokenExpiresAt && row.tokenExpiresAt.getTime() - now.getTime() > TOKEN_REFRESH_MARGIN_MS) {
    return row.token;
  }
  try {
    const minted = await mintToken(row.apiKey, fetcher, now);
    await db
      .update(garminAccount)
      .set({ token: minted.token, tokenExpiresAt: minted.expiresAt })
      .where(eq(garminAccount.userId, userId));
    return minted.token;
  } catch (error) {
    if (error instanceof GarminGrantError && error.failure === "rejected") {
      await db.delete(garminAccount).where(eq(garminAccount.userId, userId));
    }
    throw error;
  }
}

export async function recordSync(db: Database, userId: string, outcome: { at: Date } | { error: string }): Promise<void> {
  await db
    .update(garminAccount)
    .set("at" in outcome ? { lastSyncAt: outcome.at, lastError: null } : { lastError: outcome.error.slice(0, 300) })
    .where(eq(garminAccount.userId, userId));
}

/** Everything imported from Garmin: plain diary rows that must not outlive the connection the user ended. */
export async function deleteImportedData(db: Database, userId: string): Promise<void> {
  await db.delete(exerciseLog).where(and(eq(exerciseLog.userId, userId), eq(exerciseLog.source, "garmin")));
  await db.delete(weightLog).where(and(eq(weightLog.userId, userId), eq(weightLog.source, "garmin")));
  await db.delete(dailyActivity).where(and(eq(dailyActivity.userId, userId), eq(dailyActivity.source, "garmin")));
}

/** The connection (key and token) and everything imported from Garmin go together. */
export async function disconnectGarmin(db: Database, userId: string): Promise<void> {
  await db.delete(garminAccount).where(eq(garminAccount.userId, userId));
  await deleteImportedData(db, userId);
}
