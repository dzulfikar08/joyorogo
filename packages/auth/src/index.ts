import { expo } from "@better-auth/expo";
import type { Database } from "@joyorogo/db";
import * as schema from "@joyorogo/db/schema/auth";
import type { BetterAuthPlugin } from "better-auth";
import { betterAuth } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  DEV_LOGIN?: string;
};

/** The configured better-auth instance createAuth returns. */
export type JoyoAuth = ReturnType<typeof createAuth>;

/** Better Auth session (or null when signed out), as returned by getSession. */
export type AuthSession = Awaited<ReturnType<JoyoAuth["api"]["getSession"]>>;

const DEV_USER = {
  email: "dev@joyorogo.local",
  name: "Dev User",
};

/**
 * Credentialless sign-in for local verification, before real Google OAuth
 * credentials exist. The endpoint only exists when the server was started
 * with DEV_LOGIN set, so production builds never expose it.
 */
function devLogin(enabled: boolean): BetterAuthPlugin {
  return {
    id: "dev-login",
    endpoints: {
      signInDevUser: createAuthEndpoint(
        "/sign-in/dev-user",
        {
          method: "POST",
          metadata: {
            openapi: {
              description: "Sign in as the fixed dev user (DEV_LOGIN builds only)",
              responses: { 200: { description: "Signed in" } },
            },
          },
        },
        async (ctx) => {
          if (!enabled) {
            throw new APIError("NOT_FOUND");
          }
          let user = (await ctx.context.internalAdapter.findUserByEmail(DEV_USER.email))?.user;
          if (!user) {
            user = await ctx.context.internalAdapter.createUser(
              {
                email: DEV_USER.email,
                emailVerified: true,
                name: DEV_USER.name,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
              { method: "dev-login" },
            );
          }
          if (!user) {
            throw new APIError("INTERNAL_SERVER_ERROR", { message: "Gagal membuat user dev" });
          }
          const session = await ctx.context.internalAdapter.createSession(user.id);
          if (!session) {
            throw new APIError("INTERNAL_SERVER_ERROR", { message: "Gagal membuat sesi dev" });
          }
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ user, session });
        },
      ),
    },
  };
}

export function createAuth(
  env: AuthConfig,
  database: Database,
  desktopOrigins: readonly string[] = [],
) {
  return betterAuth({
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema,
    }),
    trustedOrigins: [
      // CORS_ORIGIN accepts a comma-separated list: local + deployed web app
      ...env.CORS_ORIGIN.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
      ...desktopOrigins,
      "joyorogo://",
      "joyofit://",
      "exp://",
      "http://localhost:8081",
    ],
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        // Refresh name + picture on every Google sign-in, so profile photos
        // keep following the Google account and users who signed up before
        // photos were stored get theirs backfilled on the next sign-in.
        overrideUserInfoOnSignIn: true,
      },
    },
    databaseHooks: {
      user: {
        update: {
          // A custom upload always wins over the provider picture: when the
          // stored image is our own /avatar/ URL, keep it even though the
          // OAuth refresh just delivered Google's latest photo.
          before: async (data, context) => {
            if (
              !context ||
              !data.id ||
              typeof data.image !== "string" ||
              data.image.startsWith("/avatar/")
            ) {
              return;
            }
            const current = await context.context.internalAdapter.findUserById(data.id);
            if (!current || typeof current.image !== "string" || !current.image.startsWith("/avatar/")) {
              return;
            }
            return { data: { ...data, image: current.image } };
          },
        },
      },
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    session: {
      // Every RPC resolves the session. A signed 5-minute session_data cookie
      // (refreshed whenever the client calls /get-session) lets the server
      // verify it without a D1 lookup. Trade-off: a session revoked on
      // another device keeps working here for up to 5 minutes; sign-out on
      // this device clears both cookies immediately.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    advanced: {
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
        httpOnly: true,
      },
    },
    plugins: [expo(), devLogin(Boolean(env.DEV_LOGIN))],
  });
}
