import { and, desc, eq, ne, sql } from "drizzle-orm";
import { appRouter } from "@joyorogo/api/routers/index";
import {
  effectiveRamadan,
  jakartaToday,
  shiftDate,
  streakFromDates,
} from "@joyorogo/api/lib/engine";
import { dueReminders, isFastingPattern, wibDateKey, wibMinutes } from "@joyorogo/api/lib/fasting";
import { pendingStickerKey } from "@joyorogo/api/lib/sticker";
import { buildPlan, planQueries } from "@joyorogo/api/lib/plan";
import { sendPush, vapidConfigured } from "@joyorogo/api/lib/webpush";
import { paywallConfig } from "@joyorogo/api/lib/tiers";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono, type Context as HonoContext } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import {
  exerciseLog as exerciseLogTable,
  foodLog as foodLogTable,
  profile as profileTable,
  weightLog as weightLogTable,
} from "@joyorogo/db/schema/fitness";
import { pushSubscription as pushSubscriptionTable } from "@joyorogo/db/schema/plans";
import { post as postTable } from "@joyorogo/db/schema/social";

import { registerAnonScanRoutes } from "./anon";
import { registerBillingRoutes } from "./billing";
import { registerGooglePlayRoutes } from "./google-billing";
import { registerAdminRoutes } from "./admin";
import { sendEmail } from "./email";
import { createContext } from "./context";
import { registerBenchRoutes } from "./bench";
import { registerOgRoutes } from "./og";
import { registerPrivacyRoutes } from "./privacy";
import { registerStravaRoutes } from "./strava";
import { scrubExpiredStravaRows } from "@joyorogo/api/lib/strava-retention";
import { env } from "./env.server";
import { createAuth, getDb } from "./services";

const app = new Hono();

// CORS_ORIGIN accepts a comma-separated list: local + deployed web app
// Empty in single-worker deploys (apps/selfhost): same-origin needs no CORS.
const allowedOrigins = env.CORS_ORIGIN.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(logger());
app.use(
  "/*",
  cors({
    origin: allowedOrigins,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

// Minimal link-preview data for the web Worker's HTMLRewriter (apps/web/worker).
registerOgRoutes(app, { getDb });

// Anonymous landing-page scans (after CORS so browsers can read responses).
registerAnonScanRoutes(app, {
  ai: env.AI,
  getDb,
  model: env.AI_VISION_MODEL || undefined,
  anonScans: paywallConfig(env).anonScans,
});

// Public config, Founder checkout (DOKU/Pakasir) + webhooks, personal AI usage.
// After CORS so web can read errors.
const billing = registerBillingRoutes(app, { env, getDb, createAuth });

// Google Play Billing (Play build Pro subscription) + its Pub/Sub notifications.
registerGooglePlayRoutes(app, { env, getDb, createAuth });

// Operator console API for admin.joyorogo.com (ADMIN_EMAILS allowlist).
registerAdminRoutes(app, {
  adminEmails: env.ADMIN_EMAILS,
  getDb,
  createAuth,
  getBucket: () => ("STICKERS" in env ? env.STICKERS : undefined),
  reconcileById: billing.reconcileById,
  sendTestEmail: (to) =>
    sendEmail(env, {
      to,
      subject: "Tes email JoyoRogo",
      html: "<p>Email dari JoyoRogo berhasil terkirim.</p>",
      text: "Email dari JoyoRogo berhasil terkirim.",
    }),
});

// Blind accuracy benchmark — gated by the AI_BENCH_KEY secret.
registerBenchRoutes(app, {
  ai: env.AI,
  benchKey:
    "AI_BENCH_KEY" in env && typeof env.AI_BENCH_KEY === "string" ? env.AI_BENCH_KEY : undefined,
  model: env.AI_VISION_MODEL || undefined,
});

// Release APK download — served straight from the R2 bucket so the link
// survives rebuilds (re-upload the object, same URL).
app.get("/downloads/latest-apk", async (c) => {
  if (!("DOWNLOADS" in env) || !env.DOWNLOADS) {
    return c.json({ error: "Download belum tersedia." }, 404);
  }
  const obj = await env.DOWNLOADS.get("joyorogo-latest.apk");
  if (!obj) {
    return c.json({ error: "Download belum tersedia." }, 404);
  }
  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Length": String(obj.size),
      "Content-Disposition": 'attachment; filename="joyorogo-release.apk"',
    },
  });
});

