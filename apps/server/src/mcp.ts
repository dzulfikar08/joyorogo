import type { JoyoAuth } from "@joyorogo/auth";
import { MCP_DATA_SCOPES, MCP_PATH } from "@joyorogo/auth/mcp-scopes";
import type { McpDataScope } from "@joyorogo/auth/mcp-scopes";
import { McpAuthError, verifyMcpAccessToken } from "@joyorogo/auth/mcp-token";
import type { McpPrincipal } from "@joyorogo/auth/mcp-token";
import {
  FIT_LIMITS,
  FitDataError,
  getDailyTotals,
  getFoodLog,
  getProfileView,
  getRecoveryDays,
  getStrengthSessionView,
  getWatchWorkoutView,
  getWeightView,
  listWorkouts,
  parseWorkoutRef,
  resolveRange,
} from "@joyorogo/api/lib/fit-data";
import type { RateLimitBinding } from "@joyorogo/api/lib/group-preview";
import { countCalls, hasActiveConnection, writeAudit } from "@joyorogo/api/lib/mcp-connections";
import type { AuditEntry } from "@joyorogo/api/lib/mcp-connections";
import type { StickersBucket } from "@joyorogo/api/lib/sticker";
import { zoneOfUser } from "@joyorogo/api/lib/user-zone";
import type { PaywallEnv } from "@joyorogo/api/lib/tiers";
import { cloudUnlocked } from "@joyorogo/api/lib/watch-workout-store";
import type { Database } from "@joyorogo/db";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Context, Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

export type McpEnv = PaywallEnv & {
  BETTER_AUTH_URL: string;
  APP_URL?: string;
  /** Marketing site origin (pricing page); defaults to APP_URL. */
  SITE_URL?: string;
  /** Per-user budget of tool calls per minute (wrangler `ratelimits`); unset = no per-minute limit. */
  MCP_LIMITER?: RateLimitBinding;
  /** Per-IP budget of dynamic client registrations; unset = no limit. */
  OAUTH_REGISTER_LIMITER?: RateLimitBinding;
  /** Tool calls per account per rolling 24 hours; empty = 1000. */
  MCP_DAILY_CAP?: string;
};

export type McpDeps = {
  env: McpEnv;
  getDb: () => Database;
  createAuth: () => Promise<JoyoAuth>;
  bucket: () => StickersBucket | undefined;
};

const DEFAULT_DAILY_CAP = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Who may read what they asked for: the connector is a Pro feature (docs/mcp-connector.md). */
const MCP_INSTRUCTIONS = [
  "JoyoRogo gives read-only access to ONE person's own health diary: what they ate, their weight, their workouts (JoyoFit watch and gym sessions), sleep and recovery, and their goals.",
  "Everything is private to that person; never mix it with anyone else's data. Nothing here can change the account.",
  "Days are calendar days in the person's own zone (WIB, UTC+7, in Indonesia; UTC+8 in Malaysia and Singapore) as YYYY-MM-DD; get_profile returns today's date. Units are in the field names: Kcal, G, Kg, Cm, Bpm, Min, Sec, Km.",
  "A day with no food logged is a skipped log, not a day of fasting. Do not read missing values as zero.",
  "profile.mode is lose, maintain, gain or hamil (pregnant or breastfeeding: no deficit and no weight target; never suggest weight loss).",
  "This is not medical advice. For pain, pregnancy, eating disorders or any medical question, point the person to a doctor.",
].join("\n");

