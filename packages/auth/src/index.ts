import { expo } from "@better-auth/expo";
import { mcp } from "@better-auth/mcp";
import type { Database } from "@joyorogo/db";
import * as schema from "@joyorogo/db/schema/auth";
import * as oauthSchema from "@joyorogo/db/schema/oauth";
import type { BetterAuthPlugin } from "better-auth";
import { betterAuth } from "better-auth";
import { APIError, createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";

import { appleBundleIds } from "./apple-audience";
import { MCP_OFFLINE_SCOPE, MCP_PATH, MCP_SCOPES } from "./mcp-scopes";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
  /** Public web origin: the login and consent pages of the MCP connector live there. Empty = BETTER_AUTH_URL. */
  APP_URL?: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** Comma-separated iOS bundle ids (JoyoRogo, JoyoFit): the audiences of native Sign in with Apple identity tokens. Unset = both. */
  APPLE_BUNDLE_IDS?: string;
  DEV_LOGIN?: string;
  /**
   * Comma-separated emails allowed to sign in with email + password (Google
   * Play / App Store review accounts). Empty = email/password is fully off.
   */
  REVIEW_LOGIN_EMAILS?: string;
  /** Per-IP throttle for the review login (wrangler `ratelimits`); unset = no throttle. */
  REVIEW_LOGIN_LIMITER?: RateLimiter;
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

/** Lower-cased, trimmed allowlist from the comma-separated REVIEW_LOGIN_EMAILS. */
export function parseReviewLoginEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/** Workers Rate Limiting binding surface (wrangler.jsonc `ratelimits`). */
export type RateLimiter = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

/**
 * Email + password sign-in for the allowlisted review accounts only.
 * Sign-up is always off (the accounts are created out of band by
 * packages/auth/scripts/review-login.ts) and every other email gets the exact
 * error a wrong password gets, so the allowlist cannot be probed. An empty
 * allowlist turns the whole feature off. `limiter` throttles password
 * guesses per client IP (the Workers binding is shared by every isolate in a
 * location, unlike better-auth's in-memory rate limit).
 */
export function reviewLoginOptions(allowedEmails: readonly string[], limiter?: RateLimiter) {
  const allowed = new Set(allowedEmails);
  return {
    emailAndPassword: {
      enabled: allowed.size > 0,
      disableSignUp: true,
      // Reviewer accounts have no inbox: no verification mail, no reset mail.
      requireEmailVerification: false,
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email") return;
        if (limiter) {
          const ip = ctx.request?.headers.get("cf-connecting-ip") ?? "unknown";
          const { success } = await limiter.limit({ key: `review-login:${ip}` });
          if (!success) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Too many requests. Please try again later.",
            });
          }
        }
        const email = (ctx.body as { email?: unknown } | undefined)?.email;
        if (typeof email === "string" && allowed.has(email.trim().toLowerCase())) return;
        // Burn the same hash the real path would, so timing does not reveal the allowlist.
        const password = (ctx.body as { password?: unknown } | undefined)?.password;
        await ctx.context.password.hash(typeof password === "string" ? password : "");
        throw new APIError("UNAUTHORIZED", {
          code: "INVALID_EMAIL_OR_PASSWORD",
          message: "Invalid email or password",
        });
      }),
    },
  };
}

/** Where the connector's access tokens are accepted: the MCP endpoint, which is the `aud` of every token. */
export function mcpResourceUrl(authUrl: string): string {
  return `${authUrl.replace(/\/$/, "")}${MCP_PATH}`;
}

/**
 * OAuth 2.1 authorization server for the MCP connector (Claude, ChatGPT and other MCP clients; docs/mcp-connector.md):
 * authorization code + PKCE (S256 only), dynamic client registration (RFC 7591, no account needed to register, the
 * user's consent is what grants anything), resource-bound JWT access tokens (RFC 8707) and rotating refresh tokens.
 * Login and consent are one page of the web app (`/koneksi/izin`); the signed query the plugin appends carries the
 * request through it.
 *
 * `offline_access` is added to every authorization request that names scopes: the clients read the scope list from
 * metadata and may leave it out, and without it no refresh token is issued, which would sign the user out of the
 * connector every hour.
 */
