import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Hono } from "hono";

import type { RateLimitBinding } from "@joyorogo/api/lib/group-preview";
import { account, user } from "@joyorogo/db/schema/auth";
import { payment } from "@joyorogo/db/schema/billing";
import { d1TestDb } from "@joyorogo/db/test-d1";

import { INTERNAL_KEY_HEADER, JOYO_PRO_STATUS_PATH, registerJoyoProRoutes } from "./joyo-pro";
import type { JoyoProEnv } from "./joyo-pro";

const KEY = "k".repeat(64);
const PAYWALL = { FREE_DAILY_SCANS: "3" };
const DAY = 24 * 60 * 60 * 1000;

const { db } = await d1TestDb();

function appWith(env: JoyoProEnv) {
  const app = new Hono();
  registerJoyoProRoutes(app, { env, getDb: () => db });
  return app;
}

const ask = (app: Hono, body: unknown, key: string | null = KEY) =>
  app.request(JOYO_PRO_STATUS_PATH, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key === null ? {} : { [INTERNAL_KEY_HEADER]: key }) },
    body: JSON.stringify(body),
  });

const app = appWith({ ...PAYWALL, JOYO_INTERNAL_KEY: KEY });

let seq = 0;
async function makeUser(opts: {
  email?: string;
  verified?: boolean;
  googleSub?: string;
  tier?: "free" | "founder";
  founderUntil?: Date | null;
}) {
  const id = `u${++seq}`;
  await db.insert(user).values({
    id,
    name: id,
    email: opts.email ?? `${id}@example.com`,
    emailVerified: opts.verified ?? true,
    tier: opts.tier ?? "free",
    founderUntil: opts.founderUntil ?? null,
  });
  if (opts.googleSub) {
    await db.insert(account).values({
      id: `a${seq}`,
      accountId: opts.googleSub,
      providerId: "google",
      userId: id,
      updatedAt: new Date(),
    });
  }
  return id;
}

async function paid(userId: string, orderId: string, months: number, until: Date, paymentUrl: string | null = null) {
  await db.insert(payment).values({
    orderId,
    userId,
    amountIdr: months >= 12 ? 199_000 : 29_000,
    months,
    status: "paid",
    paidAt: new Date(),
    founderUntil: until,
    paymentUrl,
  });
}

describe("auth", () => {
  test("404 while JOYO_INTERNAL_KEY is unset: the route does not exist", async () => {
    expect((await ask(appWith(PAYWALL), { email: "a@example.com" })).status).toBe(404);
    expect((await ask(appWith({ ...PAYWALL, JOYO_INTERNAL_KEY: "  " }), { email: "a@example.com" })).status).toBe(404);
  });
  test("401 without or with a wrong key", async () => {
    expect((await ask(app, { email: "a@example.com" }, null)).status).toBe(401);
    expect((await ask(app, { email: "a@example.com" }, "")).status).toBe(401);
    expect((await ask(app, { email: "a@example.com" }, "x".repeat(64))).status).toBe(401);
    expect((await ask(app, { email: "a@example.com" }, KEY.slice(1))).status).toBe(401);
  });
  test("400 on a bad body", async () => {
    expect((await ask(app, { googleSub: "1" })).status).toBe(400);
    expect((await ask(app, { email: 5 })).status).toBe(400);
    expect((await ask(app, "nope")).status).toBe(400);
  });
  test("429 once the caller's budget is spent; checked only after the key", async () => {
    let calls = 0;
    const limiter: RateLimitBinding = {
      limit: async () => ({ success: ++calls <= 2 }),
    };
    const limited = appWith({ ...PAYWALL, JOYO_INTERNAL_KEY: KEY, JOYO_INTERNAL_LIMITER: limiter });
    expect((await ask(limited, { email: "a@example.com" }, "wrong")).status).toBe(401);
    expect(calls).toBe(0);
    expect((await ask(limited, { email: "a@example.com" })).status).toBe(200);
    expect((await ask(limited, { email: "a@example.com" })).status).toBe(200);
    const third = await ask(limited, { email: "a@example.com" });
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBe("60");
  });
});

