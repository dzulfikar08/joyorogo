import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { call } from "@orpc/server";
import type { RouterClient } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";
import { DEFAULT_DAY_ZONE, getT } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

import type { Context } from "../context";
import { jakartaToday } from "../lib/engine";
import { CONSENT_VERSION } from "../lib/joyo-ai/consent";
import type { JoyoEvent } from "../lib/joyo-ai/server-chat";
import { joyoUsedToday } from "../lib/joyo-ai/server-limit";
import { joyoRouter } from "./joyo";

// Hosted Joyo AI end to end through the router: gates, the daily cap, the fixed answer without a model, the slot taken before
// the model, the tool round over a fake Workers AI binding (streamed SSE, whole objects, and the binding's native shape), and
// what never reaches the model or the database. The procedures the tools read are the real ones, on an in-memory database.

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}

const today = jakartaToday(undefined, DEFAULT_DAY_ZONE);
const year = Number(today.slice(0, 4));
const NAME = "Siti Rahasiawati";
const EMAIL = "siti.rahasiawati@test.id";
const LMP = "2026-03-17";
const MARKER = "RAHASIA-QUERY-9137";

const USERS = {
  // Pro adults (one per scenario so the daily cap of one never touches another)
  stream: "founder",
  object: "founder",
  legacy: "founder",
  cap: "founder",
  capOff: "founder",
  slot: "founder",
  fixed: "founder",
  fixedFull: "founder",
  drop: "founder",
  abort: "founder",
  keep: "founder",
  transport: "founder",
  mom: "founder",
  noConsent: "founder",
  status: "founder",
  // gates
  free: "free",
  minor: "founder",
} as const;
for (const [id, tier] of Object.entries(USERS)) {
  const email = id === "mom" ? EMAIL : `${id}@test.id`;
  const name = id === "mom" ? NAME : id;
  await client.execute({ sql: `INSERT INTO "user" (id, name, email, tier) VALUES (?, ?, ?, ?)`, args: [id, name, email, tier] });
  const birthYear = id === "minor" ? year - 15 : 1990;
  const gender = id === "mom" ? "female" : "male";
  if (id === "mom") {
    await client.execute({
      sql: `INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level, maternal_mode, pregnancy_lmp, pregnancy_date_kind, pre_pregnancy_weight_kg, handle, bio)
            VALUES (?, ?, ?, 160, 60, 60, '2030-01-01', 'moderate', 'pregnant', ?, 'hpht', 60, 'siti_rahasia', 'bio rahasia')`,
      args: [id, birthYear, gender, LMP],
    });
  } else {
    await client.execute({
      sql: `INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level)
            VALUES (?, ?, ?, 175, 80, 70, '2030-01-01', 'light')`,
      args: [id, birthYear, gender],
    });
  }
  await client.execute({
    sql: `INSERT INTO food_log (id, user_id, date, meal, name, kcal, protein, carbs, fat, source) VALUES (?, ?, ?, 'sarapan', 'Nasi putih', 260, 5, 57, 0.5, 'manual')`,
    args: [`food-${id}`, id, today],
  });
}
const db = drizzle(client) as unknown as Database;

// ---- fake Workers AI binding ----

type WireMessage = { role: string; content?: unknown; tool_calls?: unknown };
type WireBody = { stream?: boolean; messages: WireMessage[]; tools?: unknown[]; chat_template_kwargs?: unknown; max_tokens?: number };
type Mode = "stream" | "object" | "legacy";

const ANSWER_PARTS = ["Sisa jatahmu hari ini ", "masih cukup untuk ", "makan malam ringan."];
const ANSWER = ANSWER_PARTS.join("");
const USAGE = { prompt_tokens: 400, completion_tokens: 20 };

function sse(chunks: unknown[]): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(`${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`);
  // Delivered in uneven pieces, like a network would.
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 37) controller.enqueue(bytes.slice(i, i + 37));
      controller.close();
    },
  });
}

const delta = (d: Record<string, unknown>, finish: string | null = null) => ({ choices: [{ index: 0, delta: d, finish_reason: finish }] });

