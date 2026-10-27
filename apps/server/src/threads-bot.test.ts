import { d1TestDb } from "@joyorogo/db/test-d1";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";

import type { JoyoAuth } from "@joyorogo/auth";
import { botConfig } from "@joyorogo/api/lib/threads-bot/config";
import type { BotEnv } from "@joyorogo/api/lib/threads-bot/config";
import { createConnectState } from "@joyorogo/api/lib/threads-bot/connect";
import {
  FakeGraph,
  IMAGE_URL,
  OWN,
  analysis,
  threadsTime,
} from "@joyorogo/api/lib/threads-bot/fixtures";
import { signBody } from "@joyorogo/api/lib/threads-bot/webhook";
import { threadsAccount, threadsMention } from "@joyorogo/db/schema/threads";

import { registerThreadsBotRoutes, runThreadsBotTick } from "./threads-bot";

const APP_SECRET = "meta-app-secret";
const VERIFY = "verify-me";
const STATE_SECRET = "better-auth-secret-0123456789abcdef";
const NOW = Date.parse("2026-10-27T05:00:00Z");

const { client, db } = await d1TestDb();
const graph = new FakeGraph();
graph.install();
afterAll(() => graph.uninstall());

let env: BotEnv = {};
let scans = 0;
const auth = {
  api: { getSession: async () => ({ user: { email: "admin@joyorogo.com" } }) },
} as unknown as JoyoAuth;

const app = new Hono();
registerThreadsBotRoutes(app, {
  getDb: () => db,
  config: () => botConfig(env),
  scan: async () => {
    scans += 1;
    return analysis([{ name: "Nasi goreng", kcal: 500, confidence: 0.8 }]);
  },
  createAuth: async () => auth,
  stateSecret: STATE_SECRET,
  adminUrl: "https://admin.test",
  now: () => NOW,
  publishRetryMs: 1,
});

const baseEnv = (over: BotEnv = {}): BotEnv => ({
  THREADS_BOT_MODE: "review",
  THREADS_APP_ID: "app-1",
  THREADS_APP_SECRET: APP_SECRET,
  THREADS_WEBHOOK_VERIFY_TOKEN: VERIFY,
  THREADS_ACCESS_TOKEN: "seed-token",
  BETTER_AUTH_URL: "https://api.test",
  ...over,
});

let n = 0;
function mentionValue(over: Record<string, unknown> = {}) {
  n += 1;
  return {
    id: `w${n}`,
    username: `user${n}`,
    media_type: "IMAGE",
    media_url: IMAGE_URL,
    timestamp: threadsTime(NOW),
    is_reply: false,
    ...over,
  };
}
const delivery = (value: object, targetId = OWN.id) =>
  JSON.stringify({
    app_id: "app-1",
    topic: "interaction",
    target_id: targetId,
    time: 1,
    subscription_id: "s",
    has_uid_field: false,
    values: { field: "mentions", value },
  });

async function webhook(body: string, signature?: string | null) {
  return app.request("/api/threads/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature === null
        ? {}
        : { "x-hub-signature-256": signature ?? (await signBody(APP_SECRET, body)) }),
    },
    body,
  });
}
const admin = (path: string, init?: RequestInit & { json?: unknown }) =>
  app.request(`/api/admin/threads-bot${path}`, {
    ...init,
    headers: { "content-type": "application/json" },
    body: init?.json === undefined ? init?.body : JSON.stringify(init.json),
  });

beforeEach(async () => {
  graph.reset();
  env = baseEnv();
  scans = 0;
  await client.execute(`DELETE FROM threads_mention`);
  await client.execute(`DELETE FROM threads_account`);
  await client.execute(`DELETE FROM ai_usage`);
});

