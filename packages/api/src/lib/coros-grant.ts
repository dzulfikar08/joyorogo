import { and, eq, lt } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@joyorogo/db";
import { corosAccount, corosAuthState, exerciseLog } from "@joyorogo/db/schema/fitness";

/**
 * The COROS grant of one user (docs/coros.md). COROS publishes an MCP server whose OAuth is self-service: a public client
 * registered once (`scripts/coros-register-client.ts`), authorization code + PKCE (S256), no client secret.
 *
 * The browser leaves for COROS with a random `state`; the row stored under it holds the PKCE verifier, the redirect URI
 * and which app (web or native) the server's callback hands the code to. The row is deleted when the code is exchanged
 * (or when it expires), is bound to the user who started it, and the exchange needs both the state and that user's
 * session, so a tampered state, another user's state, or a replayed code are all refused.
 */

export type CorosEnv = { COROS_CLIENT_ID?: string; BETTER_AUTH_URL?: string };

export type CorosReturnTo = "web" | "native";

const AUTH_SERVER = "https://mcpus.coros.com";
const AUTHORIZE_URL = `${AUTH_SERVER}/oauth2/authorize`;
const TOKEN_URL = `${AUTH_SERVER}/oauth2/token`;
const REVOKE_URL = `${AUTH_SERVER}/oauth2/revoke`;
export const COROS_SCOPE = "openid mcp.tools offline_access";
const TIMEOUT_MS = 8_000;
/** The user has this long to finish COROS's login page. */
export const STATE_TTL_MS = 10 * 60_000;
/** An access token that expires within this long is refreshed before it is used. */
const REFRESH_MARGIN_MS = 60_000;

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: Fetcher = (input, init) => fetch(input, init);

/**
 * `rejected`: COROS refused the code or the refresh token (used, expired, revoked). `unavailable`: COROS or the network
 * failed. `bad_state`: the state is unknown, expired, used, or another user's.
 */
export type CorosGrantFailure = "rejected" | "unavailable" | "bad_state";

export class CorosGrantError extends Error {
  constructor(readonly failure: CorosGrantFailure) {
    super(`COROS grant: ${failure}`);
    this.name = "CorosGrantError";
  }
}

export function corosConfigured(env: CorosEnv): env is CorosEnv & { COROS_CLIENT_ID: string } {
  return Boolean(env.COROS_CLIENT_ID && env.BETTER_AUTH_URL);
}

/** The one https redirect COROS's client registration holds; the server bounces it on to web or the app (apps/server/src/coros.ts). */
export function corosRedirectUri(env: CorosEnv): string {
  return `${(env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")}/api/coros/callback`;
}

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const randomToken = (byteLength: number): string => base64url(crypto.getRandomValues(new Uint8Array(byteLength)));

/** RFC 7636 S256 challenge of a verifier. */
export async function pkceChallenge(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

/** Starts an authorization: stores the state row and returns COROS's authorize URL. Expired rows of the user are swept here. */
export async function startAuthorization(
  db: Database,
  env: CorosEnv,
  input: { userId: string; returnTo: CorosReturnTo; now?: Date },
): Promise<{ url: string }> {
  if (!corosConfigured(env)) throw new CorosGrantError("unavailable");
  const now = input.now ?? new Date();
  const state = randomToken(32);
  const verifier = randomToken(48);
  const redirectUri = corosRedirectUri(env);
  await db.delete(corosAuthState).where(lt(corosAuthState.expiresAt, now));
  await db.insert(corosAuthState).values({
    state,
    userId: input.userId,
    codeVerifier: verifier,
    redirectUri,
    returnTo: input.returnTo,
    expiresAt: new Date(now.getTime() + STATE_TTL_MS),
  });
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.COROS_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", COROS_SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", await pkceChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return { url: url.toString() };
}

/** Which app a state belongs to, for the server's callback bounce; null when the state is unknown or expired. Does not consume it. */
export async function peekReturnTo(db: Database, state: string, now: Date = new Date()): Promise<CorosReturnTo | null> {
  const [row] = await db
    .select({ returnTo: corosAuthState.returnTo, expiresAt: corosAuthState.expiresAt })
    .from(corosAuthState)
    .where(eq(corosAuthState.state, state));
  if (!row || row.expiresAt.getTime() <= now.getTime()) return null;
  return row.returnTo === "native" ? "native" : "web";
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().optional(),
  scope: z.string().optional(),
});

async function tokenRequest(fetcher: Fetcher, params: Record<string, string>): Promise<Response> {
  try {
    return await fetcher(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new CorosGrantError("unavailable");
  }
}

/** Reads a token answer. A 400/401 is COROS refusing the grant; anything else not ok is COROS failing. */
async function readToken(response: Response): Promise<z.infer<typeof tokenSchema>> {
  if (response.status === 400 || response.status === 401) {
    await response.body?.cancel();
    throw new CorosGrantError("rejected");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new CorosGrantError("unavailable");
  }
  const parsed = tokenSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new CorosGrantError("unavailable");
  return parsed.data;
}

/** Tokens without an `expires_in` are treated as short-lived (an hour), so they are refreshed rather than trusted. */
const expiryOf = (token: { expires_in?: number | undefined }, now: Date): Date =>
  new Date(now.getTime() + (token.expires_in ?? 3600) * 1000);

/**
 * Finishes the authorization the user started: consumes the state (once), exchanges the code with the stored verifier, and
 * stores the tokens. Throws `bad_state` for a state that is unknown, expired, already used or not this user's.
 */
export async function completeAuthorization(
  db: Database,
  env: CorosEnv,
  input: { userId: string; code: string; state: string; now?: Date },
  fetcher: Fetcher = defaultFetch,
): Promise<{ connectedAt: Date }> {
  if (!corosConfigured(env)) throw new CorosGrantError("unavailable");
  const now = input.now ?? new Date();
  // Deleting is the claim: of two concurrent exchanges of one state only one gets the row back.
  const [row] = await db
    .delete(corosAuthState)
    .where(and(eq(corosAuthState.state, input.state), eq(corosAuthState.userId, input.userId)))
    .returning();
  if (!row || row.expiresAt.getTime() <= now.getTime()) throw new CorosGrantError("bad_state");

  const token = await readToken(
    await tokenRequest(fetcher, {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: row.redirectUri,
      client_id: env.COROS_CLIENT_ID,
      code_verifier: row.codeVerifier,
    }),
  );
  if (!token.refresh_token) throw new CorosGrantError("unavailable");
  const fields = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: expiryOf(token, now),
    scope: token.scope ?? COROS_SCOPE,
    connectedAt: now,
    lastSyncAt: null,
    lastError: null,
  };
  await db
    .insert(corosAccount)
    .values({ userId: input.userId, ...fields })
    .onConflictDoUpdate({ target: corosAccount.userId, set: fields });
  return { connectedAt: now };
}

