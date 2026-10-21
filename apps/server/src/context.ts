import type { ApiEnv } from "@joyorogo/api/context";
import type { Context as ApiContext } from "@joyorogo/api/context";
import { DEFAULT_LOCALE, LOCALE_HEADER, matchLocale, resolveRegion } from "@joyorogo/i18n";
import type { Region } from "@joyorogo/i18n";
import type { Context as HonoContext } from "hono";

import { createAuth, getDb } from "./services";
import { env as workerEnv } from "./env.server";

/**
 * Language of a plain Hono request: x-locale, else `id`. No Accept-Language
 * fallback on purpose: clients released before i18n send no x-locale and only
 * render Indonesian (they match error text), so they must keep getting `id`.
 */
export function requestLocale(context: HonoContext) {
  return matchLocale(context.req.header(LOCALE_HEADER)) ?? DEFAULT_LOCALE;
}

/** Market of a plain Hono request: a Bahasa Melayu UI, else the network country (Cloudflare's CF-IPCountry). */
export function requestRegion(context: HonoContext): Region {
  return resolveRegion({
    locale: requestLocale(context),
    country: context.req.header("CF-IPCountry"),
  });
}

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions): Promise<ApiContext> {
  const requestStartedAt = Date.now();
  // Verified from the signed session_data cookie while it is fresh (see the
  // cookieCache note in @joyorogo/auth); otherwise one D1 session lookup.
  const session = await (
    await createAuth()
  ).api.getSession({
    headers: context.req.raw.headers,
  });
  return {
    db: getDb(),
    auth: null,
    session,
    env: workerEnv as unknown as ApiEnv,
    locale: requestLocale(context),
    region: requestRegion(context),
    clientIp: context.req.header("CF-Connecting-IP") ?? null,
    waitUntil: (promise) => context.executionCtx.waitUntil(promise),
    requestStartedAt,
  };
}
export type Context = ApiContext;