describe("lookup", () => {
  test("by Google account id first, even when the email belongs to someone else", async () => {
    await makeUser({ googleSub: "sub-pro", tier: "founder" });
    await makeUser({ email: "other@example.com" });
    const res = await ask(app, { googleSub: "sub-pro", email: "other@example.com" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ pro: true, until: null, plan: "lifetime", source: "comp" });
  });
  test("falls back to the email (case-insensitive) when the Google id is unknown", async () => {
    await makeUser({ email: "mixed@example.com", tier: "founder" });
    expect(await (await ask(app, { googleSub: "sub-unknown", email: " Mixed@Example.COM " })).json()).toMatchObject({
      pro: true,
    });
    expect(await (await ask(app, { email: "mixed@example.com" })).json()).toMatchObject({ pro: true });
  });
  test("an unverified email never matches", async () => {
    await makeUser({ email: "unverified@example.com", verified: false, tier: "founder" });
    expect(await (await ask(app, { email: "unverified@example.com" })).json()).toEqual({
      pro: false,
      until: null,
      plan: null,
      source: null,
    });
  });
  test("a Google id of another provider does not match", async () => {
    const id = await makeUser({ tier: "founder" });
    await db.insert(account).values({ id: "a-apple", accountId: "sub-apple", providerId: "apple", userId: id, updatedAt: new Date() });
    expect(await (await ask(app, { googleSub: "sub-apple", email: "nobody@example.com" })).json()).toMatchObject({
      pro: false,
    });
  });
  test("no account: same answer as a free account", async () => {
    await makeUser({ email: "free@example.com" });
    const free = await (await ask(app, { email: "free@example.com" })).json();
    const missing = await (await ask(app, { email: "missing@example.com" })).json();
    expect(free).toEqual(missing);
  });
  test("never logs the email", async () => {
    const log = spyOn(console, "log");
    const error = spyOn(console, "error");
    const warn = spyOn(console, "warn");
    try {
      await ask(app, { googleSub: "sub-x", email: "secret-person@example.com" });
      await ask(app, { email: "secret-person@example.com" }, "wrong");
      await ask(app, { email: 1 });
      const printed = [...log.mock.calls, ...error.mock.calls, ...warn.mock.calls].flat().map(String).join("\n");
      expect(printed).not.toContain("secret-person");
    } finally {
      log.mockRestore();
      error.mockRestore();
      warn.mockRestore();
    }
  });
});

describe("status", () => {
  let now: number;
  beforeEach(() => {
    now = Date.now();
  });

  test("paid period through DOKU: monthly, until the period end", async () => {
    const until = new Date(now + 20 * DAY);
    const id = await makeUser({ googleSub: "sub-doku", founderUntil: until });
    await paid(id, "JRG-260101000000-aaaaaaaa", 1, until, "https://checkout.doku.com/x");
    expect(await (await ask(app, { googleSub: "sub-doku", email: "x@example.com" })).json()).toEqual({
      pro: true,
      until: until.toISOString(),
      plan: "monthly",
      source: "doku",
    });
  });
  test("each store and gateway is named by its ledger row", async () => {
    const cases: Array<[string, string | null, number, string, string]> = [
      ["apple:2000000000000001", null, 12, "apple", "yearly"],
      ["google:GPA.0000-0000", null, 1, "google_play", "monthly"],
      ["polar:9b1c", null, 12, "polar", "yearly"],
      ["JRG-260101000000-bbbbbbbb", "https://app.pakasir.com/pay-v2/abc", 1, "pakasir", "monthly"],
    ];
    for (const [orderId, url, months, source, plan] of cases) {
      const until = new Date(now + 30 * DAY);
      const id = await makeUser({ founderUntil: until });
      await paid(id, orderId, months, until, url);
      expect(await (await ask(app, { email: `${id}@example.com` })).json()).toEqual({
        pro: true,
        until: until.toISOString(),
        plan,
        source,
      });
    }
  });
  test("the newest period wins when several orders stacked", async () => {
    const first = new Date(now + 10 * DAY);
    const second = new Date(now + 375 * DAY);
    const id = await makeUser({ founderUntil: second });
    await paid(id, "google:GPA.1111", 1, first);
    await paid(id, "polar:2222", 12, second);
    expect(await (await ask(app, { email: `${id}@example.com` })).json()).toMatchObject({ plan: "yearly", source: "polar" });
  });
  test("a period set in the admin beyond any order is a comp", async () => {
    const until = new Date(now + 90 * DAY);
    const id = await makeUser({ founderUntil: until });
    await paid(id, "JRG-260101000000-cccccccc", 1, new Date(now + 5 * DAY));
    expect(await (await ask(app, { email: `${id}@example.com` })).json()).toEqual({
      pro: true,
      until: until.toISOString(),
      plan: null,
      source: "comp",
    });
    const bare = await makeUser({ founderUntil: until });
    expect(await (await ask(app, { email: `${bare}@example.com` })).json()).toMatchObject({ source: "comp" });
  });
  test("an ended period is not Pro", async () => {
    const ended = new Date(now - DAY);
    const id = await makeUser({ founderUntil: ended });
    await paid(id, "apple:2000000000000099", 1, ended);
    expect(await (await ask(app, { email: `${id}@example.com` })).json()).toEqual({
      pro: false,
      until: null,
      plan: null,
      source: null,
    });
  });
  test("refunded and proration rows never name the plan", async () => {
    const until = new Date(now + 30 * DAY);
    const id = await makeUser({ founderUntil: until });
    await paid(id, "polar:proration", 0, new Date(now + 400 * DAY));
    await paid(id, "polar:real", 1, until);
    await db.insert(payment).values({
      orderId: "polar:refunded",
      userId: id,
      amountIdr: 199_000,
      months: 12,
      status: "failed",
      founderUntil: new Date(now + 500 * DAY),
    });
    expect(await (await ask(app, { email: `${id}@example.com` })).json()).toMatchObject({ plan: "monthly", source: "polar" });
  });
  test("a server without a paywall treats everyone as Pro, like it does for itself", async () => {
    const open = appWith({ JOYO_INTERNAL_KEY: KEY });
    const id = await makeUser({});
    expect(await (await ask(open, { email: `${id}@example.com` })).json()).toEqual({
      pro: true,
      until: null,
      plan: null,
      source: "no_paywall",
    });
  });
});
