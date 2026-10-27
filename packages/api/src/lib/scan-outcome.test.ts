import { d1TestDb } from "@joyorogo/db/test-d1";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { aiUsage } from "@joyorogo/db/schema/fitness";

import {
  ABANDON_AFTER_MS,
  FEEDBACK_MARK,
  buildFeedbackReasons,
  compactItems,
  loadSession,
  markRetryTapFeedback,
  markSessionKeep,
  outcomeSql,
  parseFeedbackReasons,
  recordSessionCorrection,
  recordSessionRetry,
  recordSessionSaved,
  savedGramSources,
  scanDiff,
  scanOutcome,
} from "./scan-outcome";

const { client, db } = await d1TestDb();

const USER = "u1";
await client.execute(`INSERT INTO "user" (id, name, email) VALUES ('${USER}', 'A', 'a@test.id')`);

const AI = [
  { name: "nasi goreng", grams: 300, kcal: 600, protein: 12, carbs: 90, fat: 20, confidence: 0.8 },
  { name: "ayam goreng", grams: 100, kcal: 250 },
  { name: "kangkung", grams: 80, kcal: 40 },
];

let n = 0;
async function seedScan(opts: { createdAt?: number; items?: typeof AI } = {}): Promise<string> {
  const photoId = `p${(n++).toString(16).padStart(31, "0")}`;
  await client.execute({
    sql: `INSERT INTO ai_usage (id, user_id, model, scan_type, latency_ms, usage_json, created_at) VALUES (?, ?, 'm1', 'user', 1000, ?, ?)`,
    args: [
      `row-${photoId}`,
      USER,
      JSON.stringify({ photoId, aiItems: compactItems(opts.items ?? AI), serverTiming: { aiMs: 5 } }),
      opts.createdAt ?? Date.now(),
    ],
  });
  return photoId;
}

async function outcomeOf(photoId: string, now = Date.now()): Promise<string> {
  const [row] = await db
    .select({ outcome: outcomeSql(now) })
    .from(aiUsage)
    .where(eq(aiUsage.id, `row-${photoId}`));
  return row!.outcome;
}

describe("compactItems", () => {
  test("keeps name, grams, kcal, macros and confidence; drops nulls", () => {
    expect(compactItems([AI[0]!, { name: "x", grams: null, kcal: 10.4, protein: null }])).toEqual([
      { n: "nasi goreng", g: 300, gs: "model", k: 600, p: 12, c: 90, f: 20, cf: 0.8 },
      { n: "x", k: 10 },
    ]);
  });

  test("gs says where the grams came from: the chip that is showing, else the model", () => {
    const row = (name: string, extra: Record<string, unknown>) => ({ name, grams: 100, kcal: 100, ...extra });
    expect(
      compactItems([
        row("a", {}),
        row("b", { scaleRead: { active: "scale" } }),
        row("c", { scaleRead: { active: "ai" } }),
        row("d", { portionPrior: { active: "prior" } }),
        row("e", { portionPrior: { active: "ai" } }),
        { name: "no grams", kcal: 10 },
      ]).map((i) => i.gs),
    ).toEqual(["model", "scale", "model", "prior", "model", undefined]);
  });

  test("a diary row has no chip: sources are only stamped on request", () => {
    expect(compactItems([AI[0]!], false)[0]).not.toHaveProperty("gs");
  });

  test("keeps the alternate names the scan offered, two at most and cut like names", () => {
    expect(
      compactItems([
        { name: "nasi kuning", kcal: 300, alt: ["nasi uduk", "nasi liwet", "nasi kebuli"] },
        { name: "a", kcal: 1, alt: ["b".repeat(100)] },
        { name: "c", kcal: 1, alt: [] },
      ]),
    ).toEqual([
      { n: "nasi kuning", k: 300, a: ["nasi uduk", "nasi liwet"] },
      { n: "a", k: 1, a: ["b".repeat(80)] },
      { n: "c", k: 1 },
    ]);
  });
});

describe("savedGramSources", () => {
  const answer = compactItems([
    { name: "nasi putih", grams: 100, kcal: 130, scaleRead: { active: "scale" } },
    { name: "ayam goreng", grams: 80, kcal: 200, portionPrior: { active: "prior" } },
    { name: "telur dadar", grams: 50, kcal: 90 },
  ]);

  test("unchanged grams keep the answer's source, edited grams are the user's", () => {
    const saved = compactItems(
      [
        { name: "nasi putih", grams: 100, kcal: 130 },
        { name: "ayam goreng", grams: 120, kcal: 300 },
        { name: "telur dadar", grams: 50, kcal: 90 },
      ],
      false,
    );
    expect(savedGramSources(saved, answer).map((i) => i.gs)).toEqual(["scale", "user", "model"]);
  });

  test("a renamed row at the same grams keeps the source; an added row is the user's; no grams, no source", () => {
    const saved = compactItems(
      [
        { name: "nasi uduk", grams: 100, kcal: 150 },
        { name: "serundeng", grams: 30, kcal: 120 },
        { name: "es teh", kcal: 50 },
      ],
      false,
    );
    const out = savedGramSources(saved, answer);
    expect(out.map((i) => i.gs)).toEqual(["scale", "user", undefined]);
  });

  test("one answer item is matched once", () => {
    const saved = compactItems(
      [
        { name: "nasi putih", grams: 100, kcal: 130 },
        { name: "nasi putih", grams: 100, kcal: 130 },
      ],
      false,
    );
    expect(savedGramSources(saved, answer).map((i) => i.gs)).toEqual(["scale", "user"]);
  });
});

