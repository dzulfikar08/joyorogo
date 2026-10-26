import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";

import {
  StravaGrantError,
  disconnectProduct,
  dropAthlete,
  exchangeCode,
  freshAccessToken,
  grantStatus,
  stravaConfigured,
  type StravaGrantEnv,
} from "@joyorogo/api/lib/strava-grant";
import { type StravaCapacityEnv, slotsFull, stravaCapacity } from "@joyorogo/api/lib/strava-capacity";
import { RELEASE_MAX, releaseAthletes, releasedAt } from "@joyorogo/api/lib/strava-release";
import type { Database } from "@joyorogo/db";

type Deps = {
  /** STRAVA_RELEASE_KEY: optional secret that also opens the release route (`X-Release-Key`), for the owner, who does not hold the Strava client secret locally. */
  env: StravaGrantEnv & StravaCapacityEnv & { STRAVA_RELEASE_KEY?: string };
  getDb: () => Database;
};

const userBody = z.object({ userId: z.string().min(1) });
const exchangeBody = userBody.extend({
  code: z.string().min(1),
  callbackScope: z.string().optional(),
});
const athleteId = z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]);
const athleteBody = z.object({ athleteId });
const releaseBody = z.object({
  athleteIds: z.array(athleteId).min(1).max(RELEASE_MAX),
  dryRun: z.boolean().optional(),
});

const sha256 = async (text: string) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

/** Compares equal-length digests, so the answer does not depend on where the strings first differ. */
export async function sameSecret(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/**
 * The JoyoFit Worker's door to the shared Strava grant (docs/strava.md): JoyoFit has no token store of its own, it
 * asks here for status, the code exchange, access tokens, disconnect and the deauthorization event. Strava's webhook
 * is one subscription per app and points at JoyoFit's Worker, which forwards the event.
 *
 * Authenticated with the Strava application's own credentials as HTTP Basic (`<client id>:<client secret>`), which
 * both Workers already hold and nobody else has. Unset credentials answer 503. Every call acts as the `fit` product.
 */
export function registerStravaRoutes(app: Hono, deps: Deps) {
  const prefix = "/internal/joyofit/strava";
  const releasePath = "/internal/strava/release";

  const requireAppCredentials: MiddlewareHandler = async (c, next) => {
    const { env } = deps;
    if (!stravaConfigured(env)) return c.json({ error: "strava_not_configured" }, 503);
    const given = c.req.header("authorization") ?? "";
    if (!(await sameSecret(given, `Basic ${btoa(`${env.STRAVA_CLIENT_ID}:${env.STRAVA_CLIENT_SECRET}`)}`))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
  app.use(`${prefix}/*`, requireAppCredentials);
  // The release route also opens with STRAVA_RELEASE_KEY (`X-Release-Key`), a Worker secret the owner can set with
  // wrangler, since the Strava client secret lives only in the Workers.
  app.use(releasePath, async (c, next) => {
    const key = deps.env.STRAVA_RELEASE_KEY;
    const given = c.req.header("x-release-key");
    if (key && given !== undefined) {
      if (!(await sameSecret(given, key))) return c.json({ error: "unauthorized" }, 401);
      if (!stravaConfigured(deps.env)) return c.json({ error: "strava_not_configured" }, 503);
      return next();
    }
    return requireAppCredentials(c, next);
  });

  app.post(`${prefix}/status`, async (c) => {
    const body = userBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const db = deps.getDb();
    const status = await grantStatus(db, body.data.userId, "fit");
    // Not connected: whether every slot of the shared application is taken, and whether the owner released this
    // user's unused connection (docs/strava.md "Capacity"). JoyoFit shows the slots-full state instead of the button.
    const [full, released] = status.connected
      ? ([false, null] as const)
      : await Promise.all([slotsFull(db, body.data.userId, stravaCapacity(deps.env)), releasedAt(db, body.data.userId)]);
    return c.json({
      connected: status.connected,
      athleteId: status.athleteId === undefined ? undefined : Number(status.athleteId),
      connectedAt: status.connectedAt && Math.floor(status.connectedAt.getTime() / 1000),
      requestedScope: status.requestedScope,
      slotsFull: full,
      released: released ? { at: Math.floor(released.getTime() / 1000) } : undefined,
    });
  });

  app.post(`${prefix}/exchange`, async (c) => {
    const body = exchangeBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    try {
      const { athleteId, scope } = await exchangeCode(deps.getDb(), deps.env, {
        ...body.data,
        product: "fit",
        capacity: stravaCapacity(deps.env),
      });
      return c.json({ athleteId: Number(athleteId), scope });
    } catch (error) {
      if (!(error instanceof StravaGrantError)) throw error;
      // The just-granted token was already revoked: it never holds a slot.
      if (error.failure === "slots_full") return c.json({ error: "slots_full" }, 409);
      return c.json({ error: error.failure }, error.failure === "unavailable" ? 502 : 422);
    }
  });

  app.post(`${prefix}/token`, async (c) => {
    const body = userBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    try {
      const token = await freshAccessToken(deps.getDb(), deps.env, body.data.userId, "fit");
      if (!token) return c.json({ error: "strava_not_connected" }, 409);
      return c.json({
        accessToken: token.accessToken,
        expiresAt: Math.floor(token.expiresAt.getTime() / 1000),
        athleteId: Number(token.athleteId),
      });
    } catch (error) {
      if (!(error instanceof StravaGrantError)) throw error;
      return c.json({ error: "strava_unavailable" }, 502);
    }
  });

  app.post(`${prefix}/disconnect`, async (c) => {
    const body = userBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    return c.json(await disconnectProduct(deps.getDb(), deps.env, body.data.userId, "fit"));
  });

  app.post(`${prefix}/deauthorized`, async (c) => {
    const body = athleteBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const users = await dropAthlete(deps.getDb(), String(body.data.athleteId));
    return c.json({ dropped: users.length });
  });

  /**
   * The owner's manual tool for Strava slots (docs/strava.md "Capacity"): `{ athleteIds }` releases those athletes
   * (`dryRun` answers what would happen). Answers Strava's revoke result per athlete. Nothing releases by itself.
   */
  app.post(releasePath, async (c) => {
    const body = releaseBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const results = await releaseAthletes(deps.getDb(), deps.env, body.data.athleteIds.map(String), {
      dryRun: body.data.dryRun,
    });
    return c.json({ results });
  });
}