export function mcpPlugins(env: Pick<AuthConfig, "BETTER_AUTH_URL" | "APP_URL">): BetterAuthPlugin[] {
  const appUrl = (env.APP_URL || env.BETTER_AUTH_URL).replace(/\/$/, "");
  const page = `${appUrl}/koneksi/izin`;
  const provider = mcp({
    loginPage: page,
    consentPage: page,
    resource: mcpResourceUrl(env.BETTER_AUTH_URL),
    scopes: [...MCP_SCOPES],
    // Only what the connector uses: client_credentials would also be advertised otherwise (it stays fail closed).
    grantTypes: ["authorization_code", "refresh_token"],
    // The consent page names the app before the user signs in (POST /oauth2/public-client-prelogin with the signed query).
    allowPublicClientPrelogin: true,
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
    // Better Auth 1.7.3 has no way to infer the application type of a registration (see nativeRegistration below).
    accessTokenExpiresIn: 60 * 60,
    refreshTokenExpiresIn: 30 * 24 * 60 * 60,
    // Per client IP and endpoint. The AI apps call from a few shared addresses (Anthropic, OpenAI), so the defaults
    // (20 token calls a minute) would throttle every user of one app together.
    rateLimit: {
      token: { window: 60, max: 120 },
      authorize: { window: 60, max: 120 },
      register: { window: 60, max: 60 },
      revoke: { window: 60, max: 60 },
    },
  });
  return [
    // No set-auth-jwt header on session calls: tokens here are only ever minted by the OAuth token endpoint.
    jwt({ disableSettingJwtHeader: true }),
    {
      ...provider,
      hooks: {
        ...provider.hooks,
        before: [
          ...(provider.hooks?.before ?? []),
          {
            matcher: (ctx) => ctx.path === "/oauth2/authorize",
            handler: createAuthMiddleware(async (ctx) => {
              const query = (ctx.query ?? {}) as { scope?: unknown; resource?: unknown };
              const scope = typeof query.scope === "string" ? query.scope : undefined;
              const needsScope = scope !== undefined && !scope.split(" ").includes(MCP_OFFLINE_SCOPE);
              const needsResource = query.resource === undefined;
              if (!needsScope && !needsResource) return;
              return {
                context: {
                  query: {
                    ...query,
                    ...(needsScope ? { scope: `${scope} ${MCP_OFFLINE_SCOPE}` } : {}),
                    // A client that leaves the RFC 8707 resource out would get an opaque token the MCP endpoint cannot read.
                    ...(needsResource ? { resource: mcpResourceUrl(env.BETTER_AUTH_URL) } : {}),
                  },
                },
              };
            }),
          },
          {
            matcher: (ctx) => ctx.path === "/oauth2/register",
            handler: createAuthMiddleware(async (ctx) => {
              const body = ctx.body as { application_type?: unknown; redirect_uris?: unknown } | undefined;
              if (!body || body.application_type !== undefined || !nativeRegistration(body.redirect_uris)) return;
              return { context: { body: { ...body, application_type: "native" } } };
            }),
          },
        ],
      },
    },
  ];
}

/**
 * Whether a registration without `application_type` is a native app: a callback on localhost / 127.0.0.1 / [::1] or
 * a custom scheme (Claude Code, Cursor and other desktop clients). Plugin versions after 1.7.3 do this themselves
 * (`clientRegistrationDefaultApplicationType: "infer"`); a web client with only https callbacks stays `web`.
 */
function nativeRegistration(redirectUris: unknown): boolean {
  if (!Array.isArray(redirectUris)) return false;
  return redirectUris.some((uri) => {
    try {
      const url = new URL(String(uri));
      if (url.protocol === "https:") return false;
      if (url.protocol !== "http:") return true;
      return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    } catch {
      return false;
    }
  });
}

/**
 * Google sign-in from the Android apps always shows the account chooser (`prompt=select_account`).
 *
 * The apps open Google in a Chrome Custom Tab and get the session back through a redirect to `joyofit://` /
 * `joyorogo://`. Chrome follows a redirect to another app only when the user touched the page shortly before
 * ("External navigation blocked due to missing gesture"). A person signed in to one Google account who has agreed to
 * JoyoRogo once is approved by Google without any screen (the callback carries `prompt=none`), so there is no touch:
 * our server creates the session, the tab stays on the redirect Chrome blocked, and the app never receives the
 * cookie. Every later sign-in on that phone fails the same way. The chooser costs one tap, and that tap is the touch.
 *
 * Android apps are told apart from browsers and iOS by `expo-origin` (sent by better-auth's expo client) together
 * with React Native's OkHttp user agent (iOS says CFNetwork); web sign-in is left alone.
 */
export function androidAccountChooser(): BetterAuthPlugin {
  return {
    id: "android-account-chooser",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/sign-in/social",
          handler: createAuthMiddleware(async (ctx) => {
            const body = ctx.body as { provider?: unknown } | undefined;
            const headers = ctx.request?.headers ?? ctx.headers;
            const fromAndroidApp = Boolean(headers?.get("expo-origin")) && /okhttp/i.test(headers?.get("user-agent") ?? "");
            if (body?.provider !== "google" || !fromAndroidApp) return;
            return { context: { body: { additionalParams: { prompt: "select_account" } } } };
          }),
        },
      ],
    },
  };
}

export function createAuth(
  env: AuthConfig,
  database: Database,
  desktopOrigins: readonly string[] = [],
) {
  const appleBundles = appleBundleIds(env.APPLE_BUNDLE_IDS);
  const review = reviewLoginOptions(
    parseReviewLoginEmails(env.REVIEW_LOGIN_EMAILS),
    env.REVIEW_LOGIN_LIMITER,
  );
  return betterAuth({
    ...review,
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema: { ...schema, ...oauthSchema },
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
      // Native Sign in with Apple only: the app sends the identity token and
      // better-auth verifies it against Apple's JWKS (issuer appleid.apple.com,
      // audience = bundle id). No Services ID, private key or client secret:
      // those are needed only for the web redirect / code-exchange flow,
      // which this app never starts.
      apple: {
        clientId: appleBundles[0]!,
        appBundleIdentifier: appleBundles[0]!,
        // Every enabled app (JoyoRogo, JoyoFit) signs in to the same account with
        // its own bundle id as the token audience; `audience` wins over appBundleIdentifier.
        audience: appleBundles,
        // Apple omits the name on every sign-in after the first (and on
        // relay-only grants); never store an empty one.
        mapProfileToUser: (profile) => (profile.name ? {} : { name: "Pengguna" }),
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
    // The jwt plugin's own /token (a JWT for a session) is not wanted; the OAuth token endpoint is /oauth2/token.
    disabledPaths: ["/token"],
    plugins: [expo(), androidAccountChooser(), devLogin(Boolean(env.DEV_LOGIN)), ...mcpPlugins(env)],
  });
}