describe("scanDiff", () => {
  const ai = compactItems(AI);
  test("identical lists have an empty diff", () => {
    const diff = scanDiff(ai, compactItems(AI));
    expect(diff).toMatchObject({ renamed: [], removed: [], added: [], changed: [], aiKcal: 890, savedKcal: 890 });
  });

  test("removed, added, changed and renamed (same weight, new name)", () => {
    const saved = compactItems([
      { name: "nasi goreng", grams: 200, kcal: 400 },
      { name: "ayam bakar", grams: 100, kcal: 230 },
      { name: "es teh", grams: 250, kcal: 80 },
    ]);
    const diff = scanDiff(ai, saved);
    expect(diff.changed).toEqual([{ n: "nasi goreng", g: [300, 200], k: [600, 400] }]);
    expect(diff.renamed.map((r) => [r.from.n, r.to.n])).toEqual([["ayam goreng", "ayam bakar"]]);
    expect(diff.removed.map((r) => r.n)).toEqual(["kangkung"]);
    expect(diff.added.map((r) => r.n)).toEqual(["es teh"]);
    expect(diff.aiKcal).toBe(890);
    expect(diff.savedKcal).toBe(710);
  });
});

describe("session outcomes", () => {
  test("saved unchanged = accurate", async () => {
    const photoId = await seedScan();
    expect(await outcomeOf(photoId)).toBe("pending");
    const saved = await recordSessionSaved(db, USER, photoId, AI);
    expect(saved?.savedLabel).toBe("accurate");
    expect(await outcomeOf(photoId)).toBe("accurate");
    const { session } = (await loadSession(db, USER, photoId))!;
    expect(session.diff?.changed).toEqual([]);
  });

  test("saved with edits = corrected, with a diff", async () => {
    const photoId = await seedScan();
    await recordSessionSaved(db, USER, photoId, [{ ...AI[0]!, grams: 200, kcal: 400 }, AI[1]!]);
    expect(await outcomeOf(photoId)).toBe("corrected");
    const { session } = (await loadSession(db, USER, photoId))!;
    expect(session.diff?.removed.map((r) => r.n)).toEqual(["kangkung"]);
    expect(session.diff?.changed[0]).toMatchObject({ n: "nasi goreng", g: [300, 200] });
  });

  test("the ledger says where every grams came from, answer and diary", async () => {
    const photoId = await seedScan();
    // The user edited the nasi to 200 g and kept the rest.
    await recordSessionSaved(db, USER, photoId, [{ ...AI[0]!, grams: 200, kcal: 400 }, AI[1]!, AI[2]!]);
    const { session } = (await loadSession(db, USER, photoId))!;
    expect(session.aiItems!.map((i) => i.gs)).toEqual(["model", "model", "model"]);
    expect(session.savedItems!.map((i) => [i.n, i.gs])).toEqual([
      ["nasi goreng", "user"],
      ["ayam goreng", "model"],
      ["kangkung", "model"],
    ]);
  });

  test("a typed correction makes a save corrected even when the list ends up equal", async () => {
    const photoId = await seedScan();
    await recordSessionCorrection(db, USER, photoId);
    await recordSessionSaved(db, USER, photoId, AI);
    expect(await outcomeOf(photoId)).toBe("corrected");
  });

  test("an alternate-chip tap is a correction and is logged on the scan, tap by tap", async () => {
    const photoId = await seedScan({ items: [{ name: "nasi kuning", grams: 200, kcal: 320 }] });
    await recordSessionCorrection(db, USER, photoId, { from: "nasi kuning", to: "nasi uduk" });
    await recordSessionCorrection(db, USER, photoId, { from: "nasi uduk", to: "nasi liwet" });
    await recordSessionCorrection(db, USER, photoId);
    const { session } = (await loadSession(db, USER, photoId))!;
    expect(session.corrections).toBe(3);
    expect(session.altTaps).toEqual([
      { f: "nasi kuning", t: "nasi uduk" },
      { f: "nasi uduk", t: "nasi liwet" },
    ]);
    await recordSessionSaved(db, USER, photoId, [{ name: "nasi liwet", grams: 200, kcal: 330 }]);
    expect(await outcomeOf(photoId)).toBe("corrected");
  });

  test("retry = retried, every pass is logged with its index, save keeps retried", async () => {
    const photoId = await seedScan();
    await recordSessionRetry(db, USER, photoId, { model: "m1", items: [{ name: "nasi goreng", grams: 250, kcal: 500 }] });
    await recordSessionRetry(db, USER, photoId, { model: "m2", hint: "ada telur", items: [{ name: "nasi goreng telur", grams: 260, kcal: 520 }] });
    expect(await outcomeOf(photoId)).toBe("retried");
    const { session } = (await loadSession(db, USER, photoId))!;
    expect(session.retries).toBe(2);
    expect(session.retryLog?.map((p) => [p.i, p.model, p.hint])).toEqual([
      [1, "m1", undefined],
      [2, "m2", "ada telur"],
    ]);
    expect(session.retryItems).toEqual([{ n: "nasi goreng telur", g: 260, gs: "model", k: 520 }]);
    // The save diffs against the answer on screen (the last retry), not the first pass.
    const saved = await recordSessionSaved(db, USER, photoId, [{ name: "nasi goreng telur", grams: 260, kcal: 520 }]);
    expect(saved?.diff?.changed).toEqual([]);
    expect(await outcomeOf(photoId)).toBe("retried");
  });

  test("never saved: pending, then abandoned by age", async () => {
    const photoId = await seedScan({ createdAt: Date.now() - ABANDON_AFTER_MS - 60_000 });
    expect(await outcomeOf(photoId)).toBe("abandoned");
    expect(await outcomeOf(photoId, Date.now() - ABANDON_AFTER_MS)).toBe("pending");
  });

  test("SQL and TS outcome agree", () => {
    const now = Date.now();
    expect(scanOutcome({ retries: 1, savedLabel: "accurate" }, now, now)).toBe("retried");
    expect(scanOutcome({ savedLabel: "corrected" }, now, now)).toBe("corrected");
    expect(scanOutcome({}, now - ABANDON_AFTER_MS - 1, now)).toBe("abandoned");
    expect(scanOutcome({}, now, now)).toBe("pending");
  });

  test("updates keep the other usage_json fields and never touch another user's row", async () => {
    const photoId = await seedScan();
    await markSessionKeep(db, USER, photoId);
    await recordSessionCorrection(db, USER, photoId);
    const row = await client.execute(`SELECT usage_json FROM ai_usage WHERE id = 'row-${photoId}'`);
    const usage = JSON.parse(String(row.rows[0]!.usage_json));
    expect(usage).toMatchObject({ keep: 1, corrections: 1, photoId, serverTiming: { aiMs: 5 } });
    expect(await recordSessionSaved(db, "someone-else", photoId, AI)).toBeNull();
  });
});

