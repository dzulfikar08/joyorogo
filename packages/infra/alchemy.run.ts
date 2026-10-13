import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import "varlock/auto-load";

// Alchemy rejects drizzle-kit's meta/_journal.json (v0 layout) and drizzle-kit
// v1 is unreleased, so deploys consume a flat mirror of the .sql files.
// db:generate refreshes the mirror after every generate.
export const db = Cloudflare.D1.Database("database", {
  migrations: "../../packages/db/migrations-deploy",
});

export const server = Cloudflare.Worker("server", {
  main: "../../apps/server/src/index.ts",
  // Same registrable domain as the web app so the OAuth state cookie is
  // first-party; workers.dev is cross-site and browsers drop it.
  domain: "api.joyorogo.com",
  // Puasa intermiten Web Push reminders; the scheduled handler no-ops while
  // VAPID_* is unset.
  crons: ["*/5 * * * *"],
  compatibility: {
    flags: ["nodejs_compat"],
  },
  env: {
    DB: db,
    AI: Cloudflare.Workers.AI(),
    CORS_ORIGIN: Config.string("CORS_ORIGIN"),
    BETTER_AUTH_SECRET: Config.redacted("BETTER_AUTH_SECRET"),
    BETTER_AUTH_URL: Cloudflare.Worker.URL,
    GOOGLE_CLIENT_ID: Config.string("GOOGLE_CLIENT_ID").pipe(Config.withDefault("")),
    GOOGLE_CLIENT_SECRET: Config.redacted("GOOGLE_CLIENT_SECRET").pipe(Config.withDefault("")),
    DEV_LOGIN: Config.string("DEV_LOGIN").pipe(Config.withDefault("")),
    AI_VISION_MODEL: Config.string("AI_VISION_MODEL").pipe(
      Config.withDefault("@cf/google/gemma-4-26b-a4b-it"),
    ),
    STRAVA_CLIENT_ID: Config.string("STRAVA_CLIENT_ID").pipe(Config.withDefault("")),
    STRAVA_CLIENT_SECRET: Config.redacted("STRAVA_CLIENT_SECRET").pipe(Config.withDefault("")),
  },
  dev: {
    // DEV_PORT override lets the worker dodge other local dev servers
    port: Number(process.env.DEV_PORT ?? 3000),
  },
});

export type ServerEnv = Cloudflare.InferEnv<typeof server>;

export default Alchemy.Stack(
  "joyorogo",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const serverWorker = yield* server;
    const webWorker = yield* Cloudflare.Website.Vite("web", {
      rootDir: "../../apps/web",
      domain: "joyorogo.com",
      assets: {
        htmlHandling: "auto-trailing-slash",
        notFoundHandling: "single-page-application",
      },
      env: {
        VITE_SERVER_URL: serverWorker.url.as<string>(),
      },
      dev: {
        port: 3001,
      },
    });

    return {
      web: webWorker.url,
      server: serverWorker.url,
    };
  }),
);
