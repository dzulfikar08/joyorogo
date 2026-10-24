import type { Hono } from "hono";

import { peekReturnTo } from "@joyorogo/api/lib/coros-grant";
import type { Database } from "@joyorogo/db";

type Deps = {
  getDb: () => Database;
  /** Origin of the signed-in web app (APP_URL, else the API origin when they share one). */
  appOrigin: () => string;
};

/** Where the app's deep link lands; apps/native/src/lib/native-intent-path.ts keeps the router off it. */
export const COROS_NATIVE_RETURN = "joyorogo://joyorogo.com/coros";

/**
 * COROS's OAuth redirect (docs/coros.md). COROS's client registration takes https redirects only, so the one registered
 * redirect is this endpoint on the API host; it hands the code and state on to whichever app started the flow: the web
 * callback page, or the app's `joyorogo://` link (read by `WebBrowser.openAuthSessionAsync`). Nothing is exchanged here:
 * the app calls `coros.exchangeCode` with the user's session, which checks the state, so a forged request to this endpoint
 * can only bounce a browser, never link an account.
 */
export function registerCorosRoutes(app: Hono, deps: Deps) {
  app.get("/api/coros/callback", async (c) => {
    const query = c.req.query();
    const state = query.state ?? "";
    const target = state === "" ? null : await peekReturnTo(deps.getDb(), state);

    const params = new URLSearchParams();
    for (const key of ["code", "state", "error"] as const) {
      const value = query[key];
      if (value) params.set(key, value);
    }
    // An unknown or expired state still goes to the web page, which tells the user to start again.
    const base = target === "native" ? COROS_NATIVE_RETURN : `${deps.appOrigin().replace(/\/+$/, "")}/profil/coros/callback`;
    const location = `${base}?${params.toString()}`;
    return new Response(null, {
      status: 302,
      headers: { location, "referrer-policy": "no-referrer", "cache-control": "no-store" },
    });
  });
}
