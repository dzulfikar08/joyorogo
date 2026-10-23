import { call } from "@orpc/server";
import { beforeEach, describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { LABEL_PROMPT } from "../lib/barcode-label";
import { barcodeRouter, MAX_LABEL_READS_PER_DAY } from "./barcode";

const { client, db } = await d1TestDb();
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email) VALUES ('u1','u1','u1@t.id'),('u2','u2','u2@t.id');
`);

const GOOD_CODE = "8996001600146";
const PHOTO = { imageBase64: "QUJD".repeat(20), mimeType: "image/jpeg" as const };

const LABEL_ANSWER = JSON.stringify({
  servingSize: 34,
  unit: "g",
  perServing: { kcal: 180, protein: 2, carbs: 18, fat: 11, fiber: 1, sugar: 1 },
});
const FRONT_ANSWER = JSON.stringify({ name: "Sapi Panggang", brand: "Chitato", quantity: "68 g" });

type Seen = { prompts: string[]; urls: string[] };
type ModelRequest = { messages: Array<{ content: Array<{ text?: string; image_url?: { url: string } }> }> };
type FakeAi = { seen: Seen; run(model: string, input: unknown): Promise<unknown> };

function fakeAi(label: string | Error, seen: Seen = { prompts: [], urls: [] }): FakeAi {
  return {
    seen,
    run: (_model, input) => {
      // The fake is the typed boundary of what the router sends the model.
      const request = input as ModelRequest;
      const content = request.messages[0]!.content;
      seen.prompts.push(content[0]!.text ?? "");
      seen.urls.push(content[1]!.image_url!.url);
      if (content[0]!.text === LABEL_PROMPT) {
        return label instanceof Error ? Promise.reject(label) : Promise.resolve({ response: label });
      }
      return Promise.resolve({ response: FRONT_ANSWER });
    },
  };
}

function ctx(userId: string, ai?: FakeAi) {
  const background: Promise<unknown>[] = [];
  const context = {
    db,
    env: { AI: ai, AI_VISION_MODEL: "test-model" },
    locale: "id",
    waitUntil: (p: Promise<unknown>) => void background.push(p),
    session: { user: { id: userId } },
  } as unknown as Context;
  return { context, settled: () => Promise.all(background) };
}

beforeEach(async () => {
  await client.executeMultiple(`DELETE FROM barcode_contribution; DELETE FROM barcode_product; DELETE FROM ai_usage;`);
});

const FORM = {
  code: GOOD_CODE,
  name: "Chitato Sapi Panggang",
  brand: "Chitato",
  quantity: "68 g",
  servingSize: 34,
  unit: "g" as const,
  basis: "serving" as const,
  kcal: 180,
  protein: 2,
  carbs: 18,
  fat: 11,
  fiber: 1,
  sugar: 1,
};

describe("barcode.readLabel", () => {
  test("returns an editable draft, sends the photos only to the model and logs a free ledger row", async () => {
    const ai = fakeAi(LABEL_ANSWER);
    const { context, settled } = ctx("u1", ai);
    const result = await call(
      barcodeRouter.readLabel,
      { code: GOOD_CODE, label: PHOTO, front: PHOTO },
      { context },
    );
    await settled();
    expect(result.draft).toMatchObject({
      name: "Sapi Panggang",
      brand: "Chitato",
      servingSize: 34,
      basis: "serving",
      nutrients: { kcal: 180 },
    });
    expect(ai.seen.urls).toHaveLength(2);
    const ledger = await client.execute(`select scan_type, usage_json from ai_usage where user_id = 'u1'`);
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]!.scan_type).toBe("label");
    // The ledger records that a read happened, never what was in the photo.
    expect(String(ledger.rows[0]!.usage_json)).not.toContain("QUJD");
    const stored = await client.execute(`select count(*) n from barcode_product`);
    expect(stored.rows[0]!.n).toBe(0);
  });

  test("an unreadable label is a 422 with a stable reason and still counts toward the daily cap", async () => {
    const { context, settled } = ctx("u1", fakeAi(JSON.stringify({ problem: "buram" })));
    const error = await call(barcodeRouter.readLabel, { code: GOOD_CODE, label: PHOTO }, { context }).catch(
      (e: unknown) => e,
    );
    await settled();
    expect(error).toMatchObject({ code: "UNPROCESSABLE_CONTENT", data: { reason: "unclear" } });
    const rows = await client.execute(`select usage_json from ai_usage where scan_type = 'label'`);
    expect(rows.rows).toHaveLength(1);
  });

  test("the daily cap stops the model call", async () => {
    const fillers = Array.from({ length: MAX_LABEL_READS_PER_DAY }, (_, i) => `('l${i}', 'u1', 'm', 'label', 1)`);
    await client.execute(`insert into ai_usage (id, user_id, model, scan_type, latency_ms) values ${fillers.join(",")}`);
    const ai = fakeAi(LABEL_ANSWER);
    const { context } = ctx("u1", ai);
    const error = await call(barcodeRouter.readLabel, { code: GOOD_CODE, label: PHOTO }, { context }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(ai.seen.prompts).toHaveLength(0);
    // Another user is unaffected.
    const other = ctx("u2", fakeAi(LABEL_ANSWER));
    await expect(call(barcodeRouter.readLabel, { code: GOOD_CODE, label: PHOTO }, { context: other.context })).resolves.toBeDefined();
  });

  test("a bad code or a missing AI binding fails before any model call", async () => {
    const { context } = ctx("u1", fakeAi(LABEL_ANSWER));
    await expect(call(barcodeRouter.readLabel, { code: "123", label: PHOTO }, { context })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const noAi = ctx("u1");
    await expect(call(barcodeRouter.readLabel, { code: GOOD_CODE, label: PHOTO }, { context: noAi.context })).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });
});

describe("barcode.contribute and confirm", () => {
  test("saves, then a second user confirms; the lookup shows the shared values", async () => {
    const first = await call(barcodeRouter.contribute, FORM, { context: ctx("u1").context });
    expect(first).toMatchObject({ outcome: "saved", contributors: 1 });
    expect(first.lookup).toMatchObject({ status: "found", source: "label_photo", code: GOOD_CODE, mine: true });

    // No source is asked: the label row is ours. The router would otherwise call Open Food Facts.
    const looked = await call(barcodeRouter.lookup, { code: GOOD_CODE }, { context: ctx("u2").context });
    expect(looked).toMatchObject({ status: "found", source: "label_photo", contributors: 1, mine: false });

    const confirmed = await call(barcodeRouter.confirm, { code: GOOD_CODE }, { context: ctx("u2").context });
    expect(confirmed).toMatchObject({ outcome: "confirmed", contributors: 2 });
  });

  test("refusals carry a localized message and a stable reason", async () => {
    const absurd = await call(
      barcodeRouter.contribute,
      { ...FORM, kcal: 400 },
      { context: ctx("u1").context },
    ).catch((e: unknown) => e);
    expect(absurd).toMatchObject({ code: "BAD_REQUEST", data: { reason: "implausible" } });
    const mismatch = await call(barcodeRouter.contribute, { ...FORM, kcal: 40 }, { context: ctx("u1").context }).catch((e: unknown) => e);
    expect(mismatch).toMatchObject({ data: { reason: "energy_mismatch" } });
    const accepted = await call(
      barcodeRouter.contribute,
      { ...FORM, kcal: 40, confirmEnergyMismatch: true },
      { context: ctx("u1").context },
    );
    expect(accepted.outcome).toBe("saved");
  });

  test("confirming something that is not a community product is a conflict", async () => {
    await expect(call(barcodeRouter.confirm, { code: GOOD_CODE }, { context: ctx("u1").context })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

describe("barcode.recentLog", () => {
  const items = (code: string) => JSON.stringify({ barcode: code, brand: null, source: "off" });
  const insert = (id: string, user: string, source: string, code: string, ageMin: number) =>
    client.execute({
      sql: `INSERT INTO food_log (id, user_id, date, meal, name, kcal, source, items_json, created_at) VALUES (?, ?, '2026-10-22', 'snack', 'Fibe', 60, ?, ?, ?)`,
      args: [id, user, source, items(code), Date.now() - ageMin * 60_000],
    });

  test("reports this user's barcode log of the same code inside 15 minutes, nothing older or from others", async () => {
    await insert("rl1", "u1", "barcode", GOOD_CODE, 11);
    await insert("rl2", "u1", "barcode", "4006381333931", 2);
    await insert("rl3", "u2", "barcode", "5449000000996", 1);
    await insert("rl4", "u1", "barcode", "0089686010947", 40);
    await insert("rl5", "u1", "manual", "7622210449283", 1);
    const at = async (userId: string, code: string) => (await call(barcodeRouter.recentLog, { code }, { context: ctx(userId).context })).loggedAt;
    const hit = await at("u1", GOOD_CODE);
    expect(hit).not.toBeNull();
    expect(Date.now() - hit!).toBeGreaterThan(10 * 60_000);
    expect(await at("u2", GOOD_CODE)).toBeNull();
    expect(await at("u1", "0089686010947")).toBeNull();
    expect(await at("u1", "7622210449283")).toBeNull();
  });
});
