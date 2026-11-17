import type { Hono } from "hono";

/** Static sites allowed to read GET /api/config from the browser, without cookies. */
export const PUBLIC_CONFIG_ORIGINS = ["https://fit.joyorogo.com"];

/**
 * /api/config is public (prices, paywall switches, no user data). The JoyoFit marketing site (fit.joyorogo.com) reads it
 * in the browser to show the current price. Only GET from the listed origins gets an Allow-Origin header, and never
 * Allow-Credentials, so these sites can read the price and nothing a signed-in page could. Origins already in the
 * credentialed CORS_ORIGIN list are left to that middleware. No preflight handling: a plain GET does not need one.
 */
export function registerPublicConfigCors(app: Hono, credentialedOrigins: string[]) {
  app.use("/api/config", async (c, next) => {
    await next();
    const origin = c.req.header("Origin");
    if (c.req.method !== "GET" || !origin || credentialedOrigins.includes(origin)) return;
    if (!PUBLIC_CONFIG_ORIGINS.includes(origin)) return;
    c.header("Access-Control-Allow-Origin", origin);
    // The credentialed middleware sets this for every origin; it must not reach a public one.
    c.res.headers.delete("Access-Control-Allow-Credentials");
    c.header("Vary", "Origin", { append: true });
  });
}
