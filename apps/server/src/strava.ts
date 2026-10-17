import type { Hono } from "hono";
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
import type { Database } from "@joyorogo/db";

type Deps = {
  env: StravaGrantEnv;
  getDb: () => Database;
};

const userBody = z.object({ userId: z.string().min(1) });
const exchangeBody = userBody.extend({
  code: z.string().min(1),
  callbackScope: z.string().optional(),
});
const athleteBody = z.object({ athleteId: z.union([z.number(), z.string()]) });

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

  app.use(`${prefix}/*`, async (c, next) => {
    const { env } = deps;
    if (!stravaConfigured(env)) return c.json({ error: "strava_not_configured" }, 503);
    const given = c.req.header("authorization") ?? "";
    if (!(await sameSecret(given, `Basic ${btoa(`${env.STRAVA_CLIENT_ID}:${env.STRAVA_CLIENT_SECRET}`)}`))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });

  app.post(`${prefix}/status`, async (c) => {
    const body = userBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const status = await grantStatus(deps.getDb(), body.data.userId, "fit");
    return c.json({
      connected: status.connected,
      athleteId: status.athleteId === undefined ? undefined : Number(status.athleteId),
      connectedAt: status.connectedAt && Math.floor(status.connectedAt.getTime() / 1000),
      requestedScope: status.requestedScope,
    });
  });

  app.post(`${prefix}/exchange`, async (c) => {
    const body = exchangeBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    try {
      const { athleteId, scope } = await exchangeCode(deps.getDb(), deps.env, {
        ...body.data,
        product: "fit",
      });
      return c.json({ athleteId: Number(athleteId), scope });
    } catch (error) {
      if (!(error instanceof StravaGrantError)) throw error;
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
}
