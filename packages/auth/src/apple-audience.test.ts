import { describe, expect, test } from "bun:test";

import { JOYOFIT_APPLE_BUNDLE_ID, appleAudiences } from "./apple-audience";
import { createAuth } from "./index";

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
      {} as never,
    );
    const ctx = await auth.$context;
    const apple = ctx.socialProviders.find((p) => p.id === "apple") as
      | { idToken?: { audience: string | string[] } }
      | undefined;
    expect(apple?.idToken?.audience).toEqual(["com.joyodigitama.joyorogo", "com.joyodigitama.joyofit"]);
  });
});
