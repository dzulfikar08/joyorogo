import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { pushDevice, pushOutbox } from "@joyorogo/db/schema/push";
import { pushSubscription } from "@joyorogo/db/schema/plans";

import {
  CATEGORY_CAP,
  checkReceipts,
  enqueueMany,
  flushOutbox,
  inQuietHours,
  notify,
  quietEndsAt,
  runDigest,
  targets,
} from "./notify";
import type { NotifyDeps, PushEvent } from "./notify";
import { pushTestDb, seedDevice, seedUser, wib } from "./push-test-db";
import type { TestClient } from "./push-test-db";

// ---- A fake Expo + web push world -----------------------------------------------------------

type Sent = { url: string; body: unknown; headers: Record<string, string> };
let sent: Sent[] = [];
let expoMode: "ok" | "http500" = "ok";
let webStatus = 201;
let ticketSeq = 0;
let receipts: Record<string, { status: string; details?: { error: string } }> = {};
const realFetch = globalThis.fetch;

beforeEach(() => {
  sent = [];
  expoMode = "ok";
  webStatus = 201;
  ticketSeq = 0;
  receipts = {};
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (url.endsWith("/send")) {
      const messages = JSON.parse(String(init?.body)) as { to: string }[];
      sent.push({ url, body: messages, headers });
      if (expoMode === "http500") return new Response("boom", { status: 500 });
      return Response.json({
        data: messages.map((m) =>
          m.to.includes("dead")
            ? { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } }
            : { status: "ok", id: `T${++ticketSeq}-${m.to}` },
        ),
      });
    }
    if (url.endsWith("/getReceipts")) {
      const ids = (JSON.parse(String(init?.body)) as { ids: string[] }).ids;
      return Response.json({ data: Object.fromEntries(ids.filter((id) => receipts[id]).map((id) => [id, receipts[id]])) });
    }
    sent.push({ url, body: null, headers });
    return new Response(null, { status: webStatus });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const expoCalls = () => sent.filter((s) => s.url.endsWith("/send"));
const expoMessages = () => expoCalls().flatMap((s) => s.body as { to: string; title: string; body: string; channelId: string; data: Record<string, unknown> }[]);

const NOON = wib("2026-10-19", "12:00");
const clock = (at: Date): Pick<NotifyDeps, "now"> => ({ now: () => at });

const kudos = (extra: Partial<PushEvent> = {}): PushEvent => ({
  category: "social",
  kind: "kudos",
  title: { key: "notify.social.kudos.title", params: { name: "Ann" } },
  body: { text: "Lari pagi" },
  link: { t: "post", postId: "p1" },
  ...extra,
});

async function world() {
  const { client, db } = await pushTestDb();
  await seedUser(client, "u1");
  const deps = (at = NOON): NotifyDeps => ({ db, env: {}, ...clock(at) });
  return { client, db, deps };
}

describe("quiet hours math", () => {
  test("wraps past midnight and respects the switch", () => {
    const quiet = { enabled: true, start: "21:30", end: "06:30" };
    expect(inQuietHours(quiet, 22 * 60)).toBe(true);
    expect(inQuietHours(quiet, 3 * 60)).toBe(true);
    expect(inQuietHours(quiet, 6 * 60 + 29)).toBe(true);
    expect(inQuietHours(quiet, 6 * 60 + 30)).toBe(false);
    expect(inQuietHours(quiet, 21 * 60 + 29)).toBe(false);
    expect(inQuietHours({ ...quiet, enabled: false }, 23 * 60)).toBe(false);
    expect(inQuietHours({ enabled: true, start: "13:00", end: "13:00" }, 13 * 60)).toBe(false);
    expect(inQuietHours({ enabled: true, start: "01:00", end: "05:00" }, 2 * 60)).toBe(true);
  });

  test("quietEndsAt is the next time the WIB clock reads the end", () => {
    const quiet = { enabled: true, start: "21:30", end: "06:30" };
    expect(quietEndsAt(quiet, wib("2026-10-19", "22:00")).toISOString()).toBe(wib("2026-10-20", "06:30").toISOString());
    expect(quietEndsAt(quiet, wib("2026-10-20", "03:10")).toISOString()).toBe(wib("2026-10-20", "06:30").toISOString());
  });
});

describe("targets", () => {
  const sub = { id: "s", userId: "u", endpoint: "https://x", p256dh: "a", auth: "b", lastSentKey: null, createdAt: new Date() };
  const dev = (app: "joyorogo" | "joyofit") =>
    ({ id: app, userId: "u", app, platform: "android", expoToken: `ExponentPushToken[${app}]`, locale: null, createdAt: new Date(), lastSeenAt: new Date() }) as const;
  const post = { t: "post", postId: "p" } as const;

  test("JoyoFit-written events go to JoyoFit when it is registered, else to JoyoRogo", () => {
    const both = { subs: [sub], devices: [dev("joyorogo"), dev("joyofit")] };
    expect(targets(both, { app: "joyofit", link: post }, true).devices.map((d) => d.app)).toEqual(["joyofit"]);
    expect(targets(both, { app: "joyofit", link: post }, true).subs).toEqual([]);
    const rogoOnly = { subs: [sub], devices: [dev("joyorogo")] };
    const picked = targets(rogoOnly, { app: "joyofit", link: post }, true);
    expect(picked.devices.map((d) => d.app)).toEqual(["joyorogo"]);
    expect(picked.subs).toHaveLength(1);
  });

  test("other events skip JoyoFit while JoyoRogo is reachable; a JoyoFit-only person gets social ones only", () => {
    const both = { subs: [], devices: [dev("joyorogo"), dev("joyofit")] };
    expect(targets(both, { link: post }, true).devices.map((d) => d.app)).toEqual(["joyorogo"]);
    const fitOnly = { subs: [], devices: [dev("joyofit")] };
    expect(targets(fitOnly, { link: post }, true).devices).toHaveLength(1);
    expect(targets(fitOnly, { link: { t: "makan" } }, true).devices).toHaveLength(0);
  });

  test("web subscriptions only count when VAPID is configured", () => {
    expect(targets({ subs: [sub], devices: [] }, { link: post }, false).subs).toHaveLength(0);
  });
});

describe("notify", () => {
  test("delivers to the phone in the person's language with data, channel and a stored outbox row", async () => {
    const { client, db, deps } = await world();
    await seedDevice(client, "u1", "aaa");
    const result = await notify(deps(), "u1", kudos({ dedupeKey: "k1" }));
    expect(result.status).toBe("sent");
    const [message] = expoMessages();
    expect(message?.to).toBe("ExponentPushToken[aaa]");
    expect(message?.title).toBe("Ann kasih semangat");
    expect(message?.body).toBe("Lari pagi");
    expect(message?.channelId).toBe("social");
    expect(message?.data).toEqual({ v: 1, kind: "kudos", link: { t: "post", postId: "p1" }, url: "/p/p1", app: "joyorogo" });
    const [row] = await db.select().from(pushOutbox);
    expect(row?.status).toBe("sent");
    expect(row?.ticketsJson).toContain("T1-ExponentPushToken[aaa]");
  });

  test("writes in English for an English account", async () => {
    const { client, deps } = await world();
    await client.execute(`UPDATE profile SET locale = 'en' WHERE user_id = 'u1'`);
    await seedDevice(client, "u1", "aaa");
    await notify(deps(), "u1", kudos());
    expect(expoMessages()[0]?.title).toBe("Ann cheered you on");
  });

  test("a switched-off category and an unreachable person store nothing", async () => {
    const { client, db, deps } = await world();
    expect((await notify(deps(), "u1", kudos())).status).toBe("skipped");
    await seedDevice(client, "u1", "aaa");
    await client.execute(`INSERT INTO push_prefs (user_id, social) VALUES ('u1', 0)`);
    expect((await notify(deps(), "u1", kudos())).status).toBe("skipped");
    expect(await db.select().from(pushOutbox)).toHaveLength(0);
    expect(expoCalls()).toHaveLength(0);
    // another category is unaffected
    expect((await notify(deps(), "u1", { ...kudos(), category: "group", kind: "poke" })).status).toBe("sent");
  });

  test("the same dedupe key never produces a second push", async () => {
    const { client, deps } = await world();
    await seedDevice(client, "u1", "aaa");
    expect((await notify(deps(), "u1", kudos({ dedupeKey: "same" }))).status).toBe("sent");
    expect((await notify(deps(), "u1", kudos({ dedupeKey: "same" }))).status).toBe("duplicate");
    expect(expoMessages()).toHaveLength(1);
  });

  test("quiet hours queue the push and the flush delivers it once they end", async () => {
    const { client, db, deps } = await world();
    await seedDevice(client, "u1", "aaa");
    const night = wib("2026-10-19", "22:15");
    expect((await notify(deps(night), "u1", kudos())).status).toBe("queued");
    expect(expoCalls()).toHaveLength(0);
    const [queued] = await db.select().from(pushOutbox);
    expect(queued?.status).toBe("queued");
    expect(queued?.sendAfter.toISOString()).toBe(wib("2026-10-20", "06:30").toISOString());

    expect(await flushOutbox(deps(wib("2026-10-20", "05:00")))).toBe(0);
    expect(expoCalls()).toHaveLength(0);
    expect(await flushOutbox(deps(wib("2026-10-20", "06:35")))).toBe(1);
    expect(expoMessages()).toHaveLength(1);
    expect((await db.select().from(pushOutbox))[0]?.status).toBe("sent");
  });

  test("quiet hours the person narrowed or switched off are honoured", async () => {
    const { client, deps } = await world();
    await seedDevice(client, "u1", "aaa");
    await client.execute(`INSERT INTO push_prefs (user_id, quiet_enabled) VALUES ('u1', 0)`);
    expect((await notify(deps(wib("2026-10-19", "23:00")), "u1", kudos())).status).toBe("sent");
    await client.execute(`UPDATE push_prefs SET quiet_enabled = 1, quiet_start = '12:30', quiet_end = '13:30' WHERE user_id = 'u1'`);
    expect((await notify(deps(wib("2026-10-19", "13:00")), "u1", kudos())).status).toBe("queued");
  });

  test("a queued row of a waiting collapse key is replaced by the newest", async () => {
    const { client, db, deps } = await world();
    await seedDevice(client, "u1", "aaa");
    const night = wib("2026-10-19", "22:15");
    await notify({ ...deps(night) }, "u1", kudos({ collapseKey: "kudos:p1", dedupeKey: "a" }));
    await notify({ ...deps(new Date(night.getTime() + 60_000)) }, "u1", kudos({ collapseKey: "kudos:p1", dedupeKey: "b" }));
    await flushOutbox(deps(wib("2026-10-20", "06:40")));
    expect(expoMessages()).toHaveLength(1);
    const rows = await db.select().from(pushOutbox);
    expect(rows.filter((r) => r.status === "dropped")).toHaveLength(1);
    expect(rows.filter((r) => r.status === "sent")).toHaveLength(1);
  });

  test("over the daily cap social goes to the digest, which one evening push summarises", async () => {
    const { client, db, deps } = await world();
    await seedDevice(client, "u1", "aaa");
    const cap = CATEGORY_CAP.social;
    for (let i = 0; i < cap + 3; i++) {
      await notify(deps(new Date(NOON.getTime() + i * 1000)), "u1", kudos({ dedupeKey: `k${i}` }));
    }
    expect(expoMessages()).toHaveLength(cap);
    const rows = await db.select().from(pushOutbox);
    expect(rows.filter((r) => r.status === "digest")).toHaveLength(3);

    // before 19:00 the digest waits
    expect(await runDigest(deps(wib("2026-10-19", "18:00")))).toBe(0);
    expect(expoMessages()).toHaveLength(cap);
    expect(await runDigest(deps(wib("2026-10-19", "19:05")))).toBe(1);
    const digest = expoMessages().at(-1);
    expect(digest?.title).toBe("3 notifikasi sosial lainnya");
    expect(digest?.data.link).toEqual({ t: "feed" });
    expect((await db.select().from(pushOutbox)).filter((r) => r.status === "digested")).toHaveLength(3);
    // a second run the same evening sends nothing
    expect(await runDigest(deps(wib("2026-10-19", "19:10")))).toBe(0);
  });

  test("held rows of an earlier day are dropped, not digested", async () => {
    const { client, db, deps } = await world();
    await seedDevice(client, "u1", "aaa");
    for (let i = 0; i < CATEGORY_CAP.social + 1; i++) await notify(deps(NOON), "u1", kudos({ dedupeKey: `k${i}` }));
    const before = expoMessages().length;
    expect(await runDigest(deps(wib("2026-10-20", "19:30")))).toBe(0);
    expect(expoMessages()).toHaveLength(before);
    expect((await db.select().from(pushOutbox)).some((r) => r.lastError === "stale-digest")).toBe(true);
  });

  test("reminders over their cap are dropped, never digested", async () => {
    const { client, db, deps } = await world();
    await seedDevice(client, "u1", "aaa");
    const reminder = (key: string): PushEvent => ({
      category: "weigh",
      kind: "weigh",
      title: { key: "notify.weigh.title", params: { n: 8 } },
      link: { t: "berat" },
      dedupeKey: key,
    });
    expect((await notify(deps(), "u1", reminder("w1"))).status).toBe("sent");
    expect((await notify(deps(), "u1", reminder("w2"))).status).toBe("dropped");
    expect((await db.select().from(pushOutbox)).filter((r) => r.status === "digest")).toHaveLength(0);
  });

  test("the test push ignores switches, quiet hours and caps", async () => {
    const { client, deps } = await world();
    await seedDevice(client, "u1", "aaa");
    await client.execute(`INSERT INTO push_prefs (user_id, social) VALUES ('u1', 0)`);
    const night = wib("2026-10-19", "23:30");
    expect((await notify(deps(night), "u1", kudos({ kind: "test", bypass: true }))).status).toBe("sent");
  });

  test("a stale reminder is dropped instead of sent late", async () => {
    const { client, db, deps } = await world();
    await seedDevice(client, "u1", "aaa");
    const store = await enqueueMany(deps(NOON), ["u1"], () => kudos({ staleMs: 60_000 }));
    expect(store).toBe(1);
    await flushOutbox(deps(new Date(NOON.getTime() + 10 * 60_000)));
    expect(expoCalls()).toHaveLength(0);
    expect((await db.select().from(pushOutbox))[0]?.lastError).toBe("stale");
  });
});

describe("fan-out per app", () => {
  test("a JoyoFit watch post's comment goes to the JoyoFit phone only", async () => {
    const { client, deps } = await world();
    await seedDevice(client, "u1", "rogo", "joyorogo");
    await seedDevice(client, "u1", "fit", "joyofit");
    await notify(deps(), "u1", kudos({ app: "joyofit" }));
    const messages = expoMessages();
    expect(messages.map((m) => m.to)).toEqual(["ExponentPushToken[fit]"]);
    expect(messages[0]?.data.app).toBe("joyofit");
    expect(messages[0]?.channelId).toBe("social");
  });

  test("with no JoyoFit phone the same event reaches JoyoRogo", async () => {
    const { client, deps } = await world();
    await seedDevice(client, "u1", "rogo", "joyorogo");
    await notify(deps(), "u1", kudos({ app: "joyofit" }));
    expect(expoMessages().map((m) => m.to)).toEqual(["ExponentPushToken[rogo]"]);
    expect(expoMessages()[0]?.channelId).toBe("social");
  });

  test("a reminder uses its category as the Android channel", async () => {
    const { client, deps } = await world();
    await seedDevice(client, "u1", "rogo");
    await notify(deps(), "u1", {
      category: "meal",
      kind: "meal_noon",
      title: { key: "notify.meal.noon.title" },
      link: { t: "makan" },
    });
    expect(expoMessages()[0]?.channelId).toBe("meal");
  });
});

describe("failures", () => {
  test("a dead token is deleted and the row dropped", async () => {
    const { client, db, deps } = await world();
    await seedDevice(client, "u1", "dead1");
    expect((await notify(deps(), "u1", kudos())).status).toBe("dropped");
    expect(await db.select().from(pushDevice)).toHaveLength(0);
  });

  test("one live and one dead token: the row is sent and only the dead one goes", async () => {
    const { client, db, deps } = await world();
    await seedDevice(client, "u1", "dead1");
    await seedDevice(client, "u1", "live1");
    expect((await notify(deps(), "u1", kudos())).status).toBe("sent");
    expect((await db.select().from(pushDevice)).map((d) => d.expoToken)).toEqual(["ExponentPushToken[live1]"]);
  });

  test("a transient failure is retried with backoff and ends as failed after four attempts", async () => {
    const { client, db, deps } = await world();
    await seedDevice(client, "u1", "aaa");
    expoMode = "http500";
    expect((await notify(deps(), "u1", kudos())).status).toBe("queued");
    let [row] = await db.select().from(pushOutbox);
    expect(row?.attempts).toBe(1);
    expect(row?.sendAfter.getTime()).toBe(NOON.getTime() + 5 * 60_000);

    // not due yet
    expect(await flushOutbox(deps(new Date(NOON.getTime() + 60_000)))).toBe(0);
    let at = NOON.getTime() + 5 * 60_000;
    expect(await flushOutbox(deps(new Date(at)))).toBe(1);
    [row] = await db.select().from(pushOutbox);
    expect(row?.attempts).toBe(2);
    expect(row?.sendAfter.getTime()).toBe(at + 10 * 60_000);
    at += 10 * 60_000;
    await flushOutbox(deps(new Date(at)));
    at += 20 * 60_000;
    await flushOutbox(deps(new Date(at)));
    [row] = await db.select().from(pushOutbox);
    expect(row?.status).toBe("failed");
    expect(row?.attempts).toBe(4);
    expect(row?.lastError).toBe("http-500");
  });

  test("the retry succeeds once Expo answers again", async () => {
    const { client, db, deps } = await world();
    await seedDevice(client, "u1", "aaa");
    expoMode = "http500";
    await notify(deps(), "u1", kudos());
    expoMode = "ok";
    await flushOutbox(deps(new Date(NOON.getTime() + 6 * 60_000)));
    expect((await db.select().from(pushOutbox))[0]?.status).toBe("sent");
  });

  test("receipts: a device Expo reports as unregistered later is deleted, the ticket ids cleared", async () => {
    const { client, db, deps } = await world();
    await seedDevice(client, "u1", "aaa");
    await seedDevice(client, "u1", "bbb");
    await notify(deps(), "u1", kudos());
    const [row] = await db.select().from(pushOutbox);
    const tickets = JSON.parse(row!.ticketsJson!) as { t: string; d: string }[];
    expect(tickets).toHaveLength(2);
    receipts[tickets[0]!.t] = { status: "error", details: { error: "DeviceNotRegistered" } };
    receipts[tickets[1]!.t] = { status: "ok" };

    // too early: nothing is read
    expect(await checkReceipts(deps(new Date(NOON.getTime() + 60_000)))).toBe(0);
    expect(await checkReceipts(deps(new Date(NOON.getTime() + 20 * 60_000)))).toBe(1);
    const devices = await db.select().from(pushDevice);
    expect(devices.map((d) => d.id)).toEqual([tickets[1]!.d]);
    expect((await db.select().from(pushOutbox))[0]?.ticketsJson).toBeNull();
  });
});

describe("web push", () => {
  async function vapid() {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const b64u = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const publicRaw = await crypto.subtle.exportKey("raw", pair.publicKey);
    return { VAPID_PUBLIC_KEY: b64u(publicRaw), VAPID_PRIVATE_KEY: jwk.d!, VAPID_SUBJECT: "mailto:test@joyorogo.com" };
  }

  async function seedBrowser(client: TestClient, id: string) {
    const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
    await client.execute({
      sql: `INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth) VALUES (?, 'u1', ?, ?, ?)`,
      args: [id, `https://push.example/${id}`, Buffer.from(raw).toString("base64url"), Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url")],
    });
  }

  test("sends the encrypted payload to the browser; a 410 deletes the subscription", async () => {
    const { client, db } = await world();
    await seedBrowser(client, "b1");
    const deps: NotifyDeps = { db, env: await vapid(), ...clock(NOON) };
    expect((await notify(deps, "u1", kudos())).status).toBe("sent");
    const call = sent.find((s) => s.url.startsWith("https://push.example/"));
    expect(call?.headers.Authorization).toStartWith("vapid t=");
    expect(call?.headers["Content-Encoding"]).toBe("aes128gcm");

    webStatus = 410;
    expect((await notify(deps, "u1", kudos({ dedupeKey: "again" }))).status).toBe("dropped");
    expect(await db.select().from(pushSubscription).where(eq(pushSubscription.id, "b1"))).toHaveLength(0);
  });

  test("a browser is not a target while VAPID is not configured", async () => {
    const { client, deps } = await world();
    await seedBrowser(client, "b1");
    expect((await notify(deps(), "u1", kudos())).status).toBe("skipped");
  });

  test("a web 503 is retried", async () => {
    const { client, db } = await world();
    await seedBrowser(client, "b1");
    const deps: NotifyDeps = { db, env: await vapid(), ...clock(NOON) };
    webStatus = 503;
    expect((await notify(deps, "u1", kudos())).status).toBe("queued");
  });
});
