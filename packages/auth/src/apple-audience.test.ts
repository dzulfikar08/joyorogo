import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import { JOYOFIT_APPLE_BUNDLE_ID, JOYOROGO_APPLE_BUNDLE_ID, appleBundleIds } from "./apple-audience";
import { createAuth } from "./index";

// The OAuth provider writes its protected resource at start-up, so createAuth needs a migrated database.
const { db } = await d1TestDb();

describe("appleBundleIds", () => {
  test("unset or blank = JoyoRogo first, JoyoFit second", () => {
    const both = ["com.joyodigitama.joyorogo", "com.joyodigitama.joyofit"];
    expect(appleBundleIds()).toEqual(both);
    expect(appleBundleIds("  , ")).toEqual(both);
    expect(JOYOROGO_APPLE_BUNDLE_ID).toBe(both[0]!);
    expect(JOYOFIT_APPLE_BUNDLE_ID).toBe(both[1]!);
  });
  test("comma-separated list is trimmed and deduplicated, order kept", () => {
    expect(appleBundleIds(" com.joyodigitama.joyofit, com.joyodigitama.joyorogo,com.joyodigitama.joyofit")).toEqual([
      "com.joyodigitama.joyofit",
      "com.joyodigitama.joyorogo",
    ]);
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
      db,
    );
    const ctx = await auth.$context;
    const apple = ctx.socialProviders.find((p) => p.id === "apple") as
      | { idToken?: { audience: string | string[] } }
      | undefined;
    expect(apple?.idToken?.audience).toEqual(["com.joyodigitama.joyorogo", "com.joyodigitama.joyofit"]);
  });
});
