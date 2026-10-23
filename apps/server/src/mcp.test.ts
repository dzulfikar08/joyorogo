import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { d1TestDb } from "@joyorogo/db/test-d1";
import { createAuth } from "@joyorogo/auth";
import { MCP_DATA_SCOPES } from "@joyorogo/auth/mcp-scopes";
import { deleteUserMcpData, listConnections, recentActivity, revokeConnection, sweepMcp } from "@joyorogo/api/lib/mcp-connections";
import { jakartaToday, shiftDate } from "@joyorogo/api/lib/engine";
import type { StickersBucket } from "@joyorogo/api/lib/sticker";
import { WATCH_WORKOUT_DOC_VERSION, encodePoints } from "@joyorogo/api/lib/watch-workout";
import type { WatchWorkoutDoc } from "@joyorogo/api/lib/watch-workout";
import { putWorkout } from "@joyorogo/api/lib/watch-workout-store";
import type { WorkoutAnalysis } from "@joyorogo/api/lib/workout-analysis";
import { exerciseLog, foodLog, profile, sleepLog, weightLog } from "@joyorogo/db/schema/fitness";
import { fitnessScore } from "@joyorogo/db/schema/joyofit";
import { coachDoc } from "@joyorogo/db/schema/coach";
import { sleepInsightPref, sleepNight } from "@joyorogo/db/schema/sleep-insights";
import { mcpAudit } from "@joyorogo/db/schema/oauth";
import { workoutSession, workoutSet } from "@joyorogo/db/schema/plans";

import { registerMcpPublicCors, registerMcpRoutes } from "./mcp";
import type { McpEnv } from "./mcp";

const BASE = "https://api.test";
const APP = "https://app.test";
const RESOURCE = `${BASE}/mcp`;
const PASSWORD = "correct-horse-battery-staple-91";
const REDIRECT = "http://127.0.0.1:33418/callback";
/** Everything the pro user holds is on this WIB day; the watch workout started at 12:00 WIB of it. */
const DAY = "2026-10-14";
const START = Date.parse(`${DAY}T05:00:00Z`) / 1000;

const { client, db } = await d1TestDb();

const authEnv = {
  BETTER_AUTH_URL: BASE,
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
  CORS_ORIGIN: APP,
  APP_URL: APP,
  GOOGLE_CLIENT_ID: "x",
  GOOGLE_CLIENT_SECRET: "x",
  REVIEW_LOGIN_EMAILS: "pro@test.id,free@test.id,other@test.id",
};
const auth = createAuth(authEnv, db);
const ctx = await auth.$context;

const objects = new Map<string, ArrayBuffer>();
const bucket: StickersBucket = {
  async put(key, value) {
    objects.set(key, value as ArrayBuffer);
  },
  async get(key) {
    const body = objects.get(key);
    return body ? { body: new Blob([body]).stream(), size: body.byteLength, arrayBuffer: async () => body } : null;
  },
  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
  },
  async list({ prefix }) {
    return { objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false };
  },
};

const limiterCalls: string[] = [];
let limiterOpen = true;
const SITE = "https://site.test";
const env: McpEnv = {
  BETTER_AUTH_URL: BASE,
  APP_URL: APP,
  SITE_URL: SITE,
  FREE_DAILY_SCANS: "3",
  MCP_LIMITER: {
    async limit({ key }) {
      limiterCalls.push(key);
      return { success: limiterOpen };
    },
  },
};

