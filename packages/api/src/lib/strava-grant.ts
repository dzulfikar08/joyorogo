import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@joyorogo/db";
import { D1_MAX_PARAMS, chunk } from "./d1";
import { exerciseLog, stravaAccount, stravaRelease } from "@joyorogo/db/schema/fitness";
import { connectedAthletes } from "./strava-capacity";

/**
 * The Strava grant of one user, shared by JoyoRogo (reads activities) and JoyoFit (uploads workouts). The two
 * products are one Strava application, and Strava keeps one access/refresh token per athlete and application
 * (https://developers.strava.com/docs/authentication/: "If the application has an access token for the user ..."
 * and "Once a new refresh token is returned, the older refresh token is invalidated immediately"). Two token
 * stores would invalidate each other on every refresh, so this table is the only copy and JoyoFit's Worker asks
 * JoyoRogo for tokens (apps/server/src/strava.ts). docs/strava.md has the whole design.
 */

export type StravaProduct = "rogo" | "fit";

export type StravaGrantEnv = { STRAVA_CLIENT_ID?: string; STRAVA_CLIENT_SECRET?: string };

type GrantRow = typeof stravaAccount.$inferSelect;

const OAUTH = "https://www.strava.com/oauth";
const TIMEOUT_MS = 5_000;
/** An access token that expires within this long is refreshed before it is handed out (JoyoFit uploads with it). */
const REFRESH_MARGIN_MS = 600_000;

/** What each product asks for, and which of the granted scopes it cannot work without. */
const PRODUCTS: Record<StravaProduct, { ask: readonly string[]; usable: (granted: Set<string>) => boolean }> = {
  rogo: {
    ask: ["read", "activity:read_all"],
    usable: (granted) => granted.has("activity:read_all") || granted.has("activity:read"),
  },
  fit: { ask: ["activity:write"], usable: (granted) => granted.has("activity:write") },
};

/** `external_id` Strava keeps for a file JoyoFit uploaded (`joyofit-<workout start>`, watch-fit activityFile.ts). */
const JOYOFIT_EXTERNAL_ID_PREFIX = "joyofit-";

export function isJoyofitUpload(externalId: string | undefined): boolean {
  return externalId?.startsWith(JOYOFIT_EXTERNAL_ID_PREFIX) === true;
}

export type StravaGrantFailure = "rejected" | "unavailable" | "scope_missing" | "slots_full";

/**
 * `rejected`: Strava refused the code (used, expired, wrong app). `unavailable`: Strava or the network failed.
 * `slots_full`: every slot of the Strava application is taken (lib/strava-capacity.ts).
 */
export class StravaGrantError extends Error {
  constructor(readonly failure: StravaGrantFailure) {
    super(failure);
  }
}

export function stravaConfigured(env: StravaGrantEnv): env is Required<StravaGrantEnv> {
  return Boolean(env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET);
}

function parseScope(scope: string | null | undefined): string[] {
  return (scope ?? "").split(/[\s,]+/).filter(Boolean);
}

function linkedAt(row: GrantRow, product: StravaProduct): Date | null {
  return product === "rogo" ? row.rogoLinkedAt : row.fitLinkedAt;
}

/** The product is linked on this row and the athlete granted what it needs. */
function usableBy(row: GrantRow, product: StravaProduct): boolean {
  return linkedAt(row, product) !== null && PRODUCTS[product].usable(new Set(parseScope(row.scope)));
}

/**
 * The scope string for a product's authorize URL: its own scopes plus whatever the athlete already granted. A new
 * authorization may replace the earlier grant's scope, so asking for the union keeps the other product working.
 */
export function requestedScope(product: StravaProduct, granted: string | null | undefined): string {
  return [...new Set([...PRODUCTS[product].ask, ...parseScope(granted)])].join(",");
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_at: z.number(),
  athlete: z.object({ id: z.number() }).optional(),
  scope: z.string().optional(),
});

