import type { JoyoAuth } from "@joyorogo/auth";
import type { Hono } from "hono";

import { serverT } from "@joyorogo/api/lib/messages";
import type { StickersBucket } from "@joyorogo/api/lib/sticker";
import type { PaywallEnv } from "@joyorogo/api/lib/tiers";
import { WATCH_WORKOUT_LIMITS, WatchWorkoutDocError } from "@joyorogo/api/lib/watch-workout";
import { WatchWorkoutRefusal, cloudUnlocked, getBlob, putWorkout } from "@joyorogo/api/lib/watch-workout-store";
import type { Database } from "@joyorogo/db";

import { requestLocale } from "./context";

type Deps = {
  getDb: () => Database;
  createAuth: () => Promise<JoyoAuth>;
  env: PaywallEnv;
  bucket: () => StickersBucket | undefined;
};

const START_RE = /^\d{1,10}$/;

/**
 * The binary side of the JoyoFit cloud workouts (the rest is oRPC `watchWorkout.*`): oRPC speaks JSON, and a workout
 * document is gzip bytes the app compressed on the phone, so it travels as the raw request body.
 *
 * - `PUT /api/watch-workouts/:start`: body is the gzip document of the workout that started at `:start` (unix
 *   seconds). Pro only (402 `founder_required` with `paywall: true`, the answer JoyoFit already understands).
 *   200 `{ start, version, status: "created" | "updated" | "unchanged", bytes }`. 400 for a document that is not
 *   valid (`error` is the code of WatchWorkoutErrorCode), 410 `deleted` for a workout deleted from the cloud,
 *   413 `too_large` / `quota`.
 * - `GET /api/watch-workouts/:start/blob`: the stored gzip document, for restoring a phone. Open to the account
 *   without Pro, so nothing is locked away.
 */
export function registerWatchWorkoutRoutes(app: Hono, deps: Deps) {
  const session = async (headers: Headers) => (await (await deps.createAuth()).api.getSession({ headers }))?.user ?? null;

  app.put("/api/watch-workouts/:start", async (c) => {
    const locale = requestLocale(c);
    const me = await session(c.req.raw.headers);
    if (!me) return c.json({ error: "unauthorized", message: serverT(locale, "errors")("auth.signInRequired") }, 401);
    const startParam = c.req.param("start");
    if (!START_RE.test(startParam)) return c.json({ error: "bad_start" }, 400);
    const bucket = deps.bucket();
    if (!bucket) return c.json({ error: "storage_unavailable", message: serverT(locale, "errors")("watchCloud.storageUnavailable") }, 503);

    const db = deps.getDb();
    if (!(await cloudUnlocked(db, deps.env, me.id))) return c.json({ error: "founder_required", paywall: true }, 402);

    const declared = Number(c.req.header("content-length"));
    if (Number.isFinite(declared) && declared > WATCH_WORKOUT_LIMITS.gzipBytes) return c.json({ error: "too_large" }, 413);
    const body = new Uint8Array(await c.req.arrayBuffer());
    try {
      const result = await putWorkout(db, bucket, me.id, Number(startParam), body);
      return c.json(result);
    } catch (error) {
      if (error instanceof WatchWorkoutDocError) {
        return c.json({ error: error.code, message: error.message }, error.code === "too_large" ? 413 : 400);
      }
      if (error instanceof WatchWorkoutRefusal) {
        return c.json({ error: error.code, message: error.message }, error.code === "deleted" ? 410 : 413);
      }
      throw error;
    }
  });

  app.get("/api/watch-workouts/:start/blob", async (c) => {
    const locale = requestLocale(c);
    const me = await session(c.req.raw.headers);
    if (!me) return c.json({ error: "unauthorized", message: serverT(locale, "errors")("auth.signInRequired") }, 401);
    const startParam = c.req.param("start");
    if (!START_RE.test(startParam)) return c.json({ error: "bad_start" }, 400);
    const bucket = deps.bucket();
    if (!bucket) return c.json({ error: "storage_unavailable", message: serverT(locale, "errors")("watchCloud.storageUnavailable") }, 503);
    const bytes = await getBlob(deps.getDb(), bucket, me.id, Number(startParam));
    if (!bytes) return c.json({ error: "not_found", message: serverT(locale, "errors")("watchCloud.notFound") }, 404);
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, no-store",
      },
    });
  });
}
