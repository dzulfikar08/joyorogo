import type { JoyoAuth } from "@joyorogo/auth";
import type { Hono } from "hono";

import { deleteAllUserData, deleteUserMedia, userStickerKeys } from "@joyorogo/api/lib/privacy";
import type { StickersBucket } from "@joyorogo/api/lib/sticker";
import type { Database } from "@joyorogo/db";

type Deps = {
  getDb: () => Database;
  createAuth: () => Promise<JoyoAuth>;
  stickers: () => StickersBucket | undefined;
};

/** POST /api/privacy/delete-my-data — wipes all fitness rows of the session user. */
export function registerPrivacyRoutes(app: Hono, deps: Deps) {
  app.post("/api/privacy/delete-my-data", async (c) => {
    const db = deps.getDb();
    // Irreversible: always check the session against D1, never the cookie cache.
    const session = await (
      await deps.createAuth()
    ).api.getSession({
      headers: c.req.raw.headers,
      query: { disableCookieCache: true },
    });
    if (!session?.user) {
      return c.json({ error: "Kamu harus masuk dulu." }, 401);
    }
    const stickerKeys = await userStickerKeys(db, session.user.id);
    await deleteAllUserData(db, session.user.id);
    // Photos and stickers are personal data too; rows are gone already, so a
    // storage hiccup is reported instead of leaving a half-wiped diary.
    const bucket = deps.stickers();
    if (bucket) {
      try {
        await deleteUserMedia(bucket, session.user.id, stickerKeys);
      } catch (error) {
        console.error("[privacy] media wipe failed", error);
        return c.json({ deleted: true, mediaPending: true });
      }
    }
    return c.json({ deleted: true });
  });
}