const app = new Hono();
registerMcpPublicCors(app);
registerMcpRoutes(app, { env, getDb: () => db, createAuth: async () => auth, bucket: () => bucket });
app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const analysis: WorkoutAnalysis = {
  v: 1,
  sport: { name: "Lari", kind: "run" },
  startedAt: START * 1000,
  elapsedSec: 1800,
  movingSec: 1780,
  distanceM: 5000,
  elevation: { gainM: 30, lossM: 28, minM: 10, maxM: 40 },
  series: null,
  splits: [{ n: 1, distM: 1000, sec: 360, paceSecKm: 360, hr: 150, gainM: 6, lossM: 5, cad: 168 }],
  laps: [],
  hrZones: { maxHr: 190, source: "age", bounds: [95, 114, 133, 152, 171, 190], sec: [60, 300, 900, 500, 40], belowSec: 0 },
  paceZones: null,
  bestEfforts: [{ key: "1k", sec: 330, atM: 2000, rank: 2 }],
  effort: { strain: 11.2, trimp: 85, band: "moderate", addedToDay: 9 },
  load: { trimp: 85, acute: 300, chronicWeekly: 250, ratio: 1.2, watchLoad: null, aerobicEffect: 3.1, anaerobicEffect: 0.4, recoveryHours: 24 },
  calories: { kcal: 380, fatG: null, carbG: null },
  comparison: null,
  stats: {
    avgHr: 150,
    maxHr: 172,
    minHr: 90,
    avgPaceSecKm: 360,
    bestPaceSecKm: 330,
    avgSpeedMs: 2.8,
    maxSpeedMs: 3.4,
    avgCad: 168,
    maxCad: 180,
    avgPower: null,
    maxPower: null,
    normalizedPower: null,
    avgStrideM: null,
  },
};
const watchDoc: WatchWorkoutDoc = {
  v: WATCH_WORKOUT_DOC_VERSION,
  engineRev: 2,
  workout: {
    workoutNumber: 3,
    start: START,
    end: START + 1800,
    sportType: 1,
    sportName: "Lari",
    duration: 1780,
    distance: 5000,
    calories: 380,
    avgHr: 150,
    maxHr: 172,
    steps: 5000,
    complete: true,
    imported: false,
    summaryJson: "{}",
  },
  points: encodePoints([{ ts: START, lat: -7.98, lon: 112.63, alt: 450, hr: 98, speed: 2, cadence: 160, stride: 1, power: null }]),
  analysis,
};

async function seedUser(id: string, tier: "free" | "founder") {
  await client.execute({
    sql: `INSERT INTO "user" (id, name, email, tier, email_verified) VALUES (?, ?, ?, ?, 1)`,
    args: [id, id, `${id}@test.id`, tier],
  });
  await ctx.internalAdapter.linkAccount({ userId: id, accountId: id, providerId: "credential", password: await ctx.password.hash(PASSWORD) });
}

await seedUser("pro", "founder");
await seedUser("free", "free");
await seedUser("other", "founder");

await db.insert(profile).values({
  userId: "pro",
  birthYear: 1990,
  gender: "male",
  heightCm: 172,
  startWeightKg: 82,
  targetWeightKg: 72,
  targetDate: "2027-03-01",
  activityLevel: "light",
});
await db.insert(weightLog).values([
  { id: "w1", userId: "pro", date: "2026-10-01", weightKg: 81.4 },
  { id: "w2", userId: "pro", date: DAY, weightKg: 80.2 },
]);
await db.insert(foodLog).values([
  { id: "f1", userId: "pro", date: DAY, meal: "sarapan", name: "Nasi uduk", kcal: 450, protein: 12, carbs: 70, fat: 14 },
  { id: "f2", userId: "pro", date: DAY, meal: "makan_siang", name: "Soto ayam", kcal: 380, protein: 28, carbs: 30, fat: 12 },
]);
await db.insert(exerciseLog).values([
  { id: "e1", userId: "pro", date: DAY, name: "Lari", kcal: 300, source: "manual" },
  { id: "e2", userId: "pro", date: DAY, name: "Strava ride", kcal: 700, source: "strava", externalId: "1" },
]);
await db.insert(sleepLog).values({ id: "s1", userId: "pro", date: "2026-10-13", hours: 7.25, source: "health_connect" });
await db.insert(fitnessScore).values({
  id: "fs1",
  userId: "pro",
  date: DAY,
  recoveryPct: 62,
  strain: 9.5,
  sleepPct: 96,
  readiness: "Balanced",
  restingHr: 54,
  hrvMs: 48.2,
  hrvStatus: "balanced",
  vo2max: 47.5,
  trainingStatus: "productive",
  loadRatio: 1.12,
  recoveryHours: 18,
});
await db.insert(workoutSession).values({ id: "ses-12345678", userId: "pro", date: DAY, name: "Push day", durationMin: 55 });
await db.insert(workoutSet).values([
  { id: "set1", sessionId: "ses-12345678", userId: "pro", exerciseId: "bench_press", position: 0, reps: 8, weightKg: 60, setType: "normal" },
  { id: "set2", sessionId: "ses-12345678", userId: "pro", exerciseId: "bench_press", position: 1, reps: 8, weightKg: 62.5, setType: "normal", rpe: 8 },
]);
await putWorkout(db, bucket, "pro", START, await gzip(JSON.stringify(watchDoc)));

