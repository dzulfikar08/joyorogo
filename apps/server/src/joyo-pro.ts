import type { Hono } from "hono";
import { z } from "zod";

import { findJoyoUser, joyoProStatus } from "@joyorogo/api/lib/joyo-pro";
import type { RateLimitBinding } from "@joyorogo/api/lib/group-preview";
import { paywallConfig } from "@joyorogo/api/lib/tiers";
import type { PaywallEnv } from "@joyorogo/api/lib/tiers";
import type { Database } from "@joyorogo/db";

import { sameSecret } from "./strava";

export const JOYO_PRO_STATUS_PATH = "/api/internal/joyo-pro/status";
export const INTERNAL_KEY_HEADER = "x-joyo-internal-key";

export type JoyoProEnv = PaywallEnv & {
  /** Shared secret of the sibling apps (JoyoArto) that ask for Joyo Pro status. Unset = the route does not exist. */
  JOYO_INTERNAL_KEY?: string;
  /** Budget of authenticated status calls (wrangler `ratelimits`); unset = no limit (self-host, tests). */
  JOYO_INTERNAL_LIMITER?: RateLimitBinding;
};

type Deps = { env: JoyoProEnv; getDb: () => Database };

const body = z.object({
  googleSub: z.string().max(255).nullish(),
  email: z.string().max(320),
});

/**
 * Joyo Pro status for JoyoArto (docs/joyo-pro.md). JoyoArto has its own accounts in its own D1 but signs in with the
 * same Google OAuth client, so it sends the Google account id and the email of its user and gets back whether that
 * person's JoyoRogo account has Pro. Server to server only: the shared key never reaches a browser.
 *
 * The answer is the same for "no such account" and "not Pro", so it says nothing about whether an email has a
 * JoyoRogo account beyond what the key holder could already learn. Emails are never logged (the request logger
 * prints method and path only, and this route logs nothing of the body).
 */
export function registerJoyoProRoutes(app: Hono, deps: Deps) {
  app.post(JOYO_PRO_STATUS_PATH, async (c) => {
    const { env } = deps;
    const key = env.JOYO_INTERNAL_KEY?.trim();
    if (!key) return c.json({ error: "not_found" }, 404);
    const given = c.req.header(INTERNAL_KEY_HEADER) ?? "";
    if (!given || !(await sameSecret(given, key))) return c.json({ error: "unauthorized" }, 401);
    // One shared bucket for the caller. Not per IP: Workers calling Workers share Cloudflare's egress addresses.
    if (env.JOYO_INTERNAL_LIMITER) {
      const { success } = await env.JOYO_INTERNAL_LIMITER.limit({ key: "joyo-pro-status" });
      if (!success) return c.json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
    }
    const parsed = body.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    const db = deps.getDb();
    const row = await findJoyoUser(db, parsed.data);
    const status = await joyoProStatus(db, paywallConfig(env), row);
    c.header("Cache-Control", "no-store");
    return c.json(status);
  });
}
