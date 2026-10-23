import { d1TestDb } from "@joyorogo/db/test-d1";
import { describe, expect, test } from "bun:test";


import { shadowReport } from "./accuracy-report";
import { compactItems, loadSession, recordSessionSaved } from "./scan-outcome";
import {
  DEFAULT_SHADOW_DAILY_CAP,
  DEFAULT_SHADOW_RATE,
  runShadowScan,
  sampledForShadow,
  shadowDailyCap,
  shadowRate,
} from "./shadow-scan";
import type { AiRunner } from "./vision";

const { client, db } = await d1TestDb();
const USER = "u1";
await client.execute(`INSERT INTO "user" (id, name, email) VALUES ('${USER}', 'A', 'a@test.id')`);

const PROD = [
  { name: "gado-gado", grams: 300, kcal: 380 },
  { name: "kerupuk", grams: 10, kcal: 50 },
];
let n = 0;
async function seedScan(): Promise<string> {
  const photoId = `s${(n++).toString(16).padStart(31, "0")}`;
  await client.execute({
    sql: `INSERT INTO ai_usage (id, user_id, model, scan_type, latency_ms, usage_json, created_at) VALUES (?, ?, 'm1', 'user', 1000, ?, ?)`,
    args: [`row-${photoId}`, USER, JSON.stringify({ photoId, aiItems: compactItems(PROD) }), Date.now()],
  });
  return photoId;
}
const answering = (items: unknown[]): AiRunner & { requests: Array<Record<string, unknown>> } => {
  const requests: Array<Record<string, unknown>> = [];
  return {
    requests,
    run: (_model, input) => {
      requests.push(input as Record<string, unknown>);
      return Promise.resolve({ response: JSON.stringify({ items }) });
    },
  };
};
const base = (photoId: string, ai: AiRunner, over: Record<string, unknown> = {}) => ({
  db,
  ai,
  userId: USER,
  photoId,
  imageBase64: "aGVsbG8=",
  mimeType: "image/jpeg",
  locale: "id" as const,
  ledgerReady: Promise.resolve(true),
  dailyCap: 100,
  ...over,
});

describe("shadow sampling config", () => {
  test("rate defaults to 0.2, clamps to 0..1 and 0 turns it off", () => {
    expect(shadowRate({})).toBe(DEFAULT_SHADOW_RATE);
    expect(shadowRate({ SHADOW_SAMPLE_RATE: "" })).toBe(DEFAULT_SHADOW_RATE);
    expect(shadowRate({ SHADOW_SAMPLE_RATE: "abc" })).toBe(DEFAULT_SHADOW_RATE);
    expect(shadowRate({ SHADOW_SAMPLE_RATE: "0" })).toBe(0);
    expect(shadowRate({ SHADOW_SAMPLE_RATE: "0.5" })).toBe(0.5);
    expect(shadowRate({ SHADOW_SAMPLE_RATE: "7" })).toBe(1);
    expect(shadowDailyCap({})).toBe(DEFAULT_SHADOW_DAILY_CAP);
    expect(shadowDailyCap({ SHADOW_DAILY_CAP: "5" })).toBe(5);
  });

  test("sampledForShadow follows the rate; rate 0 never samples", () => {
    expect(sampledForShadow({}, () => 0.19)).toBe(true);
    expect(sampledForShadow({}, () => 0.2)).toBe(false);
    expect(sampledForShadow({ SHADOW_SAMPLE_RATE: "0" }, () => 0)).toBe(false);
    expect(sampledForShadow({ SHADOW_SAMPLE_RATE: "1" }, () => 0.999)).toBe(true);
  });
});