/** A binding that asks for `get_day` first, then answers once the tool result is in the conversation. */
function scriptedAi(mode: Mode, onCall?: (body: WireBody) => void | Promise<void>) {
  const calls: WireBody[] = [];
  const run = async (_model: string, input: unknown) => {
    const body = input as WireBody;
    calls.push(body);
    await onCall?.(body);
    const toolRound = body.messages.some((m) => m.role === "tool");
    if (mode === "stream") {
      if (!toolRound) {
        return sse([
          delta({ role: "assistant", content: "Saya cek dulu. " }),
          delta({ tool_calls: [{ index: 0, id: "call_a", type: "function", function: { name: "get_day", arguments: "" } }] }),
          delta({ tool_calls: [{ index: 0, function: { arguments: `{"date":"${today.slice(0, 7)}` } }] }),
          delta({ tool_calls: [{ index: 0, function: { arguments: `${today.slice(7)}"}` } }] }),
          delta({}, "tool_calls"),
          { choices: [], usage: USAGE },
        ]);
      }
      return sse([...ANSWER_PARTS.map((part) => delta({ content: part })), delta({}, "stop"), { choices: [], usage: USAGE }]);
    }
    if (mode === "object") {
      if (!toolRound) {
        return {
          choices: [
            {
              message: { role: "assistant", content: null, tool_calls: [{ id: "call_a", type: "function", function: { name: "get_day", arguments: JSON.stringify({ date: today }) } }] },
              finish_reason: "tool_calls",
            },
          ],
          usage: USAGE,
        };
      }
      return { choices: [{ message: { role: "assistant", content: ANSWER }, finish_reason: "stop" }], usage: USAGE };
    }
    // The binding's own shape: `response` and `tool_calls` with the arguments as an object.
    if (!toolRound) return { response: null, tool_calls: [{ name: "get_day", arguments: { date: today } }], usage: USAGE };
    return { response: ANSWER, usage: USAGE };
  };
  return { ai: { run }, calls };
}

/** A binding that answers without tools in one call. */
function plainAi() {
  const calls: WireBody[] = [];
  return {
    calls,
    ai: {
      run: async (_model: string, input: unknown) => {
        calls.push(input as WireBody);
        return { choices: [{ message: { role: "assistant", content: ANSWER }, finish_reason: "stop" }], usage: USAGE };
      },
    },
  };
}

const background: Promise<unknown>[] = [];
const settled = async () => {
  await Promise.all(background.splice(0));
};

function ctx(userId: string, env: Record<string, unknown> = {}) {
  return {
    db,
    env: { FREE_DAILY_SCANS: "3", ...env },
    locale: "id",
    waitUntil: (promise: Promise<unknown>) => void background.push(promise),
    session: { user: { id: userId, createdAt: new Date(0) } },
  } as unknown as Context;
}

interface AskInput {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  consentVersion: number;
  locale?: "id" | "en" | "ms";
  today: string;
}

const ask = (text: string, extra: Partial<Omit<AskInput, "messages">> = {}): AskInput => ({
  messages: [{ role: "user", content: text }],
  consentVersion: CONSENT_VERSION,
  today,
  ...extra,
});

async function collect(source: AsyncIterable<JoyoEvent>): Promise<JoyoEvent[]> {
  const out: JoyoEvent[] = [];
  for await (const event of source) out.push(event);
  return out;
}

const open = (context: Context, input: AskInput, signal?: AbortSignal) =>
  call(joyoRouter.chat, input, { context, ...(signal ? { signal } : {}) }) as unknown as Promise<AsyncIterable<JoyoEvent>>;

const run = async (context: Context, input: AskInput, signal?: AbortSignal) => collect(await open(context, input, signal));

const failure = (promise: Promise<unknown>) => promise.then(() => null, (e: unknown) => e);

/** The fixed answer of the safety pass: the reason's text, then the disclaimer, in the asked language. */
const fixedReply = (locale: Locale, reason: "injury" | "medical" | "eatingDisorder" | "minorDiet") => {
  const t = getT(locale, "joyoAi");
  return `${t(`safe.${reason}`)}\n\n${t("disclaimerLine")}`;
};

const doneOf = (events: JoyoEvent[]) => {
  const last = events.at(-1);
  if (last?.type !== "done") throw new Error("the stream did not end with done");
  return last.result;
};

