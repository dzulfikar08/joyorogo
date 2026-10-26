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
import { type StravaCapacityEnv, slotCheck, stravaCapacity } from "@joyorogo/api/lib/strava-capacity";
import { RELEASE_MAX, releaseAthletes, releaseIdleFree, releaseNotice } from "@joyorogo/api/lib/strava-release";
import type { Database } from "@joyorogo/db";

type Deps = {
  env: StravaGrantEnv & StravaCapacityEnv;
  getDb: () => Database;
};

const userBody = z.object({ userId: z.string().min(1) });
const exchangeBody = userBody.extend({
  code: z.string().min(1),
  callbackScope: z.string().optional(),
});
const athleteId = z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]);
const athleteBody = z.object({ athleteId });
// Named athletes are released whether idle or not; without them the idle free athletes are, oldest use first.
const releaseBody = z.object({
  athleteIds: z.array(athleteId).min(1).max(RELEASE_MAX).optional(),
  olderThanDays: z.number().int().min(1).optional(),
  max: z.number().int().min(1).max(RELEASE_MAX).optional(),
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
  app.use(releasePath, requireAppCredentials);

  app.post(`${prefix}/status`, async (c) => {
    const body = userBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const db = deps.getDb();
    const status = await grantStatus(db, body.data.userId, "fit");
    // Not connected: whether a slot of the shared application is open to this user, and whether JoyoRogo released
    // the last one (docs/strava.md "Capacity"). JoyoFit shows the slots-full state instead of the connect button.
    const [slots, released] = status.connected
      ? [undefined, null]
      : await Promise.all([slotCheck(db, body.data.userId, stravaCapacity(deps.env)), releaseNotice(db, body.data.userId)]);
    return c.json({
      connected: status.connected,
      athleteId: status.athleteId === undefined ? undefined : Number(status.athleteId),
      connectedAt: status.connectedAt && Math.floor(status.connectedAt.getTime() / 1000),
      requestedScope: status.requestedScope,
      slotsFull: slots?.slotsFull ?? false,
      slotsReason: slots?.slotsReason,
      released: released ? { at: Math.floor(released.at.getTime() / 1000), reason: released.reason } : undefined,
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
      if (error.failure === "slots_full") return c.json({ error: "slots_full", reason: error.slotsReason ?? "full" }, 409);
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
   * The owner's lever on Strava slots (docs/strava.md "Capacity"): `{ athleteIds }` releases those athletes, otherwise
   * idle free athletes go (`olderThanDays`, default STRAVA_IDLE_DAYS; `max`, default 1). Paying users never. `dryRun`
   * answers what would happen. Same credentials as the JoyoFit routes. Answers Strava's revoke result per athlete.
   */
  app.post(releasePath, async (c) => {
    const body = releaseBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const { athleteIds, olderThanDays, max, dryRun } = body.data;
    const db = deps.getDb();
    const results = athleteIds
      ? await releaseAthletes(db, deps.env, athleteIds.map(String), { dryRun })
      : await releaseIdleFree(db, deps.env, {
          olderThanDays: olderThanDays ?? stravaCapacity(deps.env).idleDays,
          max: max ?? 1,
          dryRun,
        });
    return c.json({ results });
  });
}