async function tokenRequest(env: Required<StravaGrantEnv>, params: Record<string, string>): Promise<Response> {
  try {
    return await fetch(`${OAUTH}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET, ...params }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new StravaGrantError("unavailable");
  }
}

/** Revokes a token and the grant behind it. `true` when Strava confirmed; the caller deletes its copy either way. */
export async function revoke(env: StravaGrantEnv, token: string): Promise<boolean> {
  if (!stravaConfigured(env)) return false;
  try {
    const response = await fetch(`${OAUTH}/revoke`, {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${env.STRAVA_CLIENT_ID}:${env.STRAVA_CLIENT_SECRET}`)}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token, token_type_hint: "refresh_token" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

async function readRow(db: Database, userId: string): Promise<GrantRow | undefined> {
  const [row] = await db.select().from(stravaAccount).where(eq(stravaAccount.userId, userId));
  return row;
}

export type StravaGrantStatus = {
  /** The product is linked and the granted scope covers it. */
  connected: boolean;
  athleteId?: string;
  connectedAt?: Date;
  /** Scope string for the product's next authorize URL (own scopes plus what is already granted). */
  requestedScope: string;
};

export async function grantStatus(db: Database, userId: string, product: StravaProduct): Promise<StravaGrantStatus> {
  const row = await readRow(db, userId);
  const asked = requestedScope(product, row?.scope);
  const connectedAt = row ? linkedAt(row, product) : null;
  if (!row || !connectedAt || !usableBy(row, product)) return { connected: false, requestedScope: asked };
  return { connected: true, athleteId: row.athleteId, connectedAt, requestedScope: asked };
}

/**
 * Exchanges the authorization code and links `product` to the user. A grant that lacks the scope the product needs
 * (the athlete unchecked it on Strava's page) is revoked unless a row already exists, in which case that row is left
 * untouched: the other product's connection is not ours to damage. A grant that would take a new slot when every slot
 * is taken is revoked at once, so it never occupies one.
 */
export async function exchangeCode(
  db: Database,
  env: StravaGrantEnv,
  input: { userId: string; product: StravaProduct; code: string; callbackScope?: string; capacity: number },
): Promise<{ athleteId: string; scope: string }> {
  if (!stravaConfigured(env)) throw new StravaGrantError("unavailable");
  const response = await tokenRequest(env, { grant_type: "authorization_code", code: input.code });
  if (response.status === 400 || response.status === 401) {
    await response.body?.cancel();
    throw new StravaGrantError("rejected");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new StravaGrantError("unavailable");
  }
  const parsed = tokenSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success || !parsed.data.athlete) throw new StravaGrantError("unavailable");
  const { athlete, ...token } = parsed.data;
  const granted = parseScope(token.scope ?? input.callbackScope);
  const existing = await readRow(db, input.userId);

  if (!PRODUCTS[input.product].usable(new Set(granted))) {
    if (!existing) await revoke(env, token.refresh_token);
    throw new StravaGrantError("scope_missing");
  }

  const athleteId = String(athlete.id);
  // A new slot is taken only by an athlete no row holds yet, for a user without a grant (a user switching to another
  // Strava account gives the old athlete's slot back below).
  if (!existing) {
    const [held] = await db
      .select({ userId: stravaAccount.userId })
      .from(stravaAccount)
      .where(eq(stravaAccount.athleteId, athleteId))
      .limit(1);
    if (!held && (await connectedAthletes(db)) >= input.capacity) {
      const revoked = await revoke(env, token.refresh_token);
      console.log(
        JSON.stringify({ event: "strava_slot_refused", userId: input.userId, athleteId, product: input.product, revoked }),
      );
      throw new StravaGrantError("slots_full");
    }
  }
  const now = new Date();
  // A different Strava account than the one the other product is linked to: that link no longer holds.
  const keepOther = existing?.athleteId === athleteId ? linkedAt(existing, input.product === "rogo" ? "fit" : "rogo") : null;
  if (existing && existing.athleteId !== athleteId) await revoke(env, existing.refreshToken);
  const fields = {
    athleteId,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: new Date(token.expires_at * 1000),
    scope: granted.join(" "),
    rogoLinkedAt: input.product === "rogo" ? now : keepOther,
    fitLinkedAt: input.product === "fit" ? now : keepOther,
  };
  await db.batch([
    db
      .insert(stravaAccount)
      .values({ userId: input.userId, ...fields })
      .onConflictDoUpdate({ target: stravaAccount.userId, set: fields }),
    // Connected again: the "slot released" notice is over.
    db.delete(stravaRelease).where(eq(stravaRelease.userId, input.userId)),
  ]);
  return { athleteId, scope: fields.scope };
}

/**
 * A usable access token for the product, refreshed first when it expires within REFRESH_MARGIN_MS. Strava
 * invalidates the old refresh token once it hands out a new one, so two requests refreshing at once could race:
 * only the one still holding the stored refresh token writes, the other re-reads and uses the winner's token. A
 * refresh token Strava refuses for good deletes the row (the athlete must connect again) and returns null, as does
 * a user the product is not linked for.
 */