const ledger = async (userId: string) => {
  const rows = await client.execute({ sql: `SELECT model, latency_ms, usage_json FROM ai_usage WHERE user_id = ? AND scan_type = 'joyo' ORDER BY created_at`, args: [userId] });
  return (rows.rows as Array<Record<string, unknown>>).map((r) => ({ model: String(r.model), latencyMs: Number(r.latency_ms), usage: JSON.parse(String(r.usage_json)) as Record<string, unknown> }));
};

// ---- tests ----

describe("joyo.chat tool round over a fake Workers AI binding", () => {
  for (const mode of ["stream", "object", "legacy"] as const) {
    test(`${mode}: the model asks for get_day, the tool reads the real day, the final answer streams back`, async () => {
      const fake = scriptedAi(mode);
      const events = await run(ctx(mode, { AI: fake.ai }), ask("Sisa kalori hari ini cukup untuk apa?"));
      await settled();

      const done = doneOf(events);
      expect(done.reply).toBe(ANSWER);
      expect(done.fixed).toBe(false);
      expect(done.flagged).toBeNull();
      expect(done.usage).toEqual({ inputTokens: 800, outputTokens: 40, calls: 2 });
      expect(done.steps).toHaveLength(1);
      expect(done.steps[0]).toMatchObject({ trace: { tool: "get_day", args: { date: today } }, summary: { count: 1, empty: false, failed: false } });
      expect(done.dailyCap).toBe(20);
      expect(done.usedToday).toBe(1);

      const types = events.map((e) => e.type);
      expect(types.filter((t) => t === "round")).toHaveLength(2);
      expect(types.indexOf("toolStart")).toBeGreaterThan(types.indexOf("round"));
      expect(types.indexOf("toolDone")).toBeGreaterThan(types.indexOf("toolStart"));
      expect(types.lastIndexOf("round")).toBeGreaterThan(types.indexOf("toolDone"));
      expect(types.at(-1)).toBe("done");
      // the final answer text reached the client as it was written (piece by piece when the binding streams)
      const text = events.filter((e) => e.type === "text").map((e) => (e.type === "text" ? e.delta : "")).join("");
      expect(text.endsWith(ANSWER)).toBe(true);
      if (mode === "stream") expect(events.filter((e) => e.type === "text").length).toBeGreaterThan(2);

      // two model calls; the second carries the tool call and the REAL day (the seeded breakfast) as the tool result
      expect(fake.calls).toHaveLength(2);
      const second = fake.calls[1]!;
      const toolMessage = second.messages.find((m) => m.role === "tool");
      expect(String(toolMessage?.content)).toContain("Nasi putih");
      expect(second.messages.find((m) => m.role === "assistant")?.tool_calls).toBeDefined();
      // every call: tools offered, thinking off, the system prompt first
      for (const body of fake.calls) {
        expect(body.tools?.length).toBeGreaterThan(0);
        expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
        expect(body.messages[0]?.role).toBe("system");
      }

      const rows = await ledger(mode);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.usage).toMatchObject({ kind: "joyo", outcome: "ok", turns: 1, calls: 2, usage: { inputTokens: 800, outputTokens: 40 } });
    });
  }

  test("the hosted request goes to the server's model, never to a model the client names", async () => {
    const seen: string[] = [];
    const ai = {
      run: async (model: string) => {
        seen.push(model);
        return { choices: [{ message: { content: ANSWER }, finish_reason: "stop" }] };
      },
    };
    await run(ctx("status", { AI: ai, AI_JOYO_MODEL: "@cf/test/joyo", AI_COACH_MODEL: "@cf/test/coach" }), ask("Apa kabar?"));
    await run(ctx("status", { AI: ai, AI_COACH_MODEL: "@cf/test/coach" }), ask("Apa kabar?"));
    await settled();
    expect(seen).toEqual(["@cf/test/joyo", "@cf/test/coach"]);
    expect((await ledger("status")).map((r) => r.model)).toEqual(["@cf/test/joyo", "@cf/test/coach"]);
  });
});

