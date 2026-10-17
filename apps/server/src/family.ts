import { inArray } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";

import { premiumUnlocked } from "@joyorogo/api/lib/readiness-food";
import { effectiveTier, paywallConfig } from "@joyorogo/api/lib/tiers";
import type { StravaGrantEnv } from "@joyorogo/api/lib/strava-grant";
import type { Database } from "@joyorogo/db";
import { user } from "@joyorogo/db/schema/auth";
import { profile } from "@joyorogo/db/schema/fitness";
import { DEFAULT_LOCALE, isLocale } from "@joyorogo/i18n";

import { sameSecret } from "./strava";

type Deps = {
  env: StravaGrantEnv & Parameters<typeof paywallConfig>[0];
  getDb: () => Database;
};

const MAX_IDS = 50;
const body = z.object({ userIds: z.array(z.string().min(1)).min(1).max(MAX_IDS) });

/**
 * JoyoFit family monitoring has no session cookie when its cron evaluates alert rules, so it asks here for what it
 * needs about a user: Pro state, display name, email and language. Same Basic credentials as the Strava grant API
 * (both Workers already hold them). Unknown ids are left out of the answer.
 */
export function registerFamilyRoutes(app: Hono, deps: Deps) {
  const path = "/internal/joyofit/family/users";

  app.post(path, async (c) => {
    const { env } = deps;
    if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) return c.json({ error: "not_configured" }, 503);
    const given = c.req.header("authorization") ?? "";
    if (!(await sameSecret(given, `Basic ${btoa(`${env.STRAVA_CLIENT_ID}:${env.STRAVA_CLIENT_SECRET}`)}`))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const parsed = body.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    const ids = [...new Set(parsed.data.userIds)];
    const db = deps.getDb();
    const rows = await db
      .select({ id: user.id, name: user.name, email: user.email, tier: user.tier, founderUntil: user.founderUntil })
      .from(user)
      .where(inArray(user.id, ids));
    const locales = await db.select({ userId: profile.userId, locale: profile.locale }).from(profile).where(inArray(profile.userId, ids));
    const localeOf = new Map(locales.map((l) => [l.userId, l.locale]));
    const config = paywallConfig(env);
    const users = rows.map((row) => {
      const locale = localeOf.get(row.id);
      return {
        id: row.id,
        name: row.name,
        email: row.email,
        locale: isLocale(locale) ? locale : DEFAULT_LOCALE,
        tier: effectiveTier(row),
        pro: premiumUnlocked(row, config),
      };
    });
    return c.json({ users });
  });
}