export async function freshAccessToken(
  db: Database,
  env: StravaGrantEnv,
  userId: string,
  product: StravaProduct,
): Promise<{ accessToken: string; expiresAt: Date; athleteId: string } | null> {
  if (!stravaConfigured(env)) throw new StravaGrantError("unavailable");
  const row = await readRow(db, userId);
  if (!row || !usableBy(row, product)) return null;
  const handOut = (r: GrantRow) => ({ accessToken: r.accessToken, expiresAt: r.expiresAt, athleteId: r.athleteId });
  if (row.expiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS) return handOut(row);

  const response = await tokenRequest(env, { grant_type: "refresh_token", refresh_token: row.refreshToken });
  if (response.status === 400 || response.status === 401) {
    await response.body?.cancel();
    const latest = await readRow(db, userId);
    if (latest && latest.refreshToken !== row.refreshToken) return usableBy(latest, product) ? handOut(latest) : null;
    await db
      .delete(stravaAccount)
      .where(and(eq(stravaAccount.userId, userId), eq(stravaAccount.refreshToken, row.refreshToken)));
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new StravaGrantError("unavailable");
  }
  const parsed = tokenSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new StravaGrantError("unavailable");
  await db
    .update(stravaAccount)
    .set({
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token,
      expiresAt: new Date(parsed.data.expires_at * 1000),
    })
    .where(and(eq(stravaAccount.userId, userId), eq(stravaAccount.refreshToken, row.refreshToken)));
  const stored = await readRow(db, userId);
  return stored && usableBy(stored, product) ? handOut(stored) : null;
}

/**
 * Unlinks one product. While the other product is still linked the grant stays (revoking at Strava would cut it
 * off too); the last product to leave revokes the grant and deletes the row. The row goes whatever Strava answers:
 * the athlete can always remove the app on strava.com, and tokens the user asked us to drop are not kept.
 */
export async function disconnectProduct(
  db: Database,
  env: StravaGrantEnv,
  userId: string,
  product: StravaProduct,
): Promise<{ revoked: boolean }> {
  const row = await readRow(db, userId);
  if (!row) return { revoked: true };
  if (linkedAt(row, product === "rogo" ? "fit" : "rogo") !== null) {
    await db
      .update(stravaAccount)
      .set(product === "rogo" ? { rogoLinkedAt: null } : { fitLinkedAt: null })
      .where(eq(stravaAccount.userId, userId));
    return { revoked: false };
  }
  const revoked = await revoke(env, row.refreshToken);
  await db.delete(stravaAccount).where(eq(stravaAccount.userId, userId));
  return { revoked };
}

/** Account deletion: the user leaves both products, so the grant is revoked and the row deleted whatever the links. */
export async function revokeGrant(db: Database, env: StravaGrantEnv, userId: string): Promise<void> {
  const row = await readRow(db, userId);
  if (!row) return;
  await revoke(env, row.refreshToken);
  await db.delete(stravaAccount).where(eq(stravaAccount.userId, userId));
}

/** JoyoRogo's imported Strava activities: owner-only rows that must not outlive the grant (Strava API policy). */
export function deleteImportedActivities(db: Database, userId: string) {
  return db.delete(exerciseLog).where(and(eq(exerciseLog.userId, userId), eq(exerciseLog.source, "strava")));
}

/**
 * The athlete deauthorized the app on strava.com (the webhook event JoyoFit's Worker forwards): every token of
 * that athlete and everything imported from Strava goes. Returns the affected users.
 */
export async function dropAthlete(db: Database, athleteId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: stravaAccount.userId })
    .from(stravaAccount)
    .where(eq(stravaAccount.athleteId, athleteId));
  if (rows.length === 0) return [];
  const userIds = rows.map((r) => r.userId);
  // One Strava athlete can be linked from any number of accounts: delete in slices, all in one atomic batch.
  const [firstSlice = [], ...otherSlices] = chunk(userIds, D1_MAX_PARAMS - 1);
  const dropImported = (slice: string[]) =>
    db.delete(exerciseLog).where(and(inArray(exerciseLog.userId, slice), eq(exerciseLog.source, "strava")));
  await db.batch([
    dropImported(firstSlice),
    ...otherSlices.map(dropImported),
    db.delete(stravaAccount).where(eq(stravaAccount.athleteId, athleteId)),
  ]);
  return userIds;
}
