import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import { drizzle } from "../../db/node_modules/drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see packages/api privacy.test.ts).
import { createClient } from "../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

import { JOYOFIT_APPLE_BUNDLE_ID, appleAudiences } from "./apple-audience";
import { createAuth } from "./index";

// The OAuth provider writes its protected resource at start-up, so createAuth needs a migrated database.
const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}

describe("appleAudiences", () => {
  test("JoyoRogo first, JoyoFit second", () => {
    expect(appleAudiences("com.joyodigitama.joyorogo")).toEqual([
      "com.joyodigitama.joyorogo",
      "com.joyodigitama.joyofit",
    ]);
    expect(JOYOFIT_APPLE_BUNDLE_ID).toBe("com.joyodigitama.joyofit");
  });
});

describe("createAuth apple provider", () => {
  test("audience covers both bundle ids", async () => {
    const auth = createAuth(
      {
        BETTER_AUTH_URL: "http://localhost:3000",
        BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
        CORS_ORIGIN: "http://localhost:3000",
        GOOGLE_CLIENT_ID: "g",
        GOOGLE_CLIENT_SECRET: "g",
      },
      drizzle(client) as unknown as Database,
    );
    const ctx = await auth.$context;
    const apple = ctx.socialProviders.find((p) => p.id === "apple") as
      | { idToken?: { audience: string | string[] } }
      | undefined;
    expect(apple?.idToken?.audience).toEqual(["com.joyodigitama.joyorogo", "com.joyodigitama.joyofit"]);
  });
});