describe("webhook verification (GET)", () => {
  test("echoes the challenge for our verify token only", async () => {
    const ok = await app.request(
      `/api/threads/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=1158201444`,
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("1158201444");
    expect(
      (
        await app.request(
          `/api/threads/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`,
        )
      ).status,
    ).toBe(403);
    expect((await app.request(`/api/threads/webhook`)).status).toBe(403);
  });

  test("503 while the verify token is not configured", async () => {
    env = baseEnv({ THREADS_WEBHOOK_VERIFY_TOKEN: "" });
    expect(
      (
        await app.request(
          `/api/threads/webhook?hub.mode=subscribe&hub.verify_token=&hub.challenge=1`,
        )
      ).status,
    ).toBe(503);
  });
});

describe("webhook delivery (POST)", () => {
  test("a bad, missing or foreign signature is 401 and nothing is read or scanned", async () => {
    const body = delivery(mentionValue());
    expect((await webhook(body, "sha256=" + "0".repeat(64))).status).toBe(401);
    expect((await webhook(body, null)).status).toBe(401);
    expect((await webhook(body, await signBody("not-our-secret", body))).status).toBe(401);
    expect((await webhook(body, await signBody(APP_SECRET, body + " "))).status).toBe(401);
    expect(scans).toBe(0);
    expect(await db.select().from(threadsMention)).toHaveLength(0);
    expect(graph.calls).toHaveLength(0);
  });

  test("the optional THREADS_WEBHOOK_SECRET (Meta app secret) is accepted as a second key", async () => {
    env = baseEnv({ THREADS_WEBHOOK_SECRET: "meta-app-secret-2" });
    const body = delivery(mentionValue());
    expect((await webhook(body, await signBody("meta-app-secret-2", body))).status).toBe(200);
    expect((await webhook(body, await signBody("meta-app-secret-3", body))).status).toBe(401);
  });

  test("503 when the app secret is not configured", async () => {
    env = baseEnv({ THREADS_APP_SECRET: "" });
    expect((await webhook(delivery(mentionValue()), "sha256=" + "0".repeat(64))).status).toBe(503);
  });

  test("a signed mention of a photo is scanned and queued; the same delivery again is not scanned twice", async () => {
    const value = mentionValue();
    const body = delivery(value);
    const first = await webhook(body);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, mentions: 1 });
    const [row] = await db.select().from(threadsMention);
    expect(row).toMatchObject({
      mediaId: value.id,
      status: "pending_review",
      authorUsername: value.username,
    });

    expect((await webhook(body)).status).toBe(200);
    expect(scans).toBe(1);
    expect(await db.select().from(threadsMention)).toHaveLength(1);
  });

  test("kill switch off: acknowledged (so Meta stops retrying) but nothing is processed", async () => {
    env = baseEnv({ THREADS_BOT_MODE: "off" });
    const response = await webhook(delivery(mentionValue()));
    expect(response.status).toBe(200);
    expect(scans).toBe(0);
    expect(await db.select().from(threadsMention)).toHaveLength(0);
    expect(graph.calls).toHaveLength(0);
  });

  test("a mention that tags another account of the app is ignored", async () => {
    await client.execute({
      sql: `INSERT INTO threads_account (id, threads_user_id, username, access_token, expires_at, source) VALUES (1, '100', 'joyorogo', 'tok', ?, 'oauth')`,
      args: [NOW + 30 * 86_400_000],
    });
    const response = await webhook(delivery(mentionValue(), "999"));
    expect(await response.json()).toEqual({ ok: true, mentions: 0 });
    expect(scans).toBe(0);
  });

  test("events other than mentions and invalid JSON do no harm", async () => {
    const replies = JSON.stringify({ values: { field: "replies", value: mentionValue() } });
    expect(await (await webhook(replies)).json()).toEqual({ ok: true, mentions: 0 });
    expect((await webhook("not json")).status).toBe(400);
    expect(scans).toBe(0);
  });

  test("auto mode posts the reply from the webhook", async () => {
    env = baseEnv({ THREADS_BOT_MODE: "auto" });
    const value = mentionValue();
    await webhook(delivery(value));
    expect(graph.published).toHaveLength(1);
    expect(graph.published[0]!.replyTo).toBe(value.id);
    expect((await db.select().from(threadsMention))[0]).toMatchObject({
      status: "sent",
      mode: "auto",
    });
  });
});

