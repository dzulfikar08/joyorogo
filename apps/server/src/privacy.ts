import type { JoyoAuth } from "@joyorogo/auth";
import type { Hono } from "hono";

import { deleteAllUserData } from "@joyorogo/api/lib/privacy";
import type { Database } from "@joyorogo/db";

type Deps = {
  getDb: () => Database;
  createAuth: () => Promise<JoyoAuth>;
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
    await deleteAllUserData(db, session.user.id);
    return c.json({ deleted: true });
  });
}