// Update manifest for the Android in-app updater: versionCode + checksum of
// joyorogo-latest.apk. Short cache so an update shows up within minutes.
app.get("/downloads/latest-apk.json", async (c) => {
  if (!("DOWNLOADS" in env) || !env.DOWNLOADS) {
    return c.json({ error: "Download belum tersedia." }, 404);
  }
  const obj = await env.DOWNLOADS.get("joyorogo-latest.json");
  if (!obj) {
    return c.json({ error: "Download belum tersedia." }, 404);
  }
  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
});

// Dish sticker cutouts (scans/<id>.png). The 32-hex scan id is the capability:
// unguessable, immutable, safe to cache — no session needed for <img> sources.
app.get("/sticker/:scanId", async (c) => {
  const scanId = c.req.param("scanId");
  if (!/^[a-f0-9]{32}$/.test(scanId)) {
    return c.json({ error: "ID tidak valid." }, 400);
  }
  if (!("STICKERS" in env) || !env.STICKERS) {
    return c.json({ error: "Stiker belum tersedia." }, 404);
  }
  // Saved diary stickers first; during review the cutout still sits under the
  // expiring scan-src/ prefix until food.addScan promotes it.
  const obj =
    (await env.STICKERS.get(`scans/${scanId}.png`)) ??
    (await env.STICKERS.get(pendingStickerKey(scanId)));
  if (!obj) {
    return c.json({ error: "Stiker tidak ditemukan." }, 404);
  }
  return new Response(obj.body, {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(obj.size),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});

// Original scan photos (photos/<userId>/<id>.jpg). Unlike stickers these are
// private: the session picks the prefix, so an id from someone else's diary
// resolves to nothing.
app.get("/photo/:photoId", async (c) => {
  const photoId = c.req.param("photoId");
  if (!/^[a-f0-9]{32}$/.test(photoId)) {
    return c.json({ error: "ID tidak valid." }, 400);
  }
  const session = await (await createAuth()).api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) {
    return c.json({ error: "Kamu harus masuk dulu." }, 401);
  }
  if (!("STICKERS" in env) || !env.STICKERS) {
    return c.json({ error: "Foto belum tersedia." }, 404);
  }
  const obj = await env.STICKERS.get(`photos/${session.user.id}/${photoId}.jpg`);
  if (!obj) {
    return c.json({ error: "Foto tidak ditemukan." }, 404);
  }
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "image/jpeg",
      "Content-Length": String(obj.size),
      "Cache-Control": "private, max-age=86400",
    },
  });
});

// VAR perut photos (var/<userId>/<id>.jpg) — the most sensitive media in the
// app. Owner-only: the session picks the prefix exactly like /photo does, so
// even a guessed id from a teammate resolves to nothing. Sharing a verdict
// never exposes this route; the photo only ever renders for its owner.
app.get("/var-photo/:photoId", async (c) => {
  const photoId = c.req.param("photoId");
  if (!/^[a-f0-9]{32}$/.test(photoId)) {
    return c.json({ error: "ID tidak valid." }, 400);
  }
  const session = await (await createAuth()).api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) {
    return c.json({ error: "Kamu harus masuk dulu." }, 401);
  }
  if (!("STICKERS" in env) || !env.STICKERS) {
    return c.json({ error: "Foto belum tersedia." }, 404);
  }
  const obj = await env.STICKERS.get(`var/${session.user.id}/${photoId}.jpg`);
  if (!obj) {
    return c.json({ error: "Foto tidak ditemukan." }, 404);
  }
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "image/jpeg",
      "Content-Length": String(obj.size),
      "Cache-Control": "private, no-store",
    },
  });
});

