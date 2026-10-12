import { type JoyoAuth, createAuth as createConfiguredAuth } from "@joyorogo/auth";
import { type Database, createDb } from "@joyorogo/db";

import { env } from "./env.server";

// Bindings are fixed for the isolate's lifetime, so one drizzle client and
// one Better Auth instance per base URL serve every request (betterAuth()
// setup is not free).
let db: Database | undefined;
const auths = new Map<string, JoyoAuth>();

export function getDb(): Database {
  db ??= createDb(env);
  return db;
}

const ALT_URLS = (env.BETTER_AUTH_ALT_URLS ?? "")
  .split(",")
  .map((url) => url.trim().replace(/\/$/, ""))
  .filter(Boolean);

/**
 * Auth for a request. Requests on an old API host (BETTER_AUTH_ALT_URLS) get
 * that host as base URL, so an OAuth flow an installed app starts there
 * calls back to the same host. Everything else uses BETTER_AUTH_URL.
 */
export async function createAuth(requestUrl?: string): Promise<JoyoAuth> {
  const origin = requestUrl ? new URL(requestUrl).origin : "";
  const baseURL = ALT_URLS.includes(origin) ? origin : env.BETTER_AUTH_URL;
  let auth = auths.get(baseURL);
  if (!auth) {
    auth = createConfiguredAuth({ ...env, BETTER_AUTH_URL: baseURL }, getDb());
    auths.set(baseURL, auth);
  }
  return auth;
}