describe("admin review queue", () => {
  async function queue() {
    graph.add({
      ...mentionValue({ id: "q1", username: "queued" }),
      permalink: "https://www.threads.com/@queued/post/q1",
    });
    await webhook(delivery({ id: "q1", username: "queued", timestamp: threadsTime(NOW) }));
  }

  test("status reports mode, caps, account and today's counts and never the token", async () => {
    await queue();
    const body = (await (await admin("")).json()) as Record<string, any>;
    expect(body).toMatchObject({
      mode: "review",
      caps: { user: 3, global: 200 },
      band: 0.2,
      configured: { app: true, webhook: true, seed: true },
      redirectUri: "https://api.test/api/threads/callback",
      webhookUrl: "https://api.test/api/threads/webhook",
      account: { username: "joyorogo", source: "seed", status: "ok" },
      today: { scans: 1, sent: 0, pending: 1 },
    });
    expect(JSON.stringify(body)).not.toContain("tok-refreshed");
    expect(JSON.stringify(body)).not.toContain("seed-token");
  });

  test("pending list carries the draft and the photo read live from Threads (not stored)", async () => {
    await queue();
    const { items } = (await (await admin("/mentions")).json()) as { items: Record<string, any>[] };
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      mediaId: "q1",
      author: "queued",
      status: "pending_review",
      kind: "estimate",
      photoUrl: IMAGE_URL,
      permalink: "https://www.threads.com/@queued/post/q1",
      kcalLow: 400,
      kcalHigh: 600,
    });
    expect(items[0]!.replyText).toContain("400–600 kcal");
    expect(items[0]!.dishes).toEqual([{ name: "Nasi goreng", kcal: 500, low: 400, high: 600 }]);
    const [row] = await db.select().from(threadsMention);
    expect(JSON.stringify(row)).not.toContain(IMAGE_URL);
  });

  test("approve posts the reply, then the sent list logs it", async () => {
    await queue();
    const approve = await admin("/mentions/q1/approve", { method: "POST", json: {} });
    expect(approve.status).toBe(200);
    expect(await approve.json()).toEqual({ ok: true, replyId: "reply-1" });
    expect(graph.published[0]).toMatchObject({ replyTo: "q1" });

    const sent = (await (await admin("/mentions?view=sent")).json()) as {
      items: Record<string, any>[];
    };
    expect(sent.items).toHaveLength(1);
    expect(sent.items[0]).toMatchObject({
      mediaId: "q1",
      status: "sent",
      replyMediaId: "reply-1",
      reviewedBy: "admin@joyorogo.com",
    });
    expect((await (await admin("/mentions")).json()) as { items: unknown[] }).toEqual({
      items: [],
    });

    expect((await admin("/mentions/q1/approve", { method: "POST", json: {} })).status).toBe(409);
    expect(graph.published).toHaveLength(1);
  });

  test("edit then approve sends the edited text; an over-long text is 400", async () => {
    await queue();
    expect(
      (await admin("/mentions/q1", { method: "PATCH", json: { text: "a".repeat(501) } })).status,
    ).toBe(400);
    expect((await admin("/mentions/q1", { method: "PATCH", json: { text: "" } })).status).toBe(400);
    expect(
      (
        await admin("/mentions/q1", {
          method: "PATCH",
          json: { text: "Sekitar 500 kcal (perkiraan AI)." },
        })
      ).status,
    ).toBe(200);
    expect(
      (await admin("/mentions/q1/approve", { method: "POST", json: { text: "b".repeat(501) } }))
        .status,
    ).toBe(400);
    expect((await admin("/mentions/q1/approve", { method: "POST", json: {} })).status).toBe(200);
    expect(graph.published[0]!.text).toBe("Sekitar 500 kcal (perkiraan AI).");
  });

  test("reject drops the draft; it can no longer be approved", async () => {
    await queue();
    expect((await admin("/mentions/q1/reject", { method: "POST" })).status).toBe(200);
    expect((await admin("/mentions/q1/reject", { method: "POST" })).status).toBe(409);
    expect((await admin("/mentions/q1/approve", { method: "POST", json: {} })).status).toBe(409);
    expect(graph.published).toHaveLength(0);
    const other = (await (await admin("/mentions?view=other")).json()) as {
      items: Record<string, any>[];
    };
    expect(other.items[0]).toMatchObject({ status: "rejected", reviewedBy: "admin@joyorogo.com" });
  });

  test("approve is refused with the kill switch off, and 502 with Meta's reason when the post fails", async () => {
    await queue();
    env = baseEnv({ THREADS_BOT_MODE: "off" });
    const off = await admin("/mentions/q1/approve", { method: "POST", json: {} });
    expect(off.status).toBe(409);
    expect(await off.json()).toEqual({ error: "THREADS_BOT_MODE is off" });
    env = baseEnv();
    graph.failPublish = true;
    const failed = await admin("/mentions/q1/approve", { method: "POST", json: {} });
    expect(failed.status).toBe(502);
    expect(((await failed.json()) as { error: string }).error).toContain("publish failed");
    expect((await db.select().from(threadsMention))[0]!.status).toBe("pending_review");
  });

  test("an unknown view is 400", async () => {
    expect((await admin("/mentions?view=everything")).status).toBe(400);
  });
});