// Photos of a shared feed post. Access follows the post's visibility, not the
// viewer's own prefix: 'publik' posts on a public profile serve without login
// (cacheable), 'grup' posts need a teammate session (private). Deleted/hidden
// posts stop resolving within an hour.
//   /post-photo/:postId          -> legacy single photo (makan snapshot), or cerita photo 0
//   /post-photo/:postId/:index   -> cerita photo grid (posts/<authorId>/<id>.jpg)
async function servePostPhoto(c: HonoContext, indexParam: string | undefined) {
  const postId = c.req.param("postId") ?? "";
  if (!/^[a-f0-9-]{36}$/.test(postId)) {
    return c.json({ error: "ID tidak valid." }, 400);
  }
  if (!("STICKERS" in env) || !env.STICKERS) {
    return c.json({ error: "Foto belum tersedia." }, 404);
  }
  let index: number | null = null;
  if (indexParam !== undefined) {
    index = Number(indexParam);
    if (!Number.isInteger(index) || index < 0 || index > 3) {
      return c.json({ error: "Indeks foto tidak valid." }, 400);
    }
  }
  const [row] = await getDb()
    .select({
      userId: postTable.userId,
      photoId: postTable.photoId,
      photosJson: postTable.photosJson,
      visibility: postTable.visibility,
      authorPublic: profileTable.publicProfile,
    })
    .from(postTable)
    .innerJoin(profileTable, eq(profileTable.userId, postTable.userId))
    .where(eq(postTable.id, postId))
    .limit(1);
  if (!row) {
    return c.json({ error: "Foto tidak ditemukan." }, 404);
  }
  let photos: string[] = [];
  if (row.photosJson) {
    try {
      const parsed = JSON.parse(row.photosJson) as unknown;
      if (Array.isArray(parsed)) photos = parsed.filter((x): x is string => typeof x === "string");
    } catch {
      // foto tidak lagi bisa dirender; jatuh ke photoId warisan di bawah
    }
  }
  const photoId =
    index !== null ? (photos[index] ?? null) : (row.photoId ?? photos[0] ?? null);
  if (!photoId) {
    return c.json({ error: "Foto tidak ditemukan." }, 404);
  }
  const key = photos.includes(photoId)
    ? `posts/${row.userId}/${photoId}.jpg`
    : `photos/${row.userId}/${photoId}.jpg`;
  const isPublic = row.visibility === "publik" && row.authorPublic;
  if (!isPublic) {
    const session = await (await createAuth()).api.getSession({ headers: c.req.raw.headers });
    if (!session?.user) return c.json({ error: "Kamu harus masuk dulu." }, 401);
    if (session.user.id !== row.userId) {
      const db = getDb();
      const notFound = c.json({ error: "Foto tidak ditemukan." }, 404);
      const [blocked] = await db
        .select({ total: sql<number>`count(*)` })
        .from(sql`social_block b`)
        .where(
          sql`(b.blocker_id = ${session.user.id} AND b.blocked_id = ${row.userId})
            OR (b.blocker_id = ${row.userId} AND b.blocked_id = ${session.user.id})`,
        );
      if ((blocked?.total ?? 0) > 0) return notFound;
      if (row.visibility !== "grup") return notFound;
      const [mate] = await db
        .select({ total: sql<number>`count(*)` })
        .from(sql`team_member tm1`)
        .innerJoin(sql`team_member tm2`, sql`tm1.team_id = tm2.team_id`)
        .where(sql`tm1.user_id = ${session.user.id} AND tm2.user_id = ${row.userId}`);
      if ((mate?.total ?? 0) === 0) return notFound;
    }
  }
  const obj = await env.STICKERS.get(key);
  if (!obj) {
    return c.json({ error: "Foto tidak ditemukan." }, 404);
  }
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "image/jpeg",
      "Content-Length": String(obj.size),
      "Cache-Control": isPublic ? "public, max-age=3600" : "private, max-age=3600",
    },
  });
}

app.get("/post-photo/:postId/:index", (c) => {
  const index = c.req.param("index");
  return servePostPhoto(c, typeof index === "string" ? index : undefined);
});
app.get("/post-photo/:postId", (c) => servePostPhoto(c, undefined));

// Public profile avatars (avatars/<userId>/<id>.<ext>). No session on purpose:
// the 32-hex id is the unguessable capability, and the URL rides in public
// feeds and profiles. Immutable — every upload mints a new id, so responses
// can cache forever.
app.get("/avatar/:userId/:file", async (c) => {
  const userId = c.req.param("userId");
  const file = c.req.param("file");
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(userId) || !/^[0-9a-f]{32}\.(jpg|png|webp)$/.test(file)) {
    return c.json({ error: "URL tidak valid." }, 400);
  }
  if (!("STICKERS" in env) || !env.STICKERS) {
    return c.json({ error: "Foto belum tersedia." }, 404);
  }
  const obj = await env.STICKERS.get(`avatars/${userId}/${file}`);
  if (!obj) {
    return c.json({ error: "Foto tidak ditemukan." }, 404);
  }
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "image/jpeg",
      "Content-Length": String(obj.size),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});

// Personal-data wipe (profil + /privasi). After CORS so web can read errors.
registerPrivacyRoutes(app, {
  getDb,
  strava: env,
  createAuth,
  stickers: () => ("STICKERS" in env ? env.STICKERS : undefined),
});

// JoyoFit's Worker reads and writes the shared Strava grant here (Basic auth with the Strava client credentials).
registerStravaRoutes(app, { env, getDb });

// The Android app only knows the API origin; send its "Kebijakan privasi"
// link on to the web page.
app.get("/privasi", (c) =>
  c.redirect(`${(env.APP_URL || env.BETTER_AUTH_URL).replace(/\/$/, "")}/privasi`),
);