describe("joyo.chat gates", () => {
  test("a free account gets FORBIDDEN with the paywall flag, no model call, no slot", async () => {
    const fake = plainAi();
    const error = await failure(run(ctx("free", { AI: fake.ai }), ask("Apa kabar?")));
    expect(error).toMatchObject({ code: "FORBIDDEN", data: { paywall: true } });
    expect(fake.calls).toHaveLength(0);
    expect(await joyoUsedToday(db, "free", DEFAULT_DAY_ZONE)).toBe(0);
  });

  test("a server without a paywall treats everyone as Pro (the same rule as the readiness guidance)", async () => {
    const fake = plainAi();
    const events = await run(ctx("free", { AI: fake.ai, FREE_DAILY_SCANS: undefined }), ask("Apa kabar?"));
    await settled();
    expect(doneOf(events).reply).toBe(ANSWER);
  });

  test("a consent version that is not the current one is refused before anything is read or reserved", async () => {
    const fake = plainAi();
    for (const consentVersion of [0, CONSENT_VERSION + 1]) {
      const error = await failure(run(ctx("noConsent", { AI: fake.ai }), ask("Apa kabar?", { consentVersion })));
      expect(error).toMatchObject({ code: "FORBIDDEN", data: { reason: "noConsent" } });
    }
    expect(fake.calls).toHaveLength(0);
    expect(await joyoUsedToday(db, "noConsent", DEFAULT_DAY_ZONE)).toBe(0);
  });

  test("under 18 (profile birth year) is FORBIDDEN even when the question is harmless; status says so", async () => {
    const fake = plainAi();
    const error = await failure(run(ctx("minor", { AI: fake.ai }), ask("Apa kabar?")));
    expect(error).toMatchObject({ code: "FORBIDDEN", data: { reason: "minor" } });
    expect(fake.calls).toHaveLength(0);
    expect(await joyoUsedToday(db, "minor", DEFAULT_DAY_ZONE)).toBe(0);
    const status = await call(joyoRouter.status, undefined, { context: ctx("minor", { AI: fake.ai }) });
    expect(status).toMatchObject({ unlocked: true, ageBlocked: true, usedToday: 0, dailyCap: 20, consentVersion: CONSENT_VERSION });
  });

  test("cap env 0 turns the feature off: SERVICE_UNAVAILABLE, nothing reserved", async () => {
    const fake = plainAi();
    const error = await failure(run(ctx("capOff", { AI: fake.ai, JOYO_AI_DAILY_CAP: "0" }), ask("Apa kabar?")));
    expect(error).toMatchObject({ code: "SERVICE_UNAVAILABLE", data: { reason: "off" } });
    expect(fake.calls).toHaveLength(0);
    expect(await joyoUsedToday(db, "capOff", DEFAULT_DAY_ZONE)).toBe(0);
  });

  test("no model binding is SERVICE_UNAVAILABLE and takes no slot", async () => {
    const error = await failure(run(ctx("capOff", {}), ask("Apa kabar?")));
    expect(error).toMatchObject({ code: "SERVICE_UNAVAILABLE", data: { reason: "off" } });
    expect(await joyoUsedToday(db, "capOff", DEFAULT_DAY_ZONE)).toBe(0);
  });

  test("cap reached: TOO_MANY_REQUESTS with the cap, and the model is not called again", async () => {
    const fake = plainAi();
    const env = { AI: fake.ai, JOYO_AI_DAILY_CAP: "2" };
    for (let i = 0; i < 2; i += 1) {
      const events = await run(ctx("cap", env), ask("Apa kabar?"));
      expect(doneOf(events).usedToday).toBe(i + 1);
    }
    const error = await failure(run(ctx("cap", env), ask("Apa kabar?")));
    expect(error).toMatchObject({ code: "TOO_MANY_REQUESTS", data: { reason: "cap", cap: 2 } });
    await settled();
    expect(fake.calls).toHaveLength(2);
    expect(await joyoUsedToday(db, "cap", DEFAULT_DAY_ZONE)).toBe(2);
    const status = await call(joyoRouter.status, undefined, { context: ctx("cap", env) });
    expect(status).toMatchObject({ usedToday: 2, dailyCap: 2 });
  });

});

