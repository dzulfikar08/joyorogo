import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { parseStoredAttachment } from "@joyorogo/api/lib/comment-attachment";
import { serverT } from "@joyorogo/api/lib/messages";
import { appRouter } from "@joyorogo/api/routers/index";
import { DEFAULT_DAY_ZONE, LOCALE_HEADER, isLocale } from "@joyorogo/i18n";
import { effectiveRamadan, jakartaToday, shiftDate } from "@joyorogo/api/lib/engine";
import { dueReminders, isFastingPattern, wibDateKey, wibMinutes } from "@joyorogo/api/lib/fasting";
import { commentPhotoKey, pendingStickerKey } from "@joyorogo/api/lib/sticker";
import { loadUserStreak } from "@joyorogo/api/lib/streak-store";
import { isGainGap } from "@joyorogo/api/lib/gain";
import { readCalibrationPrefs } from "@joyorogo/api/lib/calibration-store";
import { buildPlan, gainedKg, planQueries } from "@joyorogo/api/lib/plan";
import { budgetKcal } from "@joyorogo/api/lib/exercise-credit";
import { loadDayCredit } from "@joyorogo/api/lib/exercise-credit-store";
import { sendPush, vapidConfigured } from "@joyorogo/api/lib/webpush";
import { runPushCron } from "@joyorogo/api/lib/push-cron";
import { paywallConfig } from "@joyorogo/api/lib/tiers";
import { zoneOfUser, zonesOfUsers } from "@joyorogo/api/lib/user-zone";
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
import { post as postTable, postComment } from "@joyorogo/db/schema/social";