const dayArg = (what: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
    .optional()
    .describe(what);

function text(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function failure(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

const appOrigin = (env: McpEnv) => (env.APP_URL || env.BETTER_AUTH_URL).replace(/\/$/, "");
const siteOrigin = (env: McpEnv) => (env.SITE_URL ? env.SITE_URL.replace(/\/$/, "") : appOrigin(env));

const upsell = (env: McpEnv) =>
  `JoyoRogo Pro dibutuhkan untuk memakai koneksi AI. Upgrade di ${siteOrigin(env)}/harga, lalu tanya lagi (tidak perlu menyambung ulang).\n` +
  `JoyoRogo Pro is required to use the AI connection. Upgrade at ${siteOrigin(env)}/harga, then ask again (no need to reconnect).`;

/** The one place a tool call is checked, limited, run and logged. */
async function runTool(
  deps: McpDeps,
  principal: McpPrincipal,
  tool: string,
  scope: McpDataScope,
  args: unknown,
  waitUntil: (promise: Promise<unknown>) => void,
  work: (db: Database) => Promise<unknown>,
): Promise<CallToolResult> {
  const db = deps.getDb();
  const started = Date.now();
  const log = (outcome: AuditEntry["outcome"]) =>
    waitUntil(
      writeAudit(db, { userId: principal.userId, clientId: principal.clientId, tool, args, outcome, ms: Date.now() - started }).catch(
        (error: unknown) => console.error("[mcp] audit write failed", error),
      ),
    );

  if (deps.env.MCP_LIMITER) {
    const { success } = await deps.env.MCP_LIMITER.limit({ key: `mcp:${principal.userId}` });
    // Not logged: a client hammering the endpoint must not turn into a flood of audit rows.
    if (!success) return failure("Terlalu banyak permintaan dalam waktu singkat. Tunggu satu menit lalu coba lagi. / Too many requests; wait a minute and try again.");
  }
  if (!principal.scopes.includes(scope)) {
    log("scope");
    return failure(
      `Koneksi ini belum diberi izin "${scope}". Hubungkan ulang JoyoRogo di aplikasi AI-mu dan setujui izin itu. / This connection lacks the "${scope}" permission; reconnect JoyoRogo in your AI app and approve it.`,
    );
  }
  if (!(await cloudUnlocked(db, deps.env, principal.userId))) {
    log("not_pro");
    return failure(upsell(deps.env));
  }
  const cap = Number(deps.env.MCP_DAILY_CAP) > 0 ? Number(deps.env.MCP_DAILY_CAP) : DEFAULT_DAILY_CAP;
  if ((await countCalls(db, principal.userId, started - DAY_MS)) >= cap) {
    log("rate_limited");
    return failure(`Batas ${cap} pemanggilan per 24 jam tercapai. Coba lagi nanti. / Daily limit of ${cap} calls reached; try again later.`);
  }
  try {
    const result = text(await work(db));
    log("ok");
    return result;
  } catch (error) {
    log("error");
    if (error instanceof FitDataError) return failure(error.message);
    console.error(`[mcp] ${tool} failed`, error);
    return failure("Terjadi kesalahan di server JoyoRogo. Coba lagi sebentar lagi. / JoyoRogo had an error; try again in a moment.");
  }
}

/** A fresh MCP server per request (stateless transport); every tool closes over the verified principal. */
function createMcpServer(
  deps: McpDeps,
  principal: McpPrincipal,
  waitUntil: (promise: Promise<unknown>) => void,
): McpServer {
  const server = new McpServer(
    { name: "joyorogo", title: "JoyoRogo", version: "1.0.0", websiteUrl: siteOrigin(deps.env) },
    { instructions: MCP_INSTRUCTIONS },
  );
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
  const run = (tool: string, scope: McpDataScope, args: unknown, work: (db: Database) => Promise<unknown>) =>
    runTool(deps, principal, tool, scope, args, waitUntil, work);

  server.registerTool(
    "get_profile",
    {
      title: "Profile, goal and daily targets",
      description:
        "The person's profile and plan: today's date (in the person's zone), mode (lose, maintain, gain, or hamil = pregnant/breastfeeding), age, gender, height, current/start/target weight and target date, and the daily targets (eat kcal, burn kcal, BMR, TDEE, protein g, sleep hours). Call this first to learn today's date and the goal. Units: kcal, g, kg, cm, hours.",
      inputSchema: {},
      annotations: readOnly,
    },
    () => run("get_profile", "profile:read", {}, async (db) => getProfileView(db, principal.userId, await zoneOfUser(db, principal.userId))),
  );

  server.registerTool(
    "get_food_log",
    {
      title: "Food log by date range",
      description: `Every food item logged in a date range, grouped by day and ordered by meal: name, meal (sarapan, makan_siang, makan_malam, snack, sahur, berbuka), kcal, protein/carbs/fat/fiber in grams, portion grams when known, and source (ai = photo scan, manual). Days without entries are omitted (a skipped log, not a fast). Dates are YYYY-MM-DD in the person's zone; default is today only; at most ${FIT_LIMITS.foodDays} days per call. Use get_daily_totals for long ranges.`,
      inputSchema: {
        from: dayArg("First day, YYYY-MM-DD. Default: same as `to`."),
        to: dayArg("Last day, YYYY-MM-DD. Default: today."),
      },
      annotations: readOnly,
    },
    ({ from, to }) =>
      run("get_food_log", "food:read", { from, to }, async (db) => {
        const zone = await zoneOfUser(db, principal.userId);
        const range = resolveRange(from, to, { maxDays: FIT_LIMITS.foodDays, defaultDays: 1, zone });
        return { from: range.from, to: range.to, days: await getFoodLog(db, principal.userId, range.from, range.to) };
      }),
  );

  server.registerTool(
    "get_daily_totals",
    {
      title: "Daily totals against targets",
      description: `One row per day of a range: eaten kcal and macros (g), meals logged, logged exercise kcal (Strava excluded), steps, activeKcal (the activity that counts that day: the watch's all-day active energy, or Health Connect / Apple Health's, with logged workouts that are not already inside it; activeSource says where the all-day figure came from), exerciseAddedKcal (the part of it that goes beyond the movement already inside the person's activity factor, added to that day's budget under their own \"Kalori olahraga\" settings, returned as exerciseAddBack; activity below the factor adds nothing) and kcal remaining against the eat target plus exerciseAddedKcal, plus the current targets and the average of the logged days. The targets are today's plan applied to every day of the range. Days with nothing logged have logged=false and null totals. Dates are YYYY-MM-DD in the person's zone; default is the last 7 days; at most ${FIT_LIMITS.totalsDays} days.`,
      inputSchema: {
        from: dayArg("First day, YYYY-MM-DD. Default: 6 days before `to`."),
        to: dayArg("Last day, YYYY-MM-DD. Default: today."),
      },
      annotations: readOnly,
    },
    ({ from, to }) =>
      run("get_daily_totals", "food:read", { from, to }, async (db) => {
        const zone = await zoneOfUser(db, principal.userId);
        const range = resolveRange(from, to, { maxDays: FIT_LIMITS.totalsDays, defaultDays: 7, zone });
        return getDailyTotals(db, principal.userId, range.from, range.to, zone);
      }),
  );

  server.registerTool(
    "get_weight_history",
    {
      title: "Weight history and goal",
      description: `Weigh-ins (kg) in a date range with the latest weigh-in, the goal (mode, start/target kg, target date, kg remaining), the smoothed trend (kg per week, projected date to reach the target) and waist circumference (cm) entries. Dates are YYYY-MM-DD in the person's zone; default is the last 90 days; at most ${FIT_LIMITS.weightDays} days.`,
      inputSchema: {
        from: dayArg("First day, YYYY-MM-DD. Default: 89 days before `to`."),
        to: dayArg("Last day, YYYY-MM-DD. Default: today."),
      },
      annotations: readOnly,
    },
    ({ from, to }) =>
      run("get_weight_history", "weight:read", { from, to }, async (db) => {
        const zone = await zoneOfUser(db, principal.userId);
        const range = resolveRange(from, to, { maxDays: FIT_LIMITS.weightDays, defaultDays: 90, zone });
        return getWeightView(db, principal.userId, range.from, range.to, zone);
      }),
  );

  server.registerTool(
    "list_workouts",
    {
      title: "Workouts list",
      description: `Workouts in a date range, newest first: JoyoFit watch workouts (run, walk, ride, swim, other: duration min, distance km, heart rate bpm, kcal) and gym strength sessions (exercises, sets, volume kg). Each item has an id to pass to get_workout. Dates are YYYY-MM-DD in the person's zone; default is the last 30 days; at most ${FIT_LIMITS.workoutDays} days; limit up to ${FIT_LIMITS.workoutItems} items.`,
      inputSchema: {
        from: dayArg("First day, YYYY-MM-DD. Default: 29 days before `to`."),
        to: dayArg("Last day, YYYY-MM-DD. Default: today."),
        limit: z.number().int().min(1).max(FIT_LIMITS.workoutItems).optional().describe("Maximum items (default 20)."),
      },
      annotations: readOnly,
    },
    ({ from, to, limit }) =>
      run("list_workouts", "workouts:read", { from, to, limit }, async (db) => {
        const zone = await zoneOfUser(db, principal.userId);
        const range = resolveRange(from, to, { maxDays: FIT_LIMITS.workoutDays, defaultDays: 30, zone });
        return {
          from: range.from,
          to: range.to,
          workouts: await listWorkouts(db, principal.userId, range.from, range.to, limit ?? 20, zone),
        };
      }),
  );

  server.registerTool(
    "get_workout",
    {
      title: "Workout detail",
      description:
        "One workout by id (from list_workouts). A watch workout (id watch:<start>) returns the analysis summary: duration, distance (km), elevation (m), heart-rate stats and time in zones 1-5 (seconds), pace zones, best efforts, effort/strain (0-21) and training load (acute vs chronic, recovery hours), km splits and laps, and similar earlier workouts. A strength session (id strength:<id>) returns exercises with sets (reps, kg, seconds, RPE) and total volume (kg). GPS routes and per-second series are not included.",
      inputSchema: { id: z.string().min(3).max(80).describe("Workout id from list_workouts, e.g. watch:1790000000 or strength:<id>.") },
      annotations: readOnly,
    },
    ({ id }) =>
      run("get_workout", "workouts:read", { id }, async (db) => {
        const zone = await zoneOfUser(db, principal.userId);
        const ref = parseWorkoutRef(id);
        if (!ref) throw new FitDataError("not_found", `"${id}" is not a workout id; take one from list_workouts.`);
        if (ref.kind === "strength") return getStrengthSessionView(db, principal.userId, ref.id, zone);
        const bucket = deps.bucket();
        if (!bucket) throw new FitDataError("unavailable", "Workout storage is not available right now.");
        return getWatchWorkoutView(db, bucket, principal.userId, ref.start, zone);
      }),
  );

  server.registerTool(
    "get_recovery_metrics",
    {
      title: "Sleep, recovery, readiness and body metrics",
      description: `Per day, newest first (days with no data are omitted): hours slept, sleep as % of the need, recovery % (HRV vs own baseline), strain (0-21), readiness word (Primed, Balanced, Strained, Run down), resting heart rate bpm, HRV ms and status, VO2max (ml/kg/min), training status and load ratio, recovery hours left, steps, distance km, active kcal and exercise minutes. Needs a JoyoFit watch or Health Connect / Apple Health sync; fields the person's devices do not provide are null. Dates are YYYY-MM-DD in the person's zone; default is the last 14 days; at most ${FIT_LIMITS.recoveryDays} days.`,
      inputSchema: {
        from: dayArg("First day, YYYY-MM-DD. Default: 13 days before `to`."),
        to: dayArg("Last day, YYYY-MM-DD. Default: today."),
      },
      annotations: readOnly,
    },
    ({ from, to }) =>
      run("get_recovery_metrics", "recovery:read", { from, to }, async (db) => {
        const zone = await zoneOfUser(db, principal.userId);
        const range = resolveRange(from, to, { maxDays: FIT_LIMITS.recoveryDays, defaultDays: 14, zone });
        return { from: range.from, to: range.to, days: await getRecoveryDays(db, principal.userId, range.from, range.to) };
      }),
  );

  return server;
}

function challenge(env: McpEnv, status: 401 | 403, code: "missing_token" | "invalid_token" | "revoked", description: string): Response {
  const resourceMetadata = `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/.well-known/oauth-protected-resource${MCP_PATH}`;
  const params = [`resource_metadata="${resourceMetadata}"`, `scope="${MCP_DATA_SCOPES.join(" ")}"`];
  if (code !== "missing_token") params.push('error="invalid_token"', `error_description="${description.replaceAll('"', "'")}"`);
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: description }, id: null }), {
    status,
    headers: { "Content-Type": "application/json", "WWW-Authenticate": `Bearer ${params.join(", ")}`, "Cache-Control": "no-store" },
  });
}