export type CorosStatus = {
  connected: boolean;
  connectedAt?: Date;
  lastSyncAt?: Date;
  lastError?: string;
};

export async function grantStatus(db: Database, userId: string): Promise<CorosStatus> {
  const [row] = await db.select().from(corosAccount).where(eq(corosAccount.userId, userId));
  if (!row) return { connected: false };
  return {
    connected: true,
    connectedAt: row.connectedAt,
    ...(row.lastSyncAt ? { lastSyncAt: row.lastSyncAt } : {}),
    ...(row.lastError ? { lastError: row.lastError } : {}),
  };
}

/**
 * A usable access token, refreshed first when it expires within a minute (or when `force`, after COROS answered 401).
 * `null` when the user has no grant. A refresh token COROS refuses (`invalid_grant`) ends the grant: the row is deleted,
 * the user is told to connect again, and what was already imported stays. Two syncs refreshing at once cannot clobber
 * each other: a refresh that fails while the row already holds a newer refresh token uses that one instead.
 */
export async function freshAccessToken(
  db: Database,
  env: CorosEnv,
  userId: string,
  options: { force?: boolean; now?: Date } = {},
  fetcher: Fetcher = defaultFetch,
): Promise<{ accessToken: string } | null> {
  const now = options.now ?? new Date();
  const [row] = await db.select().from(corosAccount).where(eq(corosAccount.userId, userId));
  if (!row) return null;
  if (!options.force && row.expiresAt.getTime() - now.getTime() > REFRESH_MARGIN_MS) return { accessToken: row.accessToken };
  if (!corosConfigured(env)) throw new CorosGrantError("unavailable");

  const response = await tokenRequest(fetcher, {
    grant_type: "refresh_token",
    refresh_token: row.refreshToken,
    client_id: env.COROS_CLIENT_ID,
  });
  if (response.status === 400 || response.status === 401) {
    await response.body?.cancel();
    const [current] = await db.select().from(corosAccount).where(eq(corosAccount.userId, userId));
    if (current && current.refreshToken !== row.refreshToken) return { accessToken: current.accessToken };
    await db.delete(corosAccount).where(eq(corosAccount.userId, userId));
    throw new CorosGrantError("rejected");
  }
  const token = await readToken(response);
  await db
    .update(corosAccount)
    .set({
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? row.refreshToken,
      expiresAt: expiryOf(token, now),
      ...(token.scope ? { scope: token.scope } : {}),
    })
    .where(eq(corosAccount.userId, userId));
  return { accessToken: token.access_token };
}

/** Records how the last sync went: the time on success (clearing any error), the error text on failure. */
export async function recordSync(db: Database, userId: string, outcome: { at: Date } | { error: string }): Promise<void> {
  await db
    .update(corosAccount)
    .set("at" in outcome ? { lastSyncAt: outcome.at, lastError: null } : { lastError: outcome.error.slice(0, 300) })
    .where(eq(corosAccount.userId, userId));
}

/** Revokes a token at COROS. Best effort: the answer is only `true` when COROS confirmed; the caller deletes its copy either way. */
async function revoke(env: CorosEnv, token: string, fetcher: Fetcher): Promise<boolean> {
  if (!env.COROS_CLIENT_ID) return false;
  try {
    const response = await fetcher(REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token, token_type_hint: "refresh_token", client_id: env.COROS_CLIENT_ID }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Drops the connection: revokes at COROS (best effort; COROS's revocation endpoint may refuse a public client, then the
 * user can remove the app in the COROS app), and deletes the tokens and any pending authorization whatever COROS answers.
 */
export async function disconnectCoros(
  db: Database,
  env: CorosEnv,
  userId: string,
  fetcher: Fetcher = defaultFetch,
): Promise<{ revoked: boolean }> {
  const [row] = await db.select({ refreshToken: corosAccount.refreshToken }).from(corosAccount).where(eq(corosAccount.userId, userId));
  const revoked = row ? await revoke(env, row.refreshToken, fetcher) : false;
  await db.delete(corosAccount).where(eq(corosAccount.userId, userId));
  await db.delete(corosAuthState).where(eq(corosAuthState.userId, userId));
  return { revoked };
}

/** Everything imported from COROS: plain diary rows that must not outlive the connection the user ended. */
export function deleteImportedWorkouts(db: Database, userId: string) {
  return db.delete(exerciseLog).where(and(eq(exerciseLog.userId, userId), eq(exerciseLog.source, "coros")));
}
