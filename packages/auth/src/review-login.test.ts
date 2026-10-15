import { describe, expect, test } from "bun:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";

import { parseReviewLoginEmails, reviewLoginOptions } from "./index";

const REVIEW_EMAIL = "review@joyorogo.com";
const PASSWORD = "correct-horse-battery-staple-91";

async function setup(allowed: string) {
  const auth = betterAuth({
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    secret: "test-secret-test-secret-test-secret-1234",
    baseURL: "http://localhost:3000",
    ...reviewLoginOptions(parseReviewLoginEmails(allowed)),
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

  test("password guesses are rate limited per client on /sign-in/email only", async () => {
    const { auth } = await setup(REVIEW_EMAIL);
    const post = (path: string) =>
      auth.handler(
        new Request(`http://localhost:3000/api/auth${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:3000" },
          body: JSON.stringify({ email: REVIEW_EMAIL, password: "wrong-password-123" }),
        }),
      );
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await post("/sign-in/email")).status);
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5)).toEqual([429, 429]);
    // Other endpoints are not throttled by this rule.
    const other: number[] = [];
    for (let i = 0; i < 8; i++) other.push((await auth.handler(new Request("http://localhost:3000/api/auth/get-session"))).status);
    expect(other.every((s) => s !== 429)).toBe(true);
  });
});
