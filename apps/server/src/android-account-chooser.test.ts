import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see packages/api privacy.test.ts).
import { createClient } from "../../../packages/db/node_modules/@libsql/client";
import { createAuth } from "@joyorogo/auth";
import type { Database } from "@joyorogo/db";

const BASE = "https://api.joyorogo.com";
const ANDROID_APP = { "expo-origin": "joyofit://", "user-agent": "okhttp/4.12.0" };
const IOS_APP = { "expo-origin": "joyofit://", "user-agent": "JoyoFit/202610160433 CFNetwork/3860.700.31 Darwin/25.0.0" };
const BROWSER = {
  origin: "https://app.joyorogo.com",
  "user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36",
};

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../packages/db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}

// The production wiring: the plugin has to be in createAuth's list, not merely exist.
const auth = createAuth(
  {
    BETTER_AUTH_URL: BASE,
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
    CORS_ORIGIN: "https://joyorogo.com,https://app.joyorogo.com",
    APP_URL: "https://app.joyorogo.com",
    GOOGLE_CLIENT_ID: "id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "secret",
  },
  drizzle(client) as unknown as Database,
);

/** The Google authorization URL a sign-in request is answered with. */
async function googleUrl(headers: Record<string, string>, body: Record<string, unknown> = {}): Promise<URL> {
  const res = await auth.handler(
    new Request(`${BASE}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ provider: "google", callbackURL: "joyofit:///", ...body }),
    }),
  );
  expect(res.status).toBe(200);
  const data: unknown = await res.json();
  if (typeof data !== "object" || data === null || !("url" in data) || typeof data.url !== "string") {
    throw new Error(`no authorization URL in ${JSON.stringify(data)}`);
  }
  return new URL(data.url);
}

describe("Android app Google sign-in", () => {
  test("always shows the account chooser, so the user taps before the redirect back to the app", async () => {
    const url = await googleUrl(ANDROID_APP);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("prompt")).toBe("select_account");
  });

  test("keeps everything else in the authorization request", async () => {
    const url = await googleUrl(ANDROID_APP);
    expect(url.searchParams.get("redirect_uri")).toBe(`${BASE}/api/auth/callback/google`);
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("scope")).toContain("email");
  });

  test("the JoyoRogo app (joyorogo://) gets the chooser too", async () => {
    const url = await googleUrl({ ...ANDROID_APP, "expo-origin": "joyorogo://" }, { callbackURL: "joyorogo:///" });
    expect(url.searchParams.get("prompt")).toBe("select_account");
  });

  test("iOS apps are left alone (ASWebAuthenticationSession has no gesture rule)", async () => {
    expect((await googleUrl(IOS_APP)).searchParams.has("prompt")).toBe(false);
  });

  test("web sign-in is left alone, even in Chrome on Android", async () => {
    const url = await googleUrl(BROWSER, { callbackURL: "https://app.joyorogo.com/beranda" });
    expect(url.searchParams.has("prompt")).toBe(false);
  });
});