describe("retry-tap feedback marking", () => {
  test("marks only a bare, recent, pre-retry kurang_akurat of that photo", async () => {
    const now = Date.now();
    await client.executeMultiple(
      `INSERT INTO scan_feedback (id, user_id, photo_id, rating, source, after_retry, created_at) VALUES
         ('bare', '${USER}', 'ph', 'kurang_akurat', 'web', 0, ${now}),
         ('noted', '${USER}', 'ph', 'kurang_akurat', 'web', 0, ${now}),
         ('old', '${USER}', 'ph', 'kurang_akurat', 'web', 0, ${now - 5 * 60_000}),
         ('afterretry', '${USER}', 'ph', 'kurang_akurat', 'web', 1, ${now});
       UPDATE scan_feedback SET note = 'siomay salah hitung' WHERE id = 'noted';`,
    );
    await markRetryTapFeedback(db, USER, "ph");
    const rows = await client.execute(`SELECT id, reasons_json FROM scan_feedback ORDER BY id`);
    const marked = Object.fromEntries(rows.rows.map((r) => [String(r.id), r.reasons_json]));
    expect(marked.bare).toBe(JSON.stringify([FEEDBACK_MARK.retryTap]));
    expect(marked.noted).toBeNull();
    expect(marked.old).toBeNull();
    expect(marked.afterretry).toBeNull();
  });
});

describe("feedback reasons marks", () => {
  test("round trip", () => {
    const json = buildFeedbackReasons(["porsi"], [FEEDBACK_MARK.keepPhoto]);
    expect(parseFeedbackReasons(json)).toEqual({ reasons: ["porsi"], retryTap: false, keepPhoto: true });
    expect(buildFeedbackReasons([], [])).toBeNull();
    expect(parseFeedbackReasons(null)).toEqual({ reasons: [], retryTap: false, keepPhoto: false });
  });
});
