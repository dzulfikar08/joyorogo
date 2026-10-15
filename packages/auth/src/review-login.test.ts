import { describe, expect, test } from "bun:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";

import { type RateLimiter, parseReviewLoginEmails, reviewLoginOptions } from "./index";

const REVIEW_EMAIL = "review@joyorogo.com";
const PASSWORD = "correct-horse-battery-staple-91";

async function setup(allowed: string, limiter?: RateLimiter) {
  const auth = betterAuth({
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    secret: "test-secret-test-secret-test-secret-1234",
    baseURL: "http://localhost:3000",
    ...reviewLoginOptions(parseReviewLoginEmails(allowed), limiter),
  });
  const ctx = await auth.$context;
  // Same shape the review script writes: a user plus a credential account.
  for (const email of [REVIEW_EMAIL, "other@example.com"]) {
    const user = await ctx.internalAdapter.createUser({ email, name: "Tester", emailVerified: true }, { method: "test" });
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: await ctx.password.hash(PASSWORD),
    });
  }
  const signIn = (email: string, password: string) => auth.api.signInEmail({ body: { email, password } });
  return { auth, signIn };
}

async function errorOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    const err = e as { status?: string; statusCode?: number; body?: unknown };
    return { status: err.statusCode, body: err.body };
  }
  return null;
}

describe("parseReviewLoginEmails", () => {
  test("splits, trims, lower-cases and drops blanks", () => {
    expect(parseReviewLoginEmails(" A@x.com, ,b@y.com ,")).toEqual(["a@x.com", "b@y.com"]);
  });
  test("empty or missing = no accounts", () => {
    expect(parseReviewLoginEmails("")).toEqual([]);
    expect(parseReviewLoginEmails(undefined)).toEqual([]);
  });
});

describe("review login", () => {
  test("allowlisted account signs in, case-insensitively", async () => {
    const { signIn } = await setup(REVIEW_EMAIL);
    const res = await signIn("Review@JoyoRogo.com", PASSWORD);
    expect(res.user.email).toBe(REVIEW_EMAIL);
    expect(res.token).toBeTruthy();
  });

  test("wrong password for the allowlisted account is rejected", async () => {
    const { signIn } = await setup(REVIEW_EMAIL);
    expect((await errorOf(signIn(REVIEW_EMAIL, "wrong-password-123")))?.status).toBe(401);
  });

  test("a non-allowlisted email gets the same error, even with its real password", async () => {
    const { signIn } = await setup(REVIEW_EMAIL);
    const wrongPassword = await errorOf(signIn(REVIEW_EMAIL, "wrong-password-123"));
    const notAllowed = await errorOf(signIn("other@example.com", PASSWORD));
    const unknown = await errorOf(signIn("nobody@example.com", PASSWORD));
    expect(notAllowed).toEqual(wrongPassword!);
    expect(unknown).toEqual(wrongPassword!);
  });

  test("sign-up with email and password is disabled", async () => {
    const { auth } = await setup(REVIEW_EMAIL);
    const err = await errorOf(
      auth.api.signUpEmail({ body: { email: "new@example.com", password: PASSWORD, name: "New" } }),
    );
    expect(err?.status).toBe(400);
  });

  test("empty allowlist turns email sign-in fully off", async () => {
    const { auth, signIn } = await setup("");
    expect((await errorOf(signIn(REVIEW_EMAIL, PASSWORD)))?.status).toBeGreaterThanOrEqual(400);
    expect(await errorOf(auth.api.signUpEmail({ body: { email: "n@example.com", password: PASSWORD, name: "N" } }))).not.toBeNull();
  });

  test("password guesses are throttled per client IP, before any password check", async () => {
    const seen: string[] = [];
    let budget = 2;
    const limiter: RateLimiter = {
      async limit({ key }) {
        seen.push(key);
        return { success: budget-- > 0 };
      },
    };
    const { auth } = await setup(REVIEW_EMAIL, limiter);
    const post = (password: string) =>
      auth.handler(
        new Request("http://localhost:3000/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            "cf-connecting-ip": "203.0.113.7",
          },
          body: JSON.stringify({ email: REVIEW_EMAIL, password }),
        }),
      );
    expect((await post("wrong-password-123")).status).toBe(401);
    expect((await post(PASSWORD)).status).toBe(200);
    // Budget spent: even the right password is refused.
    expect((await post(PASSWORD)).status).toBe(429);
    expect(seen).toEqual(Array(3).fill("review-login:203.0.113.7"));
  });
});