describe("joyo.chat safety and the ledger", () => {
  test("a worrying message gets the fixed answer: no model call, no slot, only a done event", async () => {
    const fake = plainAi();
    const events = await run(ctx("fixed", { AI: fake.ai }), ask("nyeri dada waktu lari"));
    await settled();
    expect(events.map((e) => e.type)).toEqual(["done"]);
    const done = doneOf(events);
    expect(done).toMatchObject({ fixed: true, flagged: "medical", usage: { inputTokens: 0, outputTokens: 0, calls: 0 }, usedToday: 0, steps: [] });
    expect(done.reply).toBe(fixedReply("id", "medical"));
    expect(fake.calls).toHaveLength(0);
    expect(await joyoUsedToday(db, "fixed", DEFAULT_DAY_ZONE)).toBe(0);
  });

  test("the fixed answer is given even when the day's cap is used up (it costs nothing), in the asked language", async () => {
    const fake = plainAi();
    const env = { AI: fake.ai, JOYO_AI_DAILY_CAP: "1" };
    await run(ctx("fixedFull", env), ask("Apa kabar?"));
    await expect(run(ctx("fixedFull", env), ask("Apa kabar?"))).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    const events = await run(ctx("fixedFull", env), ask("I have chest pain when I run", { locale: "en" }));
    await settled();
    const done = doneOf(events);
    expect(done).toMatchObject({ fixed: true, flagged: "medical", usedToday: 1 });
    expect(done.reply).toBe(fixedReply("en", "medical"));
    expect(fake.calls).toHaveLength(1);
  });

  test("an eating-disorder message gets the fixed answer and never reaches the model", async () => {
    const fake = plainAi();
    const events = await run(ctx("fixed", { AI: fake.ai }), ask("aku mau muntahin makanan biar kurus"));
    const done = doneOf(events);
    expect(done.fixed).toBe(true);
    expect(fake.calls).toHaveLength(0);
  });

  test("the slot is reserved BEFORE the model is called, then settled with the outcome and token counts", async () => {
    const seen: Array<{ used: number; usage: Record<string, unknown> | undefined }> = [];
    const fake = scriptedAi("object", async () => {
      const rows = await ledger("slot");
      seen.push({ used: await joyoUsedToday(db, "slot", DEFAULT_DAY_ZONE), usage: rows.at(-1)?.usage });
    });
    await run(ctx("slot", { AI: fake.ai }), ask("Sisa kalori hari ini cukup untuk apa?"));
    await settled();
    // at both model calls the row already existed, still pending
    expect(seen).toHaveLength(2);
    for (const s of seen) {
      expect(s.used).toBe(1);
      expect(s.usage).toEqual({ kind: "joyo", outcome: "pending" });
    }
    const rows = await ledger("slot");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.usage).toMatchObject({ outcome: "ok", calls: 2 });
    expect(rows[0]?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test("a model that fails still counts, the ledger row records the failure, and the client gets a typed error", async () => {
    const ai = { run: async () => { throw new Error("model down"); } };
    const error = await failure(run(ctx("keep", { AI: ai }), ask("Apa kabar?")));
    expect(error).toMatchObject({ code: "UNPROCESSABLE_CONTENT", data: { reason: "server" } });
    await settled();
    expect(await joyoUsedToday(db, "keep", DEFAULT_DAY_ZONE)).toBe(1);
    const rows = await ledger("keep");
    expect(rows[0]?.usage).toMatchObject({ kind: "joyo", outcome: "server" });
  });

  test("the client leaving mid-answer records the slot as aborted and does not wait for the model", async () => {
    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const ai = {
      run: async () => {
        started.resolve();
        await gate.promise;
        return { choices: [{ message: { content: ANSWER }, finish_reason: "stop" }] };
      },
    };
    const iterator = (await open(ctx("drop", { AI: ai }), ask("Apa kabar?")))[Symbol.asyncIterator]();
    const first = iterator.next();
    await started.promise;
    expect(await joyoUsedToday(db, "drop", DEFAULT_DAY_ZONE)).toBe(1);
    // the round event arrives, then the client leaves while the model is still working
    expect((await first).value).toMatchObject({ type: "round" });
    await iterator.return?.();
    await settled();
    gate.resolve();
    const rows = await ledger("drop");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.usage).toMatchObject({ kind: "joyo", outcome: "aborted" });
  });

  test("an aborted request signal ends the stream at once with the aborted error", async () => {
    const started = Promise.withResolvers<void>();
    const ai = {
      run: () => {
        started.resolve();
        return Promise.withResolvers<never>().promise;
      },
    };
    const controller = new AbortController();
    const pending = failure(run(ctx("abort", { AI: ai }), ask("Apa kabar?"), controller.signal));
    await started.promise;
    controller.abort();
    const error = await pending;
    expect(error).toMatchObject({ data: { reason: "aborted" } });
    await settled();
    expect((await ledger("abort"))[0]?.usage).toMatchObject({ outcome: "aborted" });
  });
});

describe("joyo.chat privacy", () => {
  test("what the model is sent never holds the name, email, handle, bio or any pregnancy field of the account", async () => {
    const fake = scriptedAi("object");
    const events = await run(ctx("mom", { AI: fake.ai }), ask("Sisa kalori hari ini cukup untuk apa?"));
    await settled();
    expect(doneOf(events).reply).toBe(ANSWER);
    const everything = JSON.stringify(fake.calls);
    for (const secret of [NAME, "Siti", "Rahasiawati", EMAIL, "siti_rahasia", "bio rahasia", LMP, "hpht"]) {
      expect(everything).not.toContain(secret);
    }
    expect(everything).not.toMatch(/maternal|pregnan|breastfe|hamil|menyusui/i);
  });

  test("the question and the answer are stored nowhere: no table of the database holds them", async () => {
    const fake = scriptedAi("stream");
    await run(ctx("keep", { AI: fake.ai }), ask(`Sisa kalori hari ini ${MARKER}?`));
    await settled();
    const tables = await client.execute(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`);
    for (const row of tables.rows) {
      const dump = await client.execute(`SELECT * FROM "${String(row.name)}"`);
      const text = JSON.stringify(dump.rows);
      expect(text).not.toContain(MARKER);
      expect(text).not.toContain(ANSWER_PARTS[0]!);
    }
  });

  test("a device day far from the server's day is ignored (the zone day wins)", async () => {
    const fake = scriptedAi("object");
    await run(ctx("keep", { AI: fake.ai }), ask("Sisa kalori hari ini cukup untuk apa?", { today: "2001-01-01" }));
    await settled();
    expect(JSON.stringify(fake.calls[0]?.messages[0]?.content)).toContain(today);
    expect(JSON.stringify(fake.calls[0]?.messages[0]?.content)).not.toContain("2001-01-01");
  });
});

describe("joyo over the real RPC transport", () => {
  const handler = new RPCHandler({ joyo: joyoRouter });
  const rpc = (context: Context) =>
    createORPCClient<RouterClient<{ joyo: typeof joyoRouter }>>(
      new RPCLink({
        url: "http://localhost/rpc",
        fetch: async (request) => {
          const result = await handler.handle(request, { prefix: "/rpc", context });
          if (!result.matched) throw new Error("no route");
          return result.response;
        },
      }),
    );

  test("events, the done result and status survive the transport the apps use", async () => {
    const fake = scriptedAi("stream");
    const client = rpc(ctx("transport", { AI: fake.ai }));
    const events: JoyoEvent[] = [];
    for await (const event of await client.joyo.chat(ask("Sisa kalori hari ini cukup untuk apa?"))) events.push(event);
    await settled();
    const done = doneOf(events);
    expect(done.reply).toBe(ANSWER);
    expect(done.steps[0]).toMatchObject({ trace: { tool: "get_day" } });
    expect(events.map((e) => e.type)).toContain("toolDone");
    expect(await client.joyo.status()).toMatchObject({ unlocked: true, usedToday: 1, dailyCap: 20, ageBlocked: false, consentVersion: CONSENT_VERSION });
  });

  test("a refusal keeps its code and data when the client starts iterating (paywall, consent, cap)", async () => {
    const fake = plainAi();
    const refuse = async (userId: string, input: AskInput, env: Record<string, unknown> = {}) =>
      failure(collect(await rpc(ctx(userId, { AI: fake.ai, ...env })).joyo.chat(input)));
    expect(await refuse("free", ask("Apa kabar?"))).toMatchObject({ code: "FORBIDDEN", data: { paywall: true } });
    expect(await refuse("transport", ask("Apa kabar?", { consentVersion: 0 }))).toMatchObject({ code: "FORBIDDEN", data: { reason: "noConsent" } });
    expect(await refuse("transport", ask("Apa kabar?"), { JOYO_AI_DAILY_CAP: "1" })).toMatchObject({ code: "TOO_MANY_REQUESTS", data: { reason: "cap", cap: 1 } });
    expect(fake.calls).toHaveLength(0);
  });
});