describe("runShadowScan", () => {
  test("stores the variant's items beside the production answer, with temperature 0.1", async () => {
    const photoId = await seedScan();
    const ai = answering([{ name: "siomay", grams: 250, kcal: 450 }]);
    expect(await runShadowScan(base(photoId, ai))).toBe("stored");
    expect(ai.requests[0]!.temperature).toBe(0.1);
    const { session } = (await loadSession(db, USER, photoId))!;
    expect(session.aiItems).toEqual(compactItems(PROD));
    expect(session.shadow?.variant).toBe("identity-t01");
    expect(session.shadow?.items?.map((i) => i.n)).toEqual(["siomay"]);
  });

  test("writes no ledger row: the user's quota rows stay the same", async () => {
    const photoId = await seedScan();
    const count = async () =>
      (await client.execute(`select count(*) c from ai_usage where scan_type = 'user'`)).rows[0]!.c;
    const before = await count();
    await runShadowScan(base(photoId, answering([{ name: "siomay", grams: 250, kcal: 450 }])));
    expect(await count()).toBe(before);
  });

  test("a failed model call is recorded as an error and never throws", async () => {
    const photoId = await seedScan();
    const ai: AiRunner = { run: () => Promise.reject(new Error("boom")) };
    expect(await runShadowScan(base(photoId, ai))).toBe("failed");
    const { session } = (await loadSession(db, USER, photoId))!;
    expect(session.shadow?.error).toBeDefined();
    expect(session.shadow?.items).toBeUndefined();
  });

  test("skips when the ledger row was not written or the daily cap is reached", async () => {
    const photoId = await seedScan();
    const ai = answering([{ name: "siomay", kcal: 450 }]);
    expect(await runShadowScan(base(photoId, ai, { ledgerReady: Promise.resolve(false) }))).toBe("skipped");
    expect(await runShadowScan(base(photoId, ai, { dailyCap: 0 }))).toBe("skipped");
    expect(ai.requests).toHaveLength(0);
    expect((await loadSession(db, USER, photoId))!.session.shadow).toBeUndefined();
  });

  test("a later diary save keeps the shadow answer in the session", async () => {
    const photoId = await seedScan();
    await runShadowScan(base(photoId, answering([{ name: "siomay", grams: 250, kcal: 450 }])));
    await recordSessionSaved(db, USER, photoId, [{ name: "siomay", grams: 250, kcal: 480 }]);
    const { session } = (await loadSession(db, USER, photoId))!;
    expect(session.shadow?.items).toBeDefined();
    expect(session.savedLabel).toBe("corrected");
  });
});

describe("shadowReport", () => {
  const session = (shadowItems: ReturnType<typeof compactItems> | undefined, saved: typeof PROD | undefined, label?: "accurate" | "corrected") => ({
    aiItems: compactItems(PROD),
    ...(shadowItems ? { shadow: { variant: "v", at: 1, ms: 5, items: shadowItems } } : {}),
    ...(saved ? { savedItems: compactItems(saved), savedLabel: label ?? "corrected" } : {}),
  });
  const SAVED = [{ name: "siomay", grams: 250, kcal: 500 }];

  test("null without samples", () => {
    expect(shadowReport([{ aiItems: compactItems(PROD) }])).toBeNull();
  });

  test("scores both answers against the saved items: names and kcal over/under", () => {
    const report = shadowReport([
      session(compactItems([{ name: "siomay", grams: 250, kcal: 480 }]), SAVED),
      session(compactItems([{ name: "gado-gado", grams: 300, kcal: 380 }]), SAVED, "corrected"),
      session(compactItems([{ name: "siomay", kcal: 450 }]), undefined),
      { aiItems: compactItems(PROD), shadow: { variant: "v", at: 1, ms: 5, error: "timeout" } },
    ])!;
    expect(report.sampled).toBe(4);
    expect(report.failed).toBe(1);
    expect(report.scored).toBe(2);
    expect(report.corrected).toBe(2);
    expect(report.prod.f1).toBe(0);
    expect(report.shadow.f1).toBeCloseTo(0.5, 5);
    expect(report.shadow.under).toBe(1);
    expect(report.prod.under).toBe(2);
    // Scan 1: shadow matched the name. Scan 2: neither did, prod's kcal was closer.
    expect(report.shadowCloser).toBe(1);
    expect(report.prodCloser).toBe(1);
    expect(report.tie).toBe(0);
    expect(report.correctedShadowCloser).toBe(1);
    expect(report.correctedProdCloser).toBe(1);
  });

  test("equal names are decided by the smaller kcal error, within 2 points is a tie", () => {
    const prodKcal = (k: number) => [{ name: "siomay", grams: 250, kcal: k }];
    const sess = (shadowK: number) => ({
      aiItems: compactItems(prodKcal(400)),
      shadow: { variant: "v", at: 1, ms: 5, items: compactItems(prodKcal(shadowK)) },
      savedItems: compactItems(SAVED),
      savedLabel: "accurate" as const,
    });
    const report = shadowReport([sess(480), sess(300), sess(402)])!;
    expect(report.shadowCloser).toBe(1);
    expect(report.prodCloser).toBe(1);
    expect(report.tie).toBe(1);
    expect(report.corrected).toBe(0);
  });
});
