import type { ApiEnv } from "@joyorogo/api/context";
import type { Context as ApiContext } from "@joyorogo/api/context";
import type { Context as HonoContext } from "hono";

import { createAuth, getDb } from "./services";
import { env as workerEnv } from "./env.server";

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions): Promise<ApiContext> {
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
    waitUntil: (promise) => context.executionCtx.waitUntil(promise),
  };
}
export type Context = ApiContext;