/** CORS for the endpoints a browser-based MCP client (Inspector, web connectors) calls without our cookies. */
export function registerMcpPublicCors(app: Hono) {
  const open = cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Accept", "MCP-Protocol-Version", "Mcp-Session-Id", "Last-Event-ID"],
    exposeHeaders: ["WWW-Authenticate", "Mcp-Session-Id"],
    credentials: false,
    maxAge: 600,
  });
  for (const path of [
    MCP_PATH,
    "/.well-known/*",
    "/api/auth/oauth2/register",
    "/api/auth/oauth2/token",
    "/api/auth/oauth2/revoke",
    "/api/auth/jwks",
  ]) {
    app.use(path, open);
  }
}

export function registerMcpRoutes(app: Hono, deps: McpDeps) {
  const waitUntilOf = (c: Context) => (promise: Promise<unknown>) => {
    try {
      c.executionCtx.waitUntil(promise);
    } catch {
      // No execution context (tests): the promise still runs.
      void promise;
    }
  };

  // Dynamic client registration needs no account, so it gets a per-IP budget.
  app.use("/api/auth/oauth2/register", async (c, next) => {
    const limiter = deps.env.OAUTH_REGISTER_LIMITER;
    if (limiter && c.req.method === "POST") {
      const { success } = await limiter.limit({ key: `register:${c.req.header("CF-Connecting-IP") ?? "unknown"}` });
      if (!success) return c.json({ error: "temporarily_unavailable", error_description: "Too many registrations; try again in a minute." }, 429);
    }
    await next();
  });

  // Discovery documents (RFC 9728 for the resource, RFC 8414 / OIDC for the issuer at /api/auth) are served by the
  // auth handler; clients that look for the issuer metadata at the origin root get the same document.
  app.on(["GET", "HEAD"], "/.well-known/*", async (c) => {
    const auth = await deps.createAuth();
    const url = new URL(c.req.url);
    if (url.pathname === "/.well-known/oauth-authorization-server" || url.pathname === "/.well-known/openid-configuration") {
      url.pathname = `${url.pathname}/api/auth`;
      return auth.handler(new Request(url, c.req.raw));
    }
    return auth.handler(c.req.raw);
  });

  app.all(MCP_PATH, async (c) => {
    const { env } = deps;
    const auth = await deps.createAuth();
    let principal: McpPrincipal;
    try {
      principal = await verifyMcpAccessToken(auth, c.req.raw, env.BETTER_AUTH_URL);
    } catch (error) {
      if (error instanceof McpAuthError) return challenge(env, 401, error.code, error.message);
      throw error;
    }
    // A JWT cannot be revoked, so the consent is looked up on every request: revoking a connection works at once.
    if (!(await hasActiveConnection(deps.getDb(), principal.userId, principal.clientId))) {
      return challenge(env, 401, "revoked", "This connection was revoked. Connect JoyoRogo again.");
    }
    // Stateless server without a server-to-client stream: GET (SSE) and DELETE (end session) have nothing to do.
    if (c.req.method !== "POST") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }), {
        status: 405,
        headers: { "Content-Type": "application/json", Allow: "POST" },
      });
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error." }, id: null }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const server = createMcpServer(deps, principal, waitUntilOf(c));
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const response = await transport.handleRequest(c.req.raw, { parsedBody: body });
    response.headers.set("Cache-Control", "no-store");
    return response;
  });
}