// Opt-in public progress page — the shareable link (/u/<code>).
// Renders BEFORE the auth/rpc middleware; read-only, no session needed.
app.get("/u/:code", async (c) => {
  const code = c.req.param("code");
  const db = await getDb();
  const [row] = await db
    .select()
    .from(profileTable)
    .where(and(eq(profileTable.shareCode, code), eq(profileTable.shareEnabled, true)))
    .limit(1);
  if (!row) {
    return c.html(
      `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>JoyoRogo</title>` +
        `<meta name="robots" content="noindex"></head><body style="font-family:Inter,system-ui,sans-serif;background:#0d1f12;color:#fff;display:grid;place-items:center;height:100vh;margin:0"><p>Halaman ini tidak tersedia.</p></body></html>`,
    );
  }
  const [weighed] = await db
    .select({ latest: weightLogTable.weightKg })
    .from(weightLogTable)
    .where(eq(weightLogTable.userId, row.userId))
    .orderBy(desc(weightLogTable.date))
    .limit(1);
  const today = jakartaToday();
  const weekStart = shiftDate(today, -6);
  const [foodDates, weightDates, burnedWeek] = await Promise.all([
    db
      .selectDistinct({ date: foodLogTable.date })
      .from(foodLogTable)
      .where(
        and(
          eq(foodLogTable.userId, row.userId),
          sql`${foodLogTable.date} >= ${shiftDate(today, -45)}`,
        ),
      ),
    db
      .selectDistinct({ date: weightLogTable.date })
      .from(weightLogTable)
      .where(
        and(
          eq(weightLogTable.userId, row.userId),
          sql`${weightLogTable.date} >= ${shiftDate(today, -45)}`,
        ),
      ),
    db
      .select({ total: sql<number | null>`sum(${exerciseLogTable.kcal})` })
      .from(exerciseLogTable)
      .where(
        and(eq(exerciseLogTable.userId, row.userId), sql`${exerciseLogTable.date} >= ${weekStart}`),
      ),
  ]);
  // Same streak semantics as day.summary: any food or weight entry per WIB day.
  const streakDays = streakFromDates(
    [...foodDates.map((r) => r.date), ...weightDates.map((r) => r.date)],
    today,
  );
  const geprek = Math.floor((burnedWeek[0]?.total ?? 0) / 600);
  const lost = Math.round((row.startWeightKg - (weighed?.latest ?? row.startWeightKg)) * 10) / 10;
  const title =
    lost > 0
      ? `Aku sudah turun ${lost.toLocaleString("id-ID")} kg dengan JoyoRogo`
      : "Aku lagi diet bareng JoyoRogo";
  const description = `Tiga angka tiap hari: boleh makan, harus bakar, butuh tidur. Foto makanan, AI yang hitung.`;
  return c.html(
    `<!doctype html><html lang="id"><head><meta charset="utf-8">` +
      `<meta property="og:title" content="${title}">` +
      `<meta property="og:description" content="${description}">` +
      `<meta name="twitter:card" content="summary">` +
      `<title>${title}</title><meta name="description" content="${description}">` +
      `<meta name="robots" content="noindex">` +
      `<style>body{font-family:Inter,system-ui,sans-serif;background:linear-gradient(160deg,#0d1f12,#123420);color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:2rem}main{max-width:26rem}.brand{letter-spacing:.14em;text-transform:uppercase;font-size:.75rem;color:#7fd89b;margin:0 0 1rem}h1{font-size:1.9rem;margin:0 0 .75rem;line-height:1.25}p{color:#c9dccf;margin:.35rem 0}a{display:inline-block;margin-top:1.5rem;background:#2e7d46;color:#fff;padding:.8rem 1.6rem;border-radius:9999px;text-decoration:none;font-weight:600}</style></head><body><main>` +
      `<p class="brand">JoyoRogo</p><h1>${title}</h1>` +
      (lost > 0
        ? `<p>Berat awal ${row.startWeightKg.toLocaleString("id-ID")} kg → sekarang ${(weighed?.latest ?? row.startWeightKg).toLocaleString("id-ID")} kg</p>`
        : `<p>Baru mulai perjalanan dietnya.</p>`) +
      `<p>Streak ${streakDays} hari</p>` +
      `<p>≈ ${geprek} geprek dibakar minggu ini</p>` +
      `<p>Tiga angka tiap hari: boleh makan, harus bakar, butuh tidur.</p>` +
      `<a href="${(env.APP_URL || env.BETTER_AUTH_URL).replace(/\/$/, "")}/login">Coba JoyoRogo</a></main></body></html>`,
  );
});

