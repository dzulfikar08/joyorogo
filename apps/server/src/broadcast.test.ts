import { join } from "node:path";

import { d1TestDb } from "@joyorogo/db/test-d1";
import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { StickersBucket } from "@joyorogo/api/lib/sticker";

import { BATCH_LIMIT, RecipientCountChanged, broadcastStatus, runBroadcastTick, sendBroadcast, sendBroadcastTest } from "./broadcast";
import type { BroadcastDeps } from "./broadcast";
import { BROADCAST_SENDER, DEFAULT_CAMPAIGN } from "./broadcast-campaign";
import { firstName, renderBroadcast } from "./broadcast-render";
import { registerBroadcastRoutes } from "./broadcast-routes";
import { listOptedOut, recordOptOut, registerUnsubscribeRoutes, signUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe";

const { client, db } = await d1TestDb();

const SECRET = "test-secret-test-secret-test-secret-1234";
const BASE = "https://api.test";

function fakeBucket() {
  const objects = new Map<string, string>();
  const bucket: StickersBucket = {
    async put(key, value) {
      objects.set(key, typeof value === "string" ? value : "<binary>");
    },
    async get(key) {
      const found = objects.get(key);
      if (found === undefined) return null;
      const bytes = new TextEncoder().encode(found);
      return {
        body: new Blob([bytes]).stream(),
        size: bytes.length,
        arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer,
      };
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
    async list({ prefix }) {
      return { objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).sort().map((key) => ({ key })), truncated: false };
    },
  };
  return { bucket, objects };
}

type Sent = {
  to: string;
  from: { email: string; name: string };
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
};

let outbox: Sent[] = [];
/** Per-recipient send behaviour: throw to fail. */
let sendHook: (to: string) => void = () => undefined;

const email = {
  send: async (message: Sent) => {
    sendHook(message.to);
    outbox.push(message);
    return { messageId: `m${outbox.length}` };
  },
} as unknown as NonNullable<BroadcastDeps["email"]>;

const CAMPAIGN = { id: "test-campaign", subject: "Halo", body: "Halo {nama},\n\nKabar baru." };

function makeDeps() {
  const { bucket, objects } = fakeBucket();
  const deps: BroadcastDeps = { db, bucket, email, secret: SECRET, baseUrl: BASE };
  return { deps, bucket, objects };
}

async function seedUsers(count: number, extra: string[] = []) {
  await client.execute(`DELETE FROM email_log`);
  await client.execute(`DELETE FROM "user"`);
  const rows = Array.from({ length: count }, (_, i) => {
    const n = String(i).padStart(2, "0");
    return `('u${n}', 'Orang ${n}', 'u${n}@test.id', 1, 1)`;
  });
  await client.execute(`INSERT INTO "user" (id, name, email, email_verified, created_at) VALUES ${[...rows, ...extra].join(", ")}`);
}

const logRows = async (kind: string) =>
  (await client.execute({ sql: `SELECT user_id, ref FROM email_log WHERE kind = ? ORDER BY ref`, args: [kind] })).rows;

beforeEach(() => {
  outbox = [];
  sendHook = () => undefined;
});

describe("unsubscribe token", () => {
  test("round-trips and is bound to the user", async () => {
    const token = await signUnsubscribeToken(SECRET, "user123");
    expect(await verifyUnsubscribeToken(SECRET, token)).toBe("user123");
    expect(await signUnsubscribeToken(SECRET, "user123")).toBe(token);
    expect(await signUnsubscribeToken(SECRET, "user124")).not.toBe(token);
  });

  test("rejects forged, tampered, re-targeted, wrong-secret and malformed tokens", async () => {
    const token = await signUnsubscribeToken(SECRET, "user123");
    const [, sig] = token.split(".");
    expect(await verifyUnsubscribeToken(SECRET, `user124.${sig}`)).toBeNull();
    expect(await verifyUnsubscribeToken(SECRET, `${token}x`)).toBeNull();
    expect(await verifyUnsubscribeToken(SECRET, token.slice(0, -2))).toBeNull();
    expect(await verifyUnsubscribeToken("another-secret", token)).toBeNull();
    for (const bad of ["", "nodot", ".sig", "user123.", "user123.!!!", "../x.abc", "user123.a.b"]) {
      expect(await verifyUnsubscribeToken(SECRET, bad)).toBeNull();
    }
  });
});

describe("renderBroadcast", () => {
  const url = `${BASE}/unsubscribe?t=abc`;

  test("first name, with a fallback and capitalised lowercase names", () => {
    expect(firstName("Siti Aminah")).toBe("Siti");
    expect(firstName("dzul fikar")).toBe("Dzul");
    expect(firstName("McDonald Lee")).toBe("McDonald");
    expect(firstName("  ")).toBe("kamu");
    expect(firstName("")).toBe("kamu");
    expect(firstName(null)).toBe("kamu");
    expect(firstName("someone@mail.com")).toBe("kamu");
    expect(firstName("123")).toBe("kamu");
  });

  test("name is HTML-escaped and cannot inject markup or links", () => {
    const mail = renderBroadcast({ campaign: { subject: "s", body: "Halo {nama}" }, name: "<b>x</b>", unsubscribeUrl: url });
    expect(mail.html).toContain("Halo &lt;b&gt;x&lt;/b&gt;");
    const link = renderBroadcast({ campaign: { subject: "s", body: "Halo {nama}" }, name: "**a**", unsubscribeUrl: url });
    expect(link.html).toContain("Halo **a**");
  });

  test("text part keeps the lines, strips markup, and ends with the unsubscribe link", () => {
    const mail = renderBroadcast({
      campaign: { subject: "s", body: "**Judul**\nIsi [tautan](https://a.id/x) dan https://b.id/y, selesai.\n- satu\n- dua" },
      name: "Siti",
      unsubscribeUrl: url,
    });
    expect(mail.text).toBe(
      `Judul\nIsi tautan (https://a.id/x) dan https://b.id/y, selesai.\n\n- satu\n- dua\n\nTidak mau terima email seperti ini lagi? Berhenti berlangganan: ${url}\n`,
    );
    expect(mail.html).toContain(`<strong>Judul</strong><br>Isi <a href="https://a.id/x"`);
    expect(mail.html).toContain(`<a href="https://b.id/y" style="color:#15803d;">https://b.id/y</a>, selesai.`);
    expect(mail.html).toContain("<ul");
    expect(mail.html).toContain(`<a href="${url}"`);
  });

  test("the default announcement: Indonesian copy, store links filled, one footer, no images or emoji", () => {
    const mail = renderBroadcast({ campaign: DEFAULT_CAMPAIGN, name: "Rina Putri", unsubscribeUrl: url });
    expect(mail.subject).toBe("Sekarang bisa koreksi hasil scan pakai suara, dan JoyoRogo sudah di Google Play");
    expect(mail.text.startsWith("Halo Rina,\n\nAda beberapa kabar dari JoyoRogo dan JoyoFit:\n\n1. Hasil scan salah? Tinggal bilang.\n")).toBe(true);
    expect(mail.text).toContain("- JoyoRogo iPhone (App Store): https://apps.apple.com/id/app/id6823222101?ct=email-2026-10-broadcast\n- JoyoRogo Android (Google Play): https://play.google.com/store/apps/details?id=com.joyodigitama.joyorogo&referrer=utm_source%3Demail%26utm_medium%3Dbroadcast%26utm_campaign%3D2026-10-broadcast\n- JoyoFit iPhone (beta TestFlight, untuk jam Huawei): https://testflight.apple.com/join/GXzrQ8GJ\n");
    expect(mail.text).toContain("Daftar di https://fit.joyorogo.com/strava, nanti kami kabari.");
    expect(mail.text).toContain("Salam,\nDzulfikar, JoyoRogo\n\nTidak mau terima email seperti ini lagi? Berhenti berlangganan: ");
    expect(mail.text).not.toContain("{");
    expect(mail.text).not.toContain("**");
    expect(mail.html).not.toMatch(/<img|<script|\{nama\}/);
    expect(`${mail.html}${mail.text}`).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(mail.html.match(/Berhenti berlangganan/g)).toHaveLength(1);
  });
});

describe("opt-out store", () => {
  test("records once and lists every opted-out user", async () => {
    const { bucket, objects } = fakeBucket();
    await recordOptOut(bucket, "u1", 111);
    await recordOptOut(bucket, "u1", 222);
    await recordOptOut(bucket, "u2", 333);
    expect(JSON.parse(objects.get("email-optout/u1")!)).toEqual({ at: 111 });
    expect([...(await listOptedOut(bucket))].sort()).toEqual(["u1", "u2"]);
  });
});

describe("unsubscribe routes", () => {
  test("GET only asks; POST records the opt-out; bad tokens are 400", async () => {
    const { bucket, objects } = fakeBucket();
    const app = new Hono();
    registerUnsubscribeRoutes(app, { secret: SECRET, getBucket: () => bucket });
    const token = await signUnsubscribeToken(SECRET, "u1");

    const confirm = await app.request(`/unsubscribe?t=${token}`);
    expect(confirm.status).toBe(200);
    const html = await confirm.text();
    expect(html).toContain('lang="id"');
    expect(html).toContain("Ya, berhenti berlangganan");
    expect(objects.size).toBe(0);

    // RFC 8058 one-click: a bare POST with the form body a mail client sends.
    const oneClick = await app.request(`/unsubscribe?t=${token}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });
    expect(oneClick.status).toBe(200);
    expect(await oneClick.text()).toContain("Sudah berhenti berlangganan");
    expect([...objects.keys()]).toEqual(["email-optout/u1"]);

    expect((await app.request(`/unsubscribe?t=${token}x`)).status).toBe(400);
    expect((await app.request(`/unsubscribe?t=${token}x`, { method: "POST" })).status).toBe(400);
    expect((await app.request(`/unsubscribe`, { method: "POST" })).status).toBe(400);
    expect(objects.size).toBe(1);
  });

  test("without a bucket nothing is recorded and the answer is 503", async () => {
    const app = new Hono();
    registerUnsubscribeRoutes(app, { secret: SECRET, getBucket: () => undefined });
    const token = await signUnsubscribeToken(SECRET, "u1");
    expect((await app.request(`/unsubscribe?t=${token}`, { method: "POST" })).status).toBe(503);
  });
});

describe("sendBroadcast", () => {
  test("mails each verified user once, with their link and headers, and logs broadcast:<id>", async () => {
    await seedUsers(3, [`('unv', 'Belum Verif', 'unv@test.id', 0, 1)`]);
    const { deps } = makeDeps();
    const { batch, status } = await sendBroadcast(deps, CAMPAIGN, 3);

    expect(batch).toEqual({ sent: 3, failed: 0, stopped: null });
    expect(status).toMatchObject({ state: "done", eligible: 3, sent: 3, remaining: 0, failed: 0, optedOut: 0 });
    expect(outbox.map((m) => m.to).sort()).toEqual(["u00@test.id", "u01@test.id", "u02@test.id"]);
    expect(outbox.some((m) => m.to === "unv@test.id")).toBe(false);

    // Sends run concurrently, so the outbox order is not the user order.
    const first = outbox.find((m) => m.to === "u00@test.id")!;
    expect(first.from).toEqual({ email: BROADCAST_SENDER.email, name: BROADCAST_SENDER.name });
    expect(first.text.startsWith("Halo Orang,")).toBe(true);
    const token = await signUnsubscribeToken(SECRET, "u00");
    expect(first.text).toContain(`${BASE}/unsubscribe?t=${token}`);
    expect(first.headers["List-Unsubscribe"]).toBe(`<${BASE}/unsubscribe?t=${token}>`);
    expect(first.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");

    const rows = await logRows("broadcast:test-campaign");
    expect(rows.map((r) => r.ref)).toEqual(["u00", "u01", "u02"]);
    expect(rows.every((r) => r.ref === r.user_id)).toBe(true);
  });

  test("an explicit recipient list mails only those users, fills {tanggal} with their WIB date, and the cron keeps the list", async () => {
    await seedUsers(4);
    // 2026-11-17T20:00Z is already 18 November in WIB.
    await client.execute(`UPDATE "user" SET founder_until = ${Date.UTC(2026, 10, 17, 20)} WHERE id = 'u01'`);
    const { deps } = makeDeps();
    const campaign = { id: "list-campaign", subject: "Halo", body: "Aktif sampai {tanggal}, {nama}.", recipients: ["u01", "u03", "ghost"] };
    await expect(sendBroadcast(deps, campaign, 3)).rejects.toBeInstanceOf(RecipientCountChanged);
    const { status } = await sendBroadcast(deps, campaign, 2, 1);
    expect(status).toMatchObject({ eligible: 2, sent: 1, remaining: 1, state: "sending" });
    await runBroadcastTick(deps);
    expect(outbox.map((m) => m.to).sort()).toEqual(["u01@test.id", "u03@test.id"]);
    expect(outbox.find((m) => m.to === "u01@test.id")!.text).toContain("Aktif sampai 18 November 2026, Orang.");
    expect((await logRows("broadcast:list-campaign")).map((r) => r.ref)).toEqual(["u01", "u03"]);
  });

  test("a 300-id recipient list (D1 binds 100 values per statement) reaches every listed user, in id order", async () => {
    await seedUsers(320);
    const recipients = Array.from({ length: 300 }, (_, i) => `u${String(i).padStart(2, "0")}`);
    const { deps } = makeDeps();
    const campaign = { id: "big-list", subject: "Halo", body: "Halo {nama}", recipients };
    const { status } = await sendBroadcast(deps, campaign, 300, 5);
    expect(status).toMatchObject({ eligible: 300, sent: 5, remaining: 295 });
    expect(outbox.map((m) => m.to).sort()).toEqual(["u00", "u01", "u02", "u03", "u04"].map((id) => `${id}@test.id`));
  });

  test("{tanggal} is the recipient's own calendar day: 23:30 WIB on the 17th is already the 18th in Kuala Lumpur", async () => {
    await seedUsers(4);
    await client.execute(`UPDATE "user" SET founder_until = ${Date.UTC(2026, 10, 17, 16, 30)} WHERE id IN ('u01', 'u03')`);
    await client.execute(`INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level, timezone)
      VALUES ('u03', 1990, 'male', 170, 80, 72, '2030-01-01', 'light', 'Asia/Kuala_Lumpur')`);
    const { deps } = makeDeps();
    const campaign = { id: "zone-campaign", subject: "Halo", body: "Aktif sampai {tanggal}.", recipients: ["u01", "u03"] };
    await sendBroadcast(deps, campaign, 2);
    expect(outbox.find((m) => m.to === "u01@test.id")!.text).toContain("Aktif sampai 17 November 2026.");
    expect(outbox.find((m) => m.to === "u03@test.id")!.text).toContain("Aktif sampai 18 November 2026.");
    await client.execute(`DELETE FROM profile`);
  });

  test("a second run, a re-click, and the cron send nothing more", async () => {
    await seedUsers(3);
    const { deps } = makeDeps();
    await sendBroadcast(deps, CAMPAIGN, 3);
    outbox = [];
    const again = await sendBroadcast(deps, CAMPAIGN, 0);
    expect(again.batch).toEqual({ sent: 0, failed: 0, stopped: null });
    expect(again.status.state).toBe("done");
    expect(await runBroadcastTick(deps)).toBeNull();
    expect(outbox).toHaveLength(0);
    expect(await logRows("broadcast:test-campaign")).toHaveLength(3);
  });

  test("opted-out users are skipped, also when they opt out mid-campaign", async () => {
    await seedUsers(5);
    const { deps, bucket } = makeDeps();
    await recordOptOut(bucket, "u01");
    expect((await broadcastStatus(deps, CAMPAIGN.id)).remaining).toBe(4);

    const first = await sendBroadcast(deps, CAMPAIGN, 4, 2);
    expect(first.batch.sent).toBe(2);
    expect(first.status).toMatchObject({ state: "sending", remaining: 2, sent: 2, optedOut: 1 });
    await recordOptOut(bucket, "u03");

    const second = await sendBroadcast(deps, CAMPAIGN, 999, 10);
    expect(second.status).toMatchObject({ state: "done", remaining: 0, sent: 3, optedOut: 2 });
    expect(outbox.map((m) => m.to).sort()).toEqual(["u00@test.id", "u02@test.id", "u04@test.id"]);
  });

  test("batches: at most `limit` per call, the rest waits for the next call or the cron", async () => {
    await seedUsers(7);
    const { deps } = makeDeps();
    const first = await sendBroadcast(deps, CAMPAIGN, 7, 3);
    expect(first.batch.sent).toBe(3);
    expect(first.status).toMatchObject({ state: "sending", remaining: 4 });

    const tick = await runBroadcastTick(deps, 3);
    expect(tick?.sent).toBe(3);
    const last = await sendBroadcast(deps, CAMPAIGN, 0, 3);
    expect(last.batch.sent).toBe(1);
    expect(last.status).toMatchObject({ state: "done", sent: 7, remaining: 0 });
    expect(new Set(outbox.map((m) => m.to)).size).toBe(7);
    expect(BATCH_LIMIT).toBeGreaterThan(0);
  });

  test("the first call needs the confirmed recipient count; the subject and body are then frozen for the cron", async () => {
    await seedUsers(4);
    const { deps, objects } = makeDeps();
    await expect(sendBroadcast(deps, CAMPAIGN, 3)).rejects.toThrow(RecipientCountChanged);
    expect(objects.size).toBe(0);
    expect(outbox).toHaveLength(0);

    await sendBroadcast(deps, CAMPAIGN, 4, 1);
    await sendBroadcast(deps, { ...CAMPAIGN, subject: "Diganti", body: "Lain" }, 0, 1);
    const tick = await runBroadcastTick(deps, 10);
    expect(tick?.sent).toBe(2);
    expect(new Set(outbox.map((m) => m.subject))).toEqual(new Set(["Halo"]));
  });

  test("a failed send frees its claim; the next run mails that user", async () => {
    await seedUsers(3);
    const { deps } = makeDeps();
    sendHook = (to) => {
      if (to === "u01@test.id") throw new Error("mailbox unavailable");
    };
    const first = await sendBroadcast(deps, CAMPAIGN, 3);
    expect(first.batch).toMatchObject({ sent: 2, failed: 1, stopped: null });
    expect(first.status).toMatchObject({ state: "sending", sent: 2, remaining: 1 });
    expect((await logRows("broadcast:test-campaign")).map((r) => r.ref)).toEqual(["u00", "u02"]);

    sendHook = () => undefined;
    const second = await sendBroadcast(deps, CAMPAIGN, 0);
    expect(second.batch.sent).toBe(1);
    expect(second.status).toMatchObject({ state: "done", sent: 3, remaining: 0 });
    expect(outbox.filter((m) => m.to === "u01@test.id")).toHaveLength(1);
  });

  test("rate limiting stops the batch without burning the users' attempts; the cron picks up", async () => {
    await seedUsers(6);
    const { deps } = makeDeps();
    let calls = 0;
    sendHook = () => {
      if (++calls > 2) throw new Error("429 too many requests");
    };
    const first = await sendBroadcast(deps, CAMPAIGN, 6, 6);
    expect(first.batch.stopped).toContain("429");
    expect(first.batch.sent).toBe(2);
    expect(first.status).toMatchObject({ state: "sending", sent: 2, failed: 0, remaining: 4 });

    sendHook = () => undefined;
    const tick = await runBroadcastTick(deps, 10);
    expect(tick).toEqual({ sent: 4, failed: 0, stopped: null });
    expect((await broadcastStatus(deps, CAMPAIGN.id)).state).toBe("done");
    expect(new Set(outbox.map((m) => m.to)).size).toBe(6);
  });

  test("a user whose address keeps failing is given up on after three tries, so the campaign can finish", async () => {
    await seedUsers(3);
    const { deps } = makeDeps();
    sendHook = (to) => {
      if (to === "u00@test.id") throw new Error("invalid recipient");
    };
    let status = (await sendBroadcast(deps, CAMPAIGN, 3)).status;
    expect(status).toMatchObject({ state: "sending", remaining: 1, failed: 0 });
    status = (await sendBroadcast(deps, CAMPAIGN, 0)).status;
    status = (await sendBroadcast(deps, CAMPAIGN, 0)).status;
    expect(status).toMatchObject({ state: "done", sent: 2, remaining: 0, failed: 1 });
    outbox = [];
    expect((await sendBroadcast(deps, CAMPAIGN, 0)).batch.sent).toBe(0);
    expect(outbox).toHaveLength(0);
  });

  test("two runners at once never mail a user twice", async () => {
    await seedUsers(8);
    const { deps } = makeDeps();
    await sendBroadcast(deps, CAMPAIGN, 8, 1);
    outbox = [];
    await Promise.all([sendBroadcast(deps, CAMPAIGN, 0, 10), runBroadcastTick(deps, 10), sendBroadcast(deps, CAMPAIGN, 0, 10)]);
    expect(outbox).toHaveLength(7);
    expect(new Set(outbox.map((m) => m.to)).size).toBe(7);
  });

  test("with no EMAIL binding nothing is claimed for good", async () => {
    await seedUsers(2);
    const { deps } = makeDeps();
    const off = { ...deps, email: undefined };
    const result = await sendBroadcast(off, CAMPAIGN, 2);
    expect(result.batch.sent).toBe(0);
    expect(result.batch.stopped).not.toBeNull();
    expect(await logRows("broadcast:test-campaign")).toHaveLength(0);
  });
});

describe("sendBroadcastTest", () => {
  test("mails one user and logs broadcast_test:<id>; the real send still reaches them", async () => {
    await seedUsers(2);
    const { deps } = makeDeps();
    const to = { id: "u01", name: "Orang 01", email: "u01@test.id" };
    const result = await sendBroadcastTest(deps, CAMPAIGN, to);
    expect(result).toEqual({ ok: true, logged: true });
    expect(outbox).toHaveLength(1);
    const rows = await logRows("broadcast_test:test-campaign");
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.ref).startsWith("u01:")).toBe(true);
    expect(await logRows("broadcast:test-campaign")).toHaveLength(0);

    await sendBroadcastTest(deps, CAMPAIGN, to);
    expect(await logRows("broadcast_test:test-campaign")).toHaveLength(2);

    const full = await sendBroadcast(deps, CAMPAIGN, 2);
    expect(full.batch.sent).toBe(2);
  });

  test("a failed test send reports the error and logs nothing", async () => {
    await seedUsers(1);
    const { deps } = makeDeps();
    sendHook = () => {
      throw new Error("nope");
    };
    const result = await sendBroadcastTest(deps, CAMPAIGN, { id: "u00", name: "x", email: "u00@test.id" });
    expect(result).toMatchObject({ ok: false, logged: false });
    expect(await logRows("broadcast_test:test-campaign")).toHaveLength(0);
  });
});

describe("broadcast routes", () => {
  const ADMIN = "admin@test.id";

  function build(key: string | null = "k") {
    const { deps } = makeDeps();
    const app = new Hono();
    registerBroadcastRoutes(app, {
      adminEmails: ADMIN,
      getDb: () => db,
      createAuth: async () => ({ api: { getSession: async () => ({ user: { id: "adm", name: "Admin Satu", email: ADMIN } }) } }) as never,
      broadcast: () => deps,
      key: key ?? undefined,
    });
    return app;
  }
  const post = (app: Hono, path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  beforeEach(async () => {
    await seedUsers(2, [`('adm', 'Admin Satu', '${ADMIN}', 1, 1)`]);
  });

  test("the CLI routes need the key; the test goes to an admin inbox only and is logged", async () => {
    const app = build();
    expect((await post(app, "/ai/broadcast/test", {})).status).toBe(404);
    expect((await app.request("/ai/broadcast/status")).status).toBe(404);
    expect((await post(build(null), "/ai/broadcast/test", {}, { "X-Broadcast-Key": "k" })).status).toBe(404);

    expect((await post(app, "/ai/broadcast/test", { to: "u00@test.id" }, { "X-Broadcast-Key": "k" })).status).toBe(403);
    expect(outbox).toHaveLength(0);

    const ok = await post(app, "/ai/broadcast/test", {}, { "X-Broadcast-Key": "k" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ to: ADMIN, ok: true, logged: true });
    expect(outbox.map((m) => m.to)).toEqual([ADMIN]);
    expect(outbox[0]!.subject).toBe(DEFAULT_CAMPAIGN.subject);
    expect(await logRows(`broadcast_test:${DEFAULT_CAMPAIGN.id}`)).toHaveLength(1);

    const status = await app.request("/ai/broadcast/status", { headers: { "X-Broadcast-Key": "k" } });
    expect(await status.json()).toMatchObject({ state: "idle", eligible: 3, remaining: 3, sent: 0 });
  });

  test("console: preview renders, test mails the signed-in admin, send checks the confirmed count", async () => {
    const app = build();
    const preview = await post(app, "/api/admin/broadcast/preview", { subject: "S", body: "Halo {nama}" });
    expect(((await preview.json()) as { text: string }).text).toContain("Halo Admin");

    expect((await post(app, "/api/admin/broadcast/test", { ...CAMPAIGN, id: "BAD ID" })).status).toBe(400);
    expect((await post(app, "/api/admin/broadcast/test", { ...CAMPAIGN, subject: " " })).status).toBe(400);
    const test = await post(app, "/api/admin/broadcast/test", CAMPAIGN);
    expect(test.status).toBe(200);
    expect(outbox.map((m) => m.to)).toEqual([ADMIN]);

    const wrong = await post(app, "/api/admin/broadcast/send", { ...CAMPAIGN, expected: 2 });
    expect(wrong.status).toBe(409);
    expect(await wrong.json()).toMatchObject({ current: 3 });
    expect(outbox).toHaveLength(1);

    const sent = await post(app, "/api/admin/broadcast/send", { ...CAMPAIGN, expected: 3 });
    expect(sent.status).toBe(200);
    expect(await sent.json()).toMatchObject({ batch: { sent: 3 }, status: { state: "done", sent: 3, remaining: 0 } });
    expect(outbox).toHaveLength(4);

    const status = await app.request(`/api/admin/broadcast/status?id=${CAMPAIGN.id}`);
    expect(await status.json()).toMatchObject({ state: "done", sent: 3 });
  });
});