interface Session {
  cookie: string;
}

async function signIn(email: string): Promise<Session> {
  const res = await auth.handler(
    new Request(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );
  expect(res.status).toBe(200);
  return {
    cookie: res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}

const b64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

/** Registers a client and runs authorize + consent + token for the user. */
async function connect(email: string, scope = MCP_DATA_SCOPES.join(" ")) {
  const session = await signIn(email);
  const reg = await app.request("/api/auth/oauth2/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Claude",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  expect(reg.status).toBeLessThan(300);
  const { client_id: clientId } = (await reg.json()) as { client_id: string };
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const authorize = await app.request(
    `/api/auth/oauth2/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "s",
      scope,
      resource: RESOURCE,
    })}`,
    { headers: { cookie: session.cookie }, redirect: "manual" },
  );
  expect(authorize.status).toBe(302);
  const consentUrl = new URL(authorize.headers.get("location") ?? "");
  expect(consentUrl.origin + consentUrl.pathname).toBe(`${APP}/koneksi/izin`);
  // The page names the app before sign-in: the signed query is the key to the prelogin lookup.
  const prelogin = await app.request("/api/auth/oauth2/public-client-prelogin", {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP },
    body: JSON.stringify({ client_id: clientId, oauth_query: consentUrl.search.slice(1) }),
  });
  expect(prelogin.status).toBe(200);
  expect(await prelogin.json()).toMatchObject({ client_id: clientId, client_name: "Claude" });
  const forged = await app.request("/api/auth/oauth2/public-client-prelogin", {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP },
    body: JSON.stringify({ client_id: clientId, oauth_query: `${consentUrl.search.slice(1)}&x=1` }),
  });
  expect(forged.status).toBe(400);
  const consent = await app.request("/api/auth/oauth2/consent", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: session.cookie, origin: APP },
    body: JSON.stringify({ accept: true, oauth_query: consentUrl.search.slice(1) }),
  });
  expect(consent.status).toBe(200);
  const done = (await consent.json()) as { url: string };
  const code = new URL(done.url).searchParams.get("code") ?? "";
  const tokenRes = await app.request("/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: REDIRECT,
      resource: RESOURCE,
    }),
  });
  expect(tokenRes.status).toBe(200);
  const tokens = (await tokenRes.json()) as { access_token: string; refresh_token: string };
  return { clientId, accessToken: tokens.access_token, refreshToken: tokens.refresh_token };
}

let rpcId = 0;
async function rpc(token: string | null, method: string, params?: unknown) {
  const res = await app.request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, ...(params === undefined ? {} : { params }) }),
  });
  return res;
}

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}

async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await rpc(token, "tools/call", { name, arguments: args });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { result?: ToolResult; error?: { message: string } };
  if (!body.result) throw new Error(body.error?.message ?? "no result");
  const text = body.result.content[0]?.text ?? "";
  return { isError: body.result.isError === true, text, data: body.result.isError ? null : JSON.parse(text) };
}

