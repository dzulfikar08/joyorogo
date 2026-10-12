import { type JoyoAuth, createAuth as createConfiguredAuth } from "@joyorogo/auth";
import { type Database, createDb } from "@joyorogo/db";

import { env } from "./env.server";

// Bindings are fixed for the isolate's lifetime, so one drizzle client and
// one Better Auth instance serve every request (betterAuth() setup is not free).
let db: Database | undefined;
let auth: JoyoAuth | undefined;

export function getDb(): Database {
  db ??= createDb(env);
  return db;
}

export async function createAuth(): Promise<JoyoAuth> {
  auth ??= createConfiguredAuth(env, getDb());
  return auth;
}