app.on(["POST", "GET"], "/api/auth/*", async (c) => (await createAuth()).handler(c.req.raw));

export const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

export const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

app.use("/*", async (c, next) => {
  const context = await createContext({ context: c });

  const rpcResult = await rpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context: context,
  });

  if (rpcResult.matched) {
    return c.newResponse(rpcResult.response.body, rpcResult.response);
  }

  const apiResult = await apiHandler.handle(c.req.raw, {
    prefix: "/api-reference",
    context: context,
  });

  if (apiResult.matched) {
    return c.newResponse(apiResult.response.body, apiResult.response);
  }

  await next();
});

app.get("/", (c) => {
  return c.text("OK");
});

// --- Puasa intermiten: Web Push reminders ------------------------------------
// Cron (*/5 * * * *): every subscribed device with fastingNotify on gets the
// window-open / next-meal / 30-minutes-to-close nudge exactly once, deduped
// through lastSentKey. Dead endpoints (404/410) are deleted on the spot.

async function runFastingReminders(): Promise<void> {
  if (!vapidConfigured(env)) return;
  const db = getDb();
  const now = new Date();
  const dateKey = wibDateKey(now);
  const today = jakartaToday();
  const rows = await db
    .select({
      id: pushSubscriptionTable.id,
      userId: pushSubscriptionTable.userId,
      endpoint: pushSubscriptionTable.endpoint,
      p256dh: pushSubscriptionTable.p256dh,
      auth: pushSubscriptionTable.auth,
      lastSentKey: pushSubscriptionTable.lastSentKey,
      pattern: profileTable.fastingPattern,
      windowStart: profileTable.fastingWindowStart,
      ramadanMode: profileTable.ramadanMode,
    })
    .from(pushSubscriptionTable)
    .innerJoin(profileTable, eq(profileTable.userId, pushSubscriptionTable.userId))
    .where(and(eq(profileTable.fastingNotify, true), ne(profileTable.fastingPattern, "off")));

  for (const row of rows) {
    if (!isFastingPattern(row.pattern)) continue;
    // Ramadan owns the schedule while it lasts — its flow has no Web Push.
    if (effectiveRamadan(row.ramadanMode, now)) continue;

    // Same eat budget the day summary shows (formula → measured TDEE).
    const [profRows, latest, weighIns, intake, exercise] = await db.batch(
      planQueries(db, row.userId, today),
    );
    const profRow = profRows[0];
    if (!profRow) continue;
    const plan = buildPlan(
      profRow,
      { latestWeightKg: latest[0]?.weightKg ?? null, weighIns, intake, exercise },
      today,
    );
    const [eatenRow] = await db
      .select({ kcal: sql<number | null>`sum(${foodLogTable.kcal})` })
      .from(foodLogTable)
      .where(and(eq(foodLogTable.userId, row.userId), eq(foodLogTable.date, today)));

    const due = dueReminders({
      pattern: row.pattern,
      windowStart: row.windowStart,
      dateKey,
      remainingKcal: Math.max(0, plan.targets.eatKcal - (eatenRow?.kcal ?? 0)),
      nowMin: wibMinutes(now),
    });
    for (const draft of due) {
      if (row.lastSentKey === draft.key) continue;
      const result = await sendPush(
        env,
        { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
        { title: draft.title, body: draft.body },
      );
      if (result.status === 404 || result.status === 410) {
        await db.delete(pushSubscriptionTable).where(eq(pushSubscriptionTable.id, row.id));
        break;
      }
      if (result.ok) {
        await db
          .update(pushSubscriptionTable)
          .set({ lastSentKey: draft.key })
          .where(eq(pushSubscriptionTable.id, row.id));
      }
    }
  }
}

// Strava API Policy 6.2: imported Strava activities live at most 7 days (lib/strava-retention). The cron runs this
// every tick (*/5): the delete matches nothing almost always, so it only reads the rows it checks.
async function runStravaRetention(): Promise<void> {
  const deleted = await scrubExpiredStravaRows(getDb());
  if (deleted > 0) console.log(`strava retention: deleted ${deleted} expired rows`);
}

// Same Hono app as fetch; the scheduled handler runs beside it. `app.fetch`
// is an arrow property, so detaching it stays bound to this app instance.
export default {
  fetch: app.fetch,
  scheduled: (_controller: ScheduledController, _env2: unknown, ctx: ExecutionContext) => {
    ctx.waitUntil(runFastingReminders());
    ctx.waitUntil(billing.reconcilePending());
    ctx.waitUntil(billing.runEmails());
    ctx.waitUntil(runStravaRetention());
  },
};