import { registerAnonScanRoutes } from "./anon";
import { registerBillingRoutes } from "./billing";
import { registerGooglePlayRoutes } from "./google-billing";
import { registerAdminRoutes } from "./admin";
import { dailyAccuracyDue, runDailyAccuracy } from "./accuracy-job";
import { registerAccuracyRoutes } from "./accuracy-routes";
import { runBroadcastTick } from "./broadcast";
import type { BroadcastDeps } from "./broadcast";
import { registerBroadcastRoutes } from "./broadcast-routes";
import { sendEmail } from "./email";
import { createContext, requestLocale } from "./context";
import { registerBenchRoutes } from "./bench";
import { registerDatasetExportRoutes } from "./dataset-export";
import { androidAppHandoff } from "./app-handoff";
import { registerMcpPublicCors, registerMcpRoutes } from "./mcp";
import type { McpEnv } from "./mcp";
import { registerOgRoutes } from "./og";
import { registerPrivacyRoutes } from "./privacy";
import { registerFamilyRoutes } from "./family";
import { registerCorosRoutes } from "./coros";
import { registerStravaRoutes } from "./strava";
import { registerThreadsBotRoutes, runThreadsBotTick } from "./threads-bot";
import {
  runTestflightNoticeSweep,
  sendTestflightNotice,
  testflightNoticeConfig,
} from "./testflight-notice";
import { registerUnsubscribeRoutes } from "./unsubscribe";
import { registerFitProxy } from "./fit-proxy";
import { registerWatchWorkoutRoutes } from "./watch-workout";
import { sweepMcp } from "@joyorogo/api/lib/mcp-connections";
import { botConfig } from "@joyorogo/api/lib/threads-bot/config";
import { analyzeFoodPhoto } from "@joyorogo/api/lib/vision";
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
// Open CORS (no cookies) for the endpoints MCP clients call from a browser; before the credentialed CORS below.
registerMcpPublicCors(app);
// PUT and DELETE: the JoyoFit web app (docs/fit-web.md) uploads workout documents with PUT /api/watch-workouts/:start and deletes
// watch faces with DELETE /api/fit/watchfaces/:id from the browser.
app.use(
  "/*",
  cors({
    origin: allowedOrigins,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", LOCALE_HEADER],
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

// Announcement mail needs the STICKERS bucket (opt-outs, campaign state; no D1 table); without it
// the broadcast routes answer 503 and the TestFlight notice stays off.
const broadcastDeps = (): BroadcastDeps | undefined =>
  "STICKERS" in env
    ? {
        db: getDb(),
        bucket: env.STICKERS,
        email: env.EMAIL,
        secret: env.BETTER_AUTH_SECRET,
        baseUrl: env.BETTER_AUTH_URL,
      }
    : undefined;

// One mail per TestFlight (Sandbox) buyer; TESTFLIGHT_PURCHASE_EMAIL=on enables it (docs/pricing.md).
const testflightNotice = testflightNoticeConfig(env);

// Public config, Founder checkout (DOKU/Pakasir) + webhooks, personal AI usage.
// After CORS so web can read errors.
const billing = registerBillingRoutes(app, {
  env,
  getDb,
  createAuth,
  onSandboxGrant: async (userId) => {
    const broadcast = broadcastDeps();
    if (broadcast) await sendTestflightNotice(broadcast, testflightNotice, userId);
  },
});

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

// Threads mention bot (docs/threads-bot.md): Meta's webhook + OAuth redirect, and the review queue behind the admin gate above.
// Photo scans use the same analyzeFoodPhoto as the app, on the image held in memory; nothing about the photo is stored.
const threadsBot = {
  getDb,
  config: () => botConfig(env),
  scan: (image: { imageBase64: string; mimeType: string }) =>
    analyzeFoodPhoto(env.AI, { ...image, model: env.AI_VISION_MODEL || undefined }),
  createAuth,
  stateSecret: env.BETTER_AUTH_SECRET,
};
registerThreadsBotRoutes(app, threadsBot);

// Announcement mail: console endpoints behind the admin gate above, key-gated CLI test/status
// (BROADCAST_KEY), and the public unsubscribe page the mails link to.
registerBroadcastRoutes(app, {
  adminEmails: env.ADMIN_EMAILS,
  getDb,
  createAuth,
  broadcast: broadcastDeps,
  key:
    "BROADCAST_KEY" in env && typeof env.BROADCAST_KEY === "string" ? env.BROADCAST_KEY : undefined,
});
registerUnsubscribeRoutes(app, {
  secret: env.BETTER_AUTH_SECRET,
  getBucket: () => ("STICKERS" in env ? env.STICKERS : undefined),
});

// Blind accuracy benchmark — gated by the AI_BENCH_KEY secret.
registerBenchRoutes(app, {
  ai: env.AI,
  benchKey:
    "AI_BENCH_KEY" in env && typeof env.AI_BENCH_KEY === "string" ? env.AI_BENCH_KEY : undefined,
  model: env.AI_VISION_MODEL || undefined,
});

// Owner dataset export (R2 dataset/ prefix), same key gate.
registerDatasetExportRoutes(app, {
  getBucket: () => ("STICKERS" in env ? env.STICKERS : undefined),
  key: "AI_BENCH_KEY" in env && typeof env.AI_BENCH_KEY === "string" ? env.AI_BENCH_KEY : undefined,
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
    return c.json({ error: serverT(requestLocale(c), "errors")("auth.signInRequired") }, 401);
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
    return c.json({ error: serverT(requestLocale(c), "errors")("auth.signInRequired") }, 401);
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

// "Piring saya" registration photos (dishware/<userId>/<id>.jpg). Private to the owner: the session
// picks the prefix, so another user's id resolves to nothing.
app.get("/dishware-photo/:photoId", async (c) => {
  const photoId = c.req.param("photoId");
  if (!/^[a-f0-9]{32}$/.test(photoId)) {
    return c.json({ error: "ID tidak valid." }, 400);
  }
  const session = await (await createAuth()).api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) {
    return c.json({ error: serverT(requestLocale(c), "errors")("auth.signInRequired") }, 401);
  }
  if (!("STICKERS" in env) || !env.STICKERS) {
    return c.json({ error: "Foto belum tersedia." }, 404);
  }
  const obj = await env.STICKERS.get(`dishware/${session.user.id}/${photoId}.jpg`);
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
  const photoId = index !== null ? (photos[index] ?? null) : (row.photoId ?? photos[0] ?? null);
  if (!photoId) {
    return c.json({ error: "Foto tidak ditemukan." }, 404);
  }
  const key = photos.includes(photoId)
    ? `posts/${row.userId}/${photoId}.jpg`
    : `photos/${row.userId}/${photoId}.jpg`;
  return serveSharedPhoto(c, {
    key,
    postAuthorId: row.userId,
    visibility: row.visibility,
    authorPublic: row.authorPublic,
    owners: [row.userId],
  });
}

/**
 * One object of a shared post under that post's visibility rules. `owners` are the accounts whose data the object is
 * (the post's author, plus the commenter for a comment photo): an owner always sees it, anyone else needs a public
 * post on a public profile, or a teammate session for a 'grup' post and no block with any owner.
 */
async function serveSharedPhoto(
  c: HonoContext,
  photo: {
    key: string;
    postAuthorId: string;
    visibility: "publik" | "grup";
    authorPublic: boolean;
    owners: string[];
  },
) {
  if (!("STICKERS" in env) || !env.STICKERS) {
    return c.json({ error: "Foto belum tersedia." }, 404);
  }
  const isPublic = photo.visibility === "publik" && photo.authorPublic;
  if (!isPublic) {
    const session = await (await createAuth()).api.getSession({ headers: c.req.raw.headers });
    if (!session?.user) {
      return c.json({ error: serverT(requestLocale(c), "errors")("auth.signInRequired") }, 401);
    }
    const viewerId = session.user.id;
    if (!photo.owners.includes(viewerId)) {
      const db = getDb();
      const notFound = c.json({ error: "Foto tidak ditemukan." }, 404);
      for (const owner of photo.owners) {
        const [blocked] = await db
          .select({ total: sql<number>`count(*)` })
          .from(sql`social_block b`)
          .where(
            sql`(b.blocker_id = ${viewerId} AND b.blocked_id = ${owner})
              OR (b.blocker_id = ${owner} AND b.blocked_id = ${viewerId})`,
          );
        if ((blocked?.total ?? 0) > 0) return notFound;
      }
      if (photo.visibility !== "grup") return notFound;
      const [mate] = await db
        .select({ total: sql<number>`count(*)` })
        .from(sql`team_member tm1`)
        .innerJoin(sql`team_member tm2`, sql`tm1.team_id = tm2.team_id`)
        .where(sql`tm1.user_id = ${viewerId} AND tm2.user_id = ${photo.postAuthorId}`);
      if ((mate?.total ?? 0) === 0) return notFound;
    }
  }
  const obj = await env.STICKERS.get(photo.key);
  if (!obj) {
    return c.json({ error: "Foto tidak ditemukan." }, 404);
  }
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "image/jpeg",
      "Content-Length": String(obj.size),
      "Cache-Control": isPublic ? "public, max-age=3600" : "private, max-age=3600",
      // Stored bytes are only ever shown as the picture they are.
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}

app.get("/post-photo/:postId/:index", (c) => {
  const index = c.req.param("index");
  return servePostPhoto(c, typeof index === "string" ? index : undefined);
});
app.get("/post-photo/:postId", (c) => servePostPhoto(c, undefined));

// The photo of a comment attachment (an uploaded image, or the metadata-free copy made of an attached meal's photo; the
// private diary original is never served here), under the visibility of
// the post the comment sits on. A hidden ("komentar dihapus") comment has no attachment, so it stops resolving.
app.get("/comment-photo/:commentId", async (c) => {
  const commentId = c.req.param("commentId");
  if (!/^[a-f0-9-]{36}$/.test(commentId)) {
    return c.json({ error: "ID tidak valid." }, 400);
  }
  const [row] = await getDb()
    .select({
      commenterId: postComment.userId,
      attachmentJson: postComment.attachmentJson,
      postAuthorId: postTable.userId,
      visibility: postTable.visibility,
      authorPublic: profileTable.publicProfile,
    })
    .from(postComment)
    .innerJoin(postTable, eq(postTable.id, postComment.postId))
    .innerJoin(profileTable, eq(profileTable.userId, postTable.userId))
    .where(and(eq(postComment.id, commentId), isNull(postComment.deletedAt)))
    .limit(1);
  const attachment = parseStoredAttachment(row?.attachmentJson ?? null);
  if (!row || !attachment?.photoId || !attachment.hasPhoto) {
    return c.json({ error: "Foto tidak ditemukan." }, 404);
  }
  return serveSharedPhoto(c, {
    key: commentPhotoKey(row.commenterId, attachment.photoId),
    postAuthorId: row.postAuthorId,
    visibility: row.visibility,
    authorPublic: row.authorPublic,
    owners: [row.postAuthorId, row.commenterId],
  });
});

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
  coros: env,
  createAuth,
  stickers: () => ("STICKERS" in env ? env.STICKERS : undefined),
});

// JoyoFit cloud workouts: the gzip document upload (Pro) and download; the rest is oRPC watchWorkout.*.
registerWatchWorkoutRoutes(app, {
  getDb,
  createAuth,
  env,
  bucket: () => ("STICKERS" in env ? env.STICKERS : undefined),
});

// The JoyoFit web app's door to the JoyoFit cloud API (sleep stages, the watch face library): this host holds the session cookie.
registerFitProxy(app, {
  createAuth,
  allowedOrigins,
  baseUrl: () => (env.JOYOFIT_API_URL || "https://api.fit.joyorogo.com").replace(/\/+$/, ""),
});

// MCP connector (docs/mcp-connector.md): Claude / ChatGPT read the account's data at /mcp with an OAuth token from
// /api/auth/oauth2/*. Before the /api/auth/* catch-all so the registration limiter runs first.
registerMcpRoutes(app, {
  env: env as unknown as McpEnv,
  getDb,
  createAuth,
  bucket: () => ("STICKERS" in env ? env.STICKERS : undefined),
});

// JoyoFit's Worker reads and writes the shared Strava grant here (Basic auth with the Strava client credentials).
registerStravaRoutes(app, { env, getDb });
// COROS's OAuth redirect: hands the code on to the web callback page or the app (docs/coros.md).
registerCorosRoutes(app, { getDb, appOrigin: () => env.APP_URL || env.BETTER_AUTH_URL });
// JoyoFit family monitoring asks here for a user's Pro state, name, email and language (same Basic auth).
registerFamilyRoutes(app, { env, getDb });

// The Android app only knows the API origin; send its "Kebijakan privasi"
// link on to the web page (a marketing page: the site origin, not the app's).
app.get("/privasi", (c) =>
  c.redirect(`${(env.SITE_URL || env.APP_URL || env.BETTER_AUTH_URL).replace(/\/$/, "")}/privasi`),
);

// Opt-in public progress page — the shareable link (/u/<code>).
// Renders BEFORE the auth/rpc middleware; read-only, no session needed.
app.get("/u/:code", async (c) => {
  const code = c.req.param("code");
  const db = await getDb();
  const [row] = await db
    .select()
    .from(profileTable)
    .where(
      and(
        eq(profileTable.shareCode, code),
        eq(profileTable.shareEnabled, true),
        // Health data is never published: Hamil / Menyusui profiles have no public page.
        eq(profileTable.maternalMode, "none"),
      ),
    )
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
  const today = jakartaToday(undefined, await zoneOfUser(db, row.userId));
  const weekStart = shiftDate(today, -6);
  const [burnedWeek] = await db
    .select({ total: sql<number | null>`sum(${exerciseLogTable.kcal})` })
    .from(exerciseLogTable)
    .where(
      and(eq(exerciseLogTable.userId, row.userId), sql`${exerciseLogTable.date} >= ${weekStart}`),
    );
  const latestKg = weighed?.latest ?? row.startWeightKg;
  // Naikin BB: "naik X kg", and the streak counts days at 90% of the target (the one streak, lib/streak-store).
  const gaining = row.goal === "gain" && isGainGap(row.targetWeightKg - latestKg);
  const gained = gaining ? gainedKg(row, latestKg) : 0;
  let gainTargetKcal: number | null = null;
  if (gaining) {
    const [, , weighIns, intake, exercise, prefRows] = await db.batch(
      planQueries(db, row.userId, today),
    );
    const plan = buildPlan(
      row,
      {
        latestWeightKg: latestKg,
        weighIns,
        intake,
        exercise,
        prefs: readCalibrationPrefs(prefRows),
      },
      today,
    );
    if (plan.targets.gain) gainTargetKcal = plan.targets.eatKcal;
  }
  const { days: streakDays } = await loadUserStreak(db, row.userId, today, gainTargetKcal);
  const geprek = Math.floor((burnedWeek?.total ?? 0) / 600);
  const lost = Math.round((row.startWeightKg - latestKg) * 10) / 10;
  const title = gaining
    ? gained > 0
      ? `Aku sudah naik ${gained.toLocaleString("id-ID")} kg dengan JoyoRogo`
      : "Aku lagi naikin berat badan bareng JoyoRogo"
    : lost > 0
      ? `Aku sudah turun ${lost.toLocaleString("id-ID")} kg dengan JoyoRogo`
      : "Aku lagi diet bareng JoyoRogo";
  const description = `Tiga angka tiap hari: boleh makan, harus bakar, butuh tidur. Foto makanan, AI yang hitung.`;
  const progress = gaining
    ? gained > 0
      ? `<p>Berat awal ${(row.goalStartKg ?? row.startWeightKg).toLocaleString("id-ID")} kg → sekarang ${latestKg.toLocaleString("id-ID")} kg</p>`
      : `<p>Baru mulai perjalanan naik berat badannya.</p>`
    : lost > 0
      ? `<p>Berat awal ${row.startWeightKg.toLocaleString("id-ID")} kg → sekarang ${latestKg.toLocaleString("id-ID")} kg</p>`
      : `<p>Baru mulai perjalanan dietnya.</p>`;
  return c.html(
    `<!doctype html><html lang="id"><head><meta charset="utf-8">` +
      `<meta property="og:title" content="${title}">` +
      `<meta property="og:description" content="${description}">` +
      `<meta name="twitter:card" content="summary">` +
      `<title>${title}</title><meta name="description" content="${description}">` +
      `<meta name="robots" content="noindex">` +
      `<style>body{font-family:Inter,system-ui,sans-serif;background:linear-gradient(160deg,#0d1f12,#123420);color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:2rem}main{max-width:26rem}.brand{letter-spacing:.14em;text-transform:uppercase;font-size:.75rem;color:#7fd89b;margin:0 0 1rem}h1{font-size:1.9rem;margin:0 0 .75rem;line-height:1.25}p{color:#c9dccf;margin:.35rem 0}a{display:inline-block;margin-top:1.5rem;background:#2e7d46;color:#fff;padding:.8rem 1.6rem;border-radius:9999px;text-decoration:none;font-weight:600}</style></head><body><main>` +
      `<p class="brand">JoyoRogo</p><h1>${title}</h1>` +
      progress +
      `<p>Streak ${streakDays} hari</p>` +
      `<p>≈ ${geprek} geprek dibakar minggu ini</p>` +
      `<p>Tiga angka tiap hari: boleh makan, harus bakar, butuh tidur.</p>` +
      `<a href="${(env.APP_URL || env.BETTER_AUTH_URL).replace(/\/$/, "")}/login">Coba JoyoRogo</a></main></body></html>`,
  );
});

app.on(["POST", "GET"], "/api/auth/*", async (c) => {
  const response = await (await createAuth()).handler(c.req.raw);
  return (await androidAppHandoff(c.req.raw, response, env.BETTER_AUTH_SECRET)) ?? response;
});

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

// --- Push notifications (docs/push.md) ---------------------------------------
// The same tick also runs runPushCron (lib/push-cron): server reminders, the outbox (quiet-hour queue, retries,
// new-post fan-outs), the evening digest and Expo receipts.

// --- Puasa intermiten: Web Push reminders ------------------------------------
// Cron (*/5 * * * *): every subscribed device with fastingNotify on gets the
// window-open / next-meal / 30-minutes-to-close nudge exactly once, deduped
// through lastSentKey. Dead endpoints (404/410) are deleted on the spot.

async function runFastingReminders(): Promise<void> {
  if (!vapidConfigured(env)) return;
  const db = getDb();
  const now = new Date();
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
      locale: profileTable.locale,
    })
    .from(pushSubscriptionTable)
    .innerJoin(profileTable, eq(profileTable.userId, pushSubscriptionTable.userId))
    .where(
      and(
        eq(profileTable.fastingNotify, true),
        ne(profileTable.fastingPattern, "off"),
        eq(profileTable.maternalMode, "none"),
      ),
    );

  const zones = await zonesOfUsers(db, [...new Set(rows.map((r) => r.userId))]);
  for (const row of rows) {
    if (!isFastingPattern(row.pattern)) continue;
    // Each subscriber's own zone: the window opens at their local time, the day they are in decides the dedupe key.
    const zone = zones.get(row.userId) ?? DEFAULT_DAY_ZONE;
    const dateKey = wibDateKey(now, zone);
    const today = jakartaToday(now, zone);
    // Ramadan owns the schedule while it lasts — its flow has no Web Push.
    if (effectiveRamadan(row.ramadanMode, now, zone)) continue;

    // Same eat budget the day summary shows (formula → measured TDEE).
    const [profRows, latest, weighIns, intake, exercise, prefRows] = await db.batch(
      planQueries(db, row.userId, today),
    );
    const profRow = profRows[0];
    if (!profRow) continue;
    const plan = buildPlan(
      profRow,
      {
        latestWeightKg: latest[0]?.weightKg ?? null,
        weighIns,
        intake,
        exercise,
        prefs: readCalibrationPrefs(prefRows),
      },
      today,
    );
    const [eatenRow] = await db
      .select({ kcal: sql<number | null>`sum(${foodLogTable.kcal})` })
      .from(foodLogTable)
      .where(and(eq(foodLogTable.userId, row.userId), eq(foodLogTable.date, today)));
    const credit = await loadDayCredit(db, row.userId, today, plan.targets.includedKcal);

    const due = dueReminders({
      pattern: row.pattern,
      windowStart: row.windowStart,
      dateKey,
      remainingKcal: Math.max(0, budgetKcal(plan.targets.eatKcal, credit) - (eatenRow?.kcal ?? 0)),
      nowMin: wibMinutes(now, zone),
      // The recipient's saved language; users who never chose one get Indonesian.
      locale: isLocale(row.locale) ? row.locale : undefined,
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

// Abandoned dynamic OAuth clients and audit rows past their retention (lib/mcp-connections). Every tick (*/5): the
// selects match nothing almost always.
async function runMcpSweep(): Promise<void> {
  const swept = await sweepMcp(getDb());
  if (swept.audit + swept.clients > 0)
    console.log(`mcp sweep: ${swept.audit} audit rows, ${swept.clients} clients`);
}

// Strava API Policy 6.2: imported Strava activities live at most 7 days (lib/strava-retention). The cron runs this
// every tick (*/5): the delete matches nothing almost always, so it only reads the rows it checks.
async function runStravaRetention(): Promise<void> {
  const deleted = await scrubExpiredStravaRows(getDb());
  if (deleted > 0) console.log(`strava retention: deleted ${deleted} expired rows`);
}

// Daily accuracy digest (accuracy-job.ts): the report for yesterday's WIB day.
const accuracyDeps = () => ({
  db: getDb(),
  bucket: "STICKERS" in env ? env.STICKERS : undefined,
  ai: env.AI,
  model: env.AI_VISION_MODEL || undefined,
  email: env,
});

// Manual trigger for the daily job (same key-gate style as /ai/bench).
registerAccuracyRoutes(app, {
  key:
    "ACCURACY_RUN_KEY" in env && typeof env.ACCURACY_RUN_KEY === "string"
      ? env.ACCURACY_RUN_KEY
      : undefined,
  run: (opts) => runDailyAccuracy(accuracyDeps(), opts),
});

// Same Hono app as fetch; the scheduled handler runs beside it. `app.fetch`
// is an arrow property, so detaching it stays bound to this app instance.
export default {
  fetch: app.fetch,
  scheduled: (_controller: ScheduledController, _env2: unknown, ctx: ExecutionContext) => {
    ctx.waitUntil(runFastingReminders());
    ctx.waitUntil(
      runPushCron({ db: getDb(), env }).catch((error: unknown) =>
        console.error("[push] cron failed", error),
      ),
    );
    ctx.waitUntil(
      runThreadsBotTick({ db: getDb(), config: botConfig(env), scan: threadsBot.scan }).catch((error: unknown) =>
        console.error("[threads-bot] tick failed", error),
      ),
    );
    ctx.waitUntil(billing.reconcilePending());
    ctx.waitUntil(billing.runEmails());
    ctx.waitUntil(runStravaRetention());
    ctx.waitUntil(
      runMcpSweep().catch((error: unknown) => console.error("[mcp] sweep failed", error)),
    );
    // From 07:00 WIB every tick checks (one R2 read) whether yesterday's report is done.
    if (dailyAccuracyDue(Date.now())) {
      ctx.waitUntil(
        runDailyAccuracy(accuracyDeps()).catch((error: unknown) =>
          console.error("[accuracy] daily job failed", error),
        ),
      );
    }
    // A campaign left in "sending" (rate limit, closed tab) gets one more batch per tick.
    const broadcast = broadcastDeps();
    if (broadcast) {
      ctx.waitUntil(
        runBroadcastTick(broadcast).catch((error: unknown) =>
          console.error("[broadcast] tick failed", error),
        ),
      );
      ctx.waitUntil(
        runTestflightNoticeSweep(broadcast, testflightNotice).catch((error: unknown) =>
          console.error("[testflight-notice] sweep failed", error),
        ),
      );
    }
  },
};