describe("Connect Threads (OAuth)", () => {
  test("the connect URL asks for the permissions the bot needs and carries a signed state", async () => {
    const { url } = (await (await admin("/connect")).json()) as { url: string };
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://threads.net/oauth/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("app-1");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://api.test/api/threads/callback");
    expect(parsed.searchParams.get("scope")?.split(",")).toEqual([
      "threads_basic",
      "threads_manage_mentions",
      "threads_read_replies",
      "threads_manage_replies",
      "threads_content_publish",
    ]);
    expect(parsed.searchParams.get("state")).toBeTruthy();
  });

  test("503 when the app id or secret is missing", async () => {
    env = baseEnv({ THREADS_APP_ID: "" });
    expect((await admin("/connect")).status).toBe(503);
  });

  test("the callback exchanges the code, stores the long-lived token and returns to the admin page", async () => {
    const state = await createConnectState(STATE_SECRET, NOW);
    const response = await app.request(
      `/api/threads/callback?code=abc%23_&state=${encodeURIComponent(state)}`,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://admin.test/#threads?connected=1");
    const [account] = await db.select().from(threadsAccount);
    expect(account).toMatchObject({
      source: "oauth",
      accessToken: "long-token",
      username: "joyorogo",
      threadsUserId: "100",
    });
    const exchange = graph.callsTo("/oauth/access_token")[0]!;
    expect(exchange.params.get("code")).toBe("abc");
    expect(exchange.params.get("redirect_uri")).toBe("https://api.test/api/threads/callback");
  });

  test("a missing, forged or expired state connects nothing", async () => {
    for (const state of [
      "",
      "forged.abcd",
      await createConnectState(STATE_SECRET, NOW - 3_600_000),
    ]) {
      const response = await app.request(
        `/api/threads/callback?code=abc&state=${encodeURIComponent(state)}`,
      );
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toContain("error=");
    }
    expect(await db.select().from(threadsAccount)).toHaveLength(0);
    expect(graph.callsTo("/oauth/access_token")).toHaveLength(0);
  });

  test("Meta's error redirect comes back to the admin page", async () => {
    const response = await app.request(`/api/threads/callback?error=access_denied`);
    expect(response.headers.get("location")).toBe(
      "https://admin.test/#threads?error=access_denied",
    );
  });
});

describe("deauthorize and data deletion callbacks", () => {
  const b64url = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  async function signedRequest(userId: string, secret = APP_SECRET) {
    const part = b64url(
      new TextEncoder().encode(JSON.stringify({ user_id: userId, algorithm: "HMAC-SHA256" })),
    );
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return `${b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(part))))}.${part}`;
  }
  const form = (signed: string) => ({
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ signed_request: signed }).toString(),
  });
  const seedAccount = () =>
    client.execute({
      sql: `INSERT INTO threads_account (id, threads_user_id, username, access_token, expires_at, source) VALUES (1, '100', 'joyorogo', 'tok', ?, 'oauth')`,
      args: [NOW + 30 * 86_400_000],
    });

  test("both forget the brand token for a valid signed request; the deletion answers with a status url and code", async () => {
    await seedAccount();
    expect(
      (await app.request("/api/threads/deauthorize", form(await signedRequest("100")))).status,
    ).toBe(200);
    expect(await db.select().from(threadsAccount)).toHaveLength(0);

    await seedAccount();
    const response = await app.request("/api/threads/delete", form(await signedRequest("100")));
    expect(await response.json()).toEqual({
      url: "https://joyorogo.com/privasi",
      confirmation_code: "100",
    });
    expect(await db.select().from(threadsAccount)).toHaveLength(0);
  });

  test("a bad signature or another user changes nothing", async () => {
    await seedAccount();
    expect(
      (await app.request("/api/threads/deauthorize", form(await signedRequest("100", "wrong"))))
        .status,
    ).toBe(400);
    expect(
      (await app.request("/api/threads/deauthorize", form(await signedRequest("555")))).status,
    ).toBe(200);
    expect(await db.select().from(threadsAccount)).toHaveLength(1);
  });
});

describe("cron tick", () => {
  test("refreshes the token even with the bot off, and polls only when it is on", async () => {
    const deps = { db, scan: async () => analysis([]), now: () => NOW };
    await runThreadsBotTick({ ...deps, config: botConfig(baseEnv({ THREADS_BOT_MODE: "off" })) });
    expect(graph.callsTo("refresh_access_token")).toHaveLength(1);
    expect(graph.callsTo("/mentions")).toHaveLength(0);

    graph.mentions = [
      graph.add({
        id: "poll-1",
        username: "poller",
        media_type: "IMAGE",
        media_url: IMAGE_URL,
        timestamp: threadsTime(NOW, 30_000),
      }),
    ];
    const result = await runThreadsBotTick({
      db,
      scan: async () => analysis([{ name: "Bakso", kcal: 400, confidence: 0.9 }]),
      config: botConfig(baseEnv()),
      now: () => NOW,
    });
    expect(result).toEqual({ polled: 1, handled: 1, swept: 0 });
    expect((await db.select().from(threadsMention))[0]).toMatchObject({
      mediaId: "poll-1",
      status: "pending_review",
    });
  });

  test("never throws", async () => {
    const broken = {
      db,
      scan: async () => analysis([]),
      config: botConfig(baseEnv()),
      now: () => NOW,
    };
    graph.failMentions = true;
    expect(await runThreadsBotTick(broken)).toEqual({ polled: 0, handled: 0, swept: 0 });
  });
});
