import { and, desc, eq, sql } from "drizzle-orm";
import { appRouter } from "@joyorogo/api/routers/index";
import { jakartaToday, shiftDate, streakFromDates } from "@joyorogo/api/lib/engine";
import { paywallConfig } from "@joyorogo/api/lib/tiers";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import {
  exerciseLog as exerciseLogTable,
  foodLog as foodLogTable,
  profile as profileTable,
  weightLog as weightLogTable,
} from "@joyorogo/db/schema/fitness";

import { registerAnonScanRoutes } from "./anon";
import { registerBillingRoutes } from "./billing";
import { createContext } from "./context";
import { registerBenchRoutes } from "./bench";
import { registerPrivacyRoutes } from "./privacy";
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

// Anonymous landing-page scans (after CORS so browsers can read responses).
registerAnonScanRoutes(app, {
  ai: env.AI,
  getDb,
  model: env.AI_VISION_MODEL || undefined,
  anonScans: paywallConfig(env).anonScans,
});

// Public config, Founder checkout (DOKU) + webhook, personal AI usage.
// After CORS so web can read errors.
registerBillingRoutes(app, { env, getDb, createAuth });

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
  const obj = await env.STICKERS.get(`scans/${scanId}.png`);
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

// Personal-data wipe (profil + /privasi). After CORS so web can read errors.
registerPrivacyRoutes(app, {
  getDb,
  createAuth,
  stickers: () => ("STICKERS" in env ? env.STICKERS : undefined),
});

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
      ? `Aku sudah turun ${lost.toLocaleString("id-ID")} kg dengan JoyoRogo 💪`
      : "Aku lagi diet bareng JoyoRogo 🥗";
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
      `<p>🔥 Streak ${streakDays} hari</p>` +
      `<p>🍗 ≈ ${geprek} geprek dibakar minggu ini</p>` +
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

export default app;