describe("MCP endpoint", () => {
  test("a request without a token gets the RFC 9728 challenge, a bad token an invalid_token one", async () => {
    const none = await rpc(null, "tools/list");
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toContain(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`);
    const bad = await rpc("not.a.jwt", "tools/list");
    expect(bad.status).toBe(401);
    expect(bad.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(none.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("discovery is served through the auth handler, also at the origin root", async () => {
    const prm = await app.request("/.well-known/oauth-protected-resource/mcp");
    expect(((await prm.json()) as { resource: string }).resource).toBe(RESOURCE);
    const root = await app.request("/.well-known/oauth-authorization-server");
    expect(((await root.json()) as { issuer: string }).issuer).toBe(`${BASE}/api/auth`);
  });

  test("a Pro account connects, lists the tools and reads every kind of data", async () => {
    const { accessToken } = await connect("pro@test.id");

    const init = await rpc(accessToken, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.status).toBe(200);
    const initBody = (await init.json()) as { result: { serverInfo: { name: string }; instructions: string } };
    expect(initBody.result.serverInfo.name).toBe("joyorogo");
    expect(initBody.result.instructions).toContain("WIB");

    const list = await rpc(accessToken, "tools/list");
    const tools = ((await list.json()) as { result: { tools: { name: string; annotations: { readOnlyHint: boolean }; description: string }[] } }).result.tools;
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_daily_totals",
      "get_food_log",
      "get_plan",
      "get_profile",
      "get_recovery_metrics",
      "get_sleep_findings",
      "get_sleep_nights",
      "get_weight_history",
      "get_workout",
      "list_workouts",
    ]);
    for (const tool of tools) {
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.description.length).toBeGreaterThan(60);
    }

    const profileResult = await callTool(accessToken, "get_profile");
    expect(profileResult.data).toMatchObject({ hasProfile: true, mode: "lose", heightCm: 172, weight: { startKg: 82, targetKg: 72 } });
    expect(profileResult.data.dailyTargets.eatKcal).toBeGreaterThan(1000);

    const food = await callTool(accessToken, "get_food_log", { from: DAY, to: DAY });
    expect(food.data.days).toHaveLength(1);
    expect(food.data.days[0]).toMatchObject({ date: DAY, totalKcal: 830 });
    expect(food.data.days[0].items.map((i: { name: string }) => i.name)).toEqual(["Nasi uduk", "Soto ayam"]);

    const totals = await callTool(accessToken, "get_daily_totals", { from: "2026-10-13", to: DAY });
    expect(totals.data.days).toHaveLength(2);
    expect(totals.data.days[0]).toMatchObject({ date: "2026-10-13", logged: false, eatenKcal: null });
    // The Strava ride never shows: 300 manual kcal only.
    expect(totals.data.days[1]).toMatchObject({ date: DAY, logged: true, eatenKcal: 830, exerciseKcal: 300 });
    expect(totals.data.targets.eatKcal).toBeGreaterThan(1000);

    const weight = await callTool(accessToken, "get_weight_history", { from: "2026-09-01", to: DAY });
    expect(weight.data.entries).toEqual([
      { date: "2026-10-01", weightKg: 81.4 },
      { date: DAY, weightKg: 80.2 },
    ]);
    expect(weight.data.goal).toMatchObject({ mode: "lose", startKg: 82, targetKg: 72, remainingKg: -8.2 });

    const workouts = await callTool(accessToken, "list_workouts", { from: DAY, to: DAY });
    const ids = workouts.data.workouts.map((w: { id: string }) => w.id);
    expect(ids).toContain(`watch:${START}`);
    expect(ids).toContain("strength:ses-12345678");

    const watch = await callTool(accessToken, "get_workout", { id: `watch:${START}` });
    expect(watch.data).toMatchObject({ sport: { kind: "run" }, distanceKm: 5, hasAnalysis: true });
    expect(watch.data.hrZones.secInZone).toEqual([60, 300, 900, 500, 40]);
    expect(watch.data.load.ratio).toBe(1.2);
    expect(JSON.stringify(watch.data)).not.toContain("track");

    const strength = await callTool(accessToken, "get_workout", { id: "strength:ses-12345678" });
    expect(strength.data).toMatchObject({ name: "Push day", totalVolumeKg: 8 * 60 + 8 * 62.5 });
    expect(strength.data.exercises[0]).toMatchObject({ name: "Bench press" });
    expect(strength.data.exercises[0].sets).toHaveLength(2);

    const recovery = await callTool(accessToken, "get_recovery_metrics", { from: "2026-10-10", to: DAY });
    expect(recovery.data.days[0]).toMatchObject({
      date: DAY,
      sleepHours: 7.25,
      sleepSource: "health_connect",
      recoveryPct: 62,
      restingHrBpm: 54,
      hrvStatus: "balanced",
      vo2maxMlKgMin: 47.5,
      recoveryHoursLeft: 18,
    });

    // Every call is in the audit log, with the arguments and no data.
    const audit = await db.select().from(mcpAudit).where(eq(mcpAudit.userId, "pro"));
    expect(audit.length).toBeGreaterThanOrEqual(8);
    expect(audit.every((row) => row.outcome === "ok")).toBe(true);
    expect(audit.find((row) => row.tool === "get_food_log")?.args).toBe(JSON.stringify({ from: DAY, to: DAY }));
  });

  test("get_plan reads the coach plan; get_sleep_* need the sleep switch", async () => {
    const { accessToken } = await connect("pro@test.id");

    const none = await callTool(accessToken, "get_plan");
    expect(none.data).toMatchObject({ hasPlan: false, plan: null });

    const startDay = shiftDate(jakartaToday(), -8);
    const doc = {
      version: 1,
      plan: {
        id: "p1",
        kind: "run",
        goal: "run5k",
        level: "beginner",
        daysPerWeek: 3,
        setting: null,
        weekdays: [1, 3, 5],
        startDay,
        weeks: 8,
        createdAt: 1,
        updatedAt: 1,
        adjust: { "2": { scalePct: 85, reason: "low_recovery", at: 1 } },
      },
      planUpdatedAt: 1,
      done: {
        a: { workoutStart: 1790000000, at: Date.now() - 86_400_000, manual: false, skipped: false },
        b: { workoutStart: null, at: Date.now() - 2 * 86_400_000, manual: true, skipped: true },
        old: { workoutStart: null, at: 1, manual: true, skipped: false },
      },
      logs: {},
    };
    await db.insert(coachDoc).values({ userId: "pro", doc: JSON.stringify(doc), rev: 1, updatedAt: Date.now() });
    const plan = await callTool(accessToken, "get_plan");
    expect(plan.data.plan).toMatchObject({
      kind: "run",
      goal: "run5k",
      weekdays: [1, 3, 5],
      currentWeek: 2,
      currentWeekAdjust: { scalePct: 85, reason: "low_recovery" },
    });
    expect(plan.data.recent).toMatchObject({ done: 1, skipped: 1, doneWithWorkout: 1 });

    const off = await callTool(accessToken, "get_sleep_nights");
    expect(off.data.consent).toBe(false);
    expect(off.data.message).toContain("Sleep insights are switched off");
    expect((await callTool(accessToken, "get_sleep_findings")).data.consent).toBe(false);

    await db.insert(sleepInsightPref).values({ userId: "pro", enabled: true, consentVersion: 1, consentedAt: Date.now() });
    await db.insert(sleepNight).values({
      userId: "pro",
      wakeDate: DAY,
      onsetMs: Date.parse("2026-10-13T16:00:00Z"),
      wakeMs: Date.parse("2026-10-13T23:30:00Z"),
      tzOffsetMin: 420,
      asleepS: 7 * 3600,
      awakeS: 20 * 60,
      awakenings: 2,
      hasStages: true,
      deepS: 3600,
      remS: 5400,
      lightS: 18_000,
      watchScore: 81,
      hrvMs: 48.26,
      rhrBpm: 54,
      updatedAt: 1,
    });
    const nights = await callTool(accessToken, "get_sleep_nights", { from: "2026-10-10", to: DAY });
    expect(nights.data.consent).toBe(true);
    expect(nights.data.nights).toHaveLength(1);
    expect(nights.data.nights[0]).toMatchObject({
      date: DAY,
      asleepMin: 420,
      awakeMin: 20,
      awakenings: 2,
      stagesMin: { deep: 60, rem: 90, light: 300 },
      watchScore: 81,
      hrvMs: 48.3,
      restingHrBpm: 54,
      bedroom: null,
    });
    const findings = await callTool(accessToken, "get_sleep_findings");
    expect(findings.data).toMatchObject({ consent: true, findings: [] });

    const tooLong = await callTool(accessToken, "get_sleep_nights", { from: "2026-01-01", to: DAY });
    expect(tooLong.isError).toBe(true);
  });

  test("prompts are listed and carry no data, only questions that point at the read-only tools", async () => {
    const { accessToken } = await connect("pro@test.id");
    const list = await rpc(accessToken, "prompts/list");
    const prompts = ((await list.json()) as { result: { prompts: { name: string }[] } }).result.prompts.map((p) => p.name).sort();
    expect(prompts).toEqual(["plan_check", "sleep_check", "weekly_review", "why_tired", "workout_debrief"]);

    const get = async (name: string, args: Record<string, string> = {}) => {
      const res = await rpc(accessToken, "prompts/get", { name, arguments: args });
      const body = (await res.json()) as { result: { messages: { role: string; content: { text: string } }[] } };
      return body.result.messages[0]!;
    };
    const id = await get("weekly_review");
    expect(id.role).toBe("user");
    expect(id.content.text).toContain("Review minggu ini");
    expect(id.content.text).toContain("get_daily_totals");
    const en = await get("why_tired", { language: "en" });
    expect(en.content.text).toContain("not medical advice");
    expect(en.content.text).not.toMatch(/menstru|cycle|haid/i);
  });

  test("a bad range or id is a friendly tool error, not a crash", async () => {
    const { accessToken } = await connect("pro@test.id");
    const tooLong = await callTool(accessToken, "get_food_log", { from: "2026-01-01", to: DAY });
    expect(tooLong.isError).toBe(true);
    expect(tooLong.text).toContain("at most 31 days");
    const backwards = await callTool(accessToken, "get_daily_totals", { from: DAY, to: "2026-10-01" });
    expect(backwards.isError).toBe(true);
    const unknown = await callTool(accessToken, "get_workout", { id: "watch:1" });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain("No such workout");
  });

  test("someone else's workout is not reachable", async () => {
    const { accessToken } = await connect("other@test.id");
    const result = await callTool(accessToken, "get_workout", { id: `watch:${START}` });
    expect(result.isError).toBe(true);
    const listed = await callTool(accessToken, "list_workouts", { from: DAY, to: DAY });
    expect(listed.data.workouts).toEqual([]);
    const strength = await callTool(accessToken, "get_workout", { id: "strength:ses-12345678" });
    expect(strength.isError).toBe(true);
  });

  test("a free account connects but every tool answers with the upgrade link", async () => {
    const { accessToken } = await connect("free@test.id");
    const list = await rpc(accessToken, "tools/list");
    expect(list.status).toBe(200);
    const result = await callTool(accessToken, "get_profile");
    expect(result.isError).toBe(true);
    expect(result.text).toContain(`${SITE}/harga`);
    expect(result.text).toContain("JoyoRogo Pro");
    const audit = await db.select().from(mcpAudit).where(eq(mcpAudit.userId, "free"));
    expect(audit.map((row) => row.outcome)).toEqual(["not_pro"]);
    for (const name of ["get_plan", "get_sleep_nights", "get_sleep_findings"]) {
      const locked = await callTool(accessToken, name);
      expect(locked.isError).toBe(true);
      expect(locked.text).toContain(`${SITE}/harga`);
    }
    const all = await db.select().from(mcpAudit).where(eq(mcpAudit.userId, "free"));
    expect(all.map((row) => row.outcome)).toEqual(["not_pro", "not_pro", "not_pro", "not_pro"]);
  });

  test("a token without a scope cannot call that tool", async () => {
    const { accessToken } = await connect("pro@test.id", "food:read");
    const food = await callTool(accessToken, "get_food_log", { from: DAY, to: DAY });
    expect(food.isError).toBe(false);
    const weight = await callTool(accessToken, "get_weight_history");
    expect(weight.isError).toBe(true);
    expect(weight.text).toContain("weight:read");
  });

  test("the per-minute limit answers politely and writes no audit row", async () => {
    const { accessToken } = await connect("pro@test.id");
    const before = (await db.select().from(mcpAudit).where(eq(mcpAudit.userId, "pro"))).length;
    limiterOpen = false;
    try {
      const result = await callTool(accessToken, "get_profile");
      expect(result.isError).toBe(true);
      expect(result.text).toContain("Terlalu banyak permintaan");
    } finally {
      limiterOpen = true;
    }
    expect((await db.select().from(mcpAudit).where(eq(mcpAudit.userId, "pro"))).length).toBe(before);
    expect(limiterCalls.every((key) => key.startsWith("mcp:"))).toBe(true);
  });

  test("revoking the connection stops the access token at once and the refresh token for good", async () => {
    const { accessToken, refreshToken, clientId } = await connect("pro@test.id");
    expect((await callTool(accessToken, "get_profile")).isError).toBe(false);
    expect(await revokeConnection(db, "pro", clientId)).toBe(true);
    const after = await rpc(accessToken, "tools/list");
    expect(after.status).toBe(401);
    expect(after.headers.get("www-authenticate")).toContain("invalid_token");
    const refreshed = await app.request("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, resource: RESOURCE }),
    });
    expect(refreshed.status).toBe(400);
    expect(await revokeConnection(db, "pro", clientId)).toBe(false);
  });

  test("another account cannot revoke my connection", async () => {
    const { accessToken, clientId } = await connect("pro@test.id");
    expect(await revokeConnection(db, "other", clientId)).toBe(false);
    expect((await callTool(accessToken, "get_profile")).isError).toBe(false);
  });

  test("GET and DELETE are not allowed (no server stream), after authentication", async () => {
    const { accessToken } = await connect("pro@test.id");
    for (const method of ["GET", "DELETE"]) {
      const res = await app.request("/mcp", { method, headers: { authorization: `Bearer ${accessToken}`, accept: "text/event-stream" } });
      expect(res.status).toBe(405);
    }
    expect((await app.request("/mcp", { method: "GET" })).status).toBe(401);
  });
});

describe("connections of an account", () => {
  test("list shows the app, its scopes and its use; activity is newest first; the sweep keeps live clients", async () => {
    await db.delete(mcpAudit);
    const { accessToken, clientId } = await connect("pro@test.id", "food:read weight:read");
    await callTool(accessToken, "get_food_log", { from: DAY, to: DAY });
    await callTool(accessToken, "get_weight_history");
    const mine = (await listConnections(db, "pro")).filter((c) => c.clientId === clientId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ name: "Claude", redirectHosts: ["127.0.0.1:33418"], scopes: ["food:read", "weight:read"], calls30d: 2 });
    expect(mine[0]?.lastUsedAt).toBeGreaterThan(0);
    expect(await listConnections(db, "other")).not.toContainEqual(expect.objectContaining({ clientId }));

    const activity = await recentActivity(db, "pro", 10, clientId);
    expect(activity.map((row) => row.tool)).toEqual(["get_weight_history", "get_food_log"]);
    expect(activity[0]?.clientName).toBe("Claude");

    await sweepMcp(db, Date.now() + 3 * 24 * 60 * 60 * 1000);
    expect(await listConnections(db, "pro")).toContainEqual(expect.objectContaining({ clientId }));
    // 91 days on, the audit rows are gone.
    await sweepMcp(db, Date.now() + 91 * 24 * 60 * 60 * 1000);
    expect(await recentActivity(db, "pro", 10, clientId)).toEqual([]);
  });

  test("the account wipe removes connections, tokens and audit rows", async () => {
    const { accessToken } = await connect("other@test.id");
    await callTool(accessToken, "get_profile");
    await db.batch([...deleteUserMcpData(db, "other")]);
    expect(await listConnections(db, "other")).toEqual([]);
    expect(await recentActivity(db, "other", 10)).toEqual([]);
    expect((await rpc(accessToken, "tools/list")).status).toBe(401);
  });
});
