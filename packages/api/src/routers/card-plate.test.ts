import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import type { ScanStreamEvent } from "../lib/scan-live";
import type { StickersBucket } from "../lib/sticker";
import { aiRouter } from "./ai";
import type { AnalyzeFoodResult } from "./ai";

const { client, db } = await d1TestDb();
await client.executeMultiple(`INSERT INTO "user" (id, name, email) VALUES ('own', 'Owner', 'own@t.id'), ('bob', 'Bob', 'bob@t.id');`);

/** A JPEG header 1000 x 1000 (square, so grid units are pixels): readable by imageSize, */
const jpegHeader = (width: number, height: number) =>
  Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9, ...new Array<number>(200).fill(0)]);
const PHOTO = { imageBase64: jpegHeader(1000, 1000).toString("base64"), mimeType: "image/jpeg" as const };
const UNREADABLE = { imageBase64: "aGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQ=", mimeType: "image/jpeg" as const };

/** A card 200 x 126 px (23.36 px/cm) and a 24 cm plate (561 px): what the measure call answers when all goes well. */
const MEASURE_GOOD = JSON.stringify({
  card: { seen: true, corners: [[50, 400], [250, 400], [250, 526], [50, 526]] },
  plate: { kind: "flat", box: [200, 300, 761, 861] },
});
const MEASURE_NO_CARD = JSON.stringify({ card: { seen: false, corners: null }, plate: { kind: "flat", box: [200, 300, 761, 861] } });

const item = (grams: number) => ({ name: "nasi putih", kind: "makanan", kcal: Math.round(grams * 1.3), grams, box: [100, 100, 600, 600] });
const scanAnswer = (grams: number, plate: string | null) => JSON.stringify({ card: { seen: true, confidence: 0.9 }, plate, items: [item(grams)] });

type Sent = { kind: "measure" | "scan"; prompt: string };
/**
 * Workers AI fake that tells the two calls apart by prompt. The scan answers 150 g without a plate in its prompt and
 * 100 g (and says P1) with the measured plate in it, so which scan the user got is readable from the grams.
 */
function fakeAi(measure: string | Error) {
  const sent: Sent[] = [];
  const ai = {
    run: (_model: string, body: unknown) => {
      const { messages, stream } = body as { messages: Array<{ content: Array<{ type: string; text?: string }> }>; stream?: boolean };
      const prompt = messages[0]!.content.find((part) => part.type === "text")?.text ?? "";
      if (prompt.startsWith("Lihat foto ini. Jawab HANYA JSON")) {
        sent.push({ kind: "measure", prompt });
        return measure instanceof Error
          ? Promise.reject(measure)
          : Promise.resolve({ choices: [{ message: { content: measure }, finish_reason: "stop" }], usage: { prompt_tokens: 555, completion_tokens: 67 } });
      }
      sent.push({ kind: "scan", prompt });
      const measured = prompt.includes("piring di foto");
      const text = measured ? scanAnswer(100, "P1") : scanAnswer(150, null);
      if (stream !== true) return Promise.resolve({ choices: [{ message: { content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 300, completion_tokens: 9 } });
      const encoder = new TextEncoder();
      const frames = [text.slice(0, 40), text.slice(40)].map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`);
      frames.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`, "data: [DONE]\n\n");
      return Promise.resolve(new ReadableStream<Uint8Array>({ start: (c) => (frames.forEach((f) => c.enqueue(encoder.encode(f))), c.close()) }));
    },
  };
  return { ai, sent };
}

/** In-memory R2 that keeps custom metadata, which "Hitung ulang" counts its retries in. */
function fakeBucket() {
  const objects = new Map<string, { bytes: ArrayBuffer; contentType?: string; custom?: Record<string, string> }>();
  const bucket = {
    put: (key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }) => {
      objects.set(key, { bytes: value, contentType: options?.httpMetadata?.contentType, custom: options?.customMetadata });
      return Promise.resolve();
    },
    get: (key: string) => {
      const found = objects.get(key);
      return Promise.resolve(
        found
          ? { body: new ReadableStream(), size: found.bytes.byteLength, arrayBuffer: () => Promise.resolve(found.bytes), httpMetadata: { contentType: found.contentType }, customMetadata: found.custom }
          : null,
      );
    },
    delete: () => Promise.resolve(),
    list: () => Promise.resolve({ objects: [], truncated: false }),
  };
  return bucket as unknown as StickersBucket;
}

const background: Promise<unknown>[] = [];
const bucket = fakeBucket();
const ctx = (userId: string, ai: unknown) =>
  ({
    db,
    env: { AI: ai, STICKERS: bucket, DISHWARE_USER_IDS: "own", SHADOW_SAMPLE_RATE: "0" },
    locale: "id",
    waitUntil: (promise: Promise<unknown>) => background.push(promise),
    session: { user: { id: userId } },
    requestStartedAt: Date.now(),
  }) as unknown as Context;

type Ledger = { cardPlate?: Record<string, unknown>; plate?: { registered: number; matched: string | null; answer: string | null }; card?: unknown };
async function ledgerOf(userId: string, scanType = "user"): Promise<Ledger> {
  await Promise.all(background.splice(0));
  const rows = await client.execute({
    sql: `select usage_json from ai_usage where user_id = ? and scan_type = ? order by created_at desc, rowid desc limit 1`,
    args: [userId, scanType],
  });
  return JSON.parse(String((rows.rows as Array<Record<string, unknown>>)[0]!.usage_json)) as Ledger;
}

const grams = (result: { items: Array<{ grams?: number }> }) => result.items.map((i) => i.grams);

describe("card measures the plate: the photo scan", () => {
  test("a card that gave a diameter: the scan is run again with the plate as text, the result says so, the ledger keeps it", async () => {
    const { ai, sent } = fakeAi(MEASURE_GOOD);
    const result = await call(aiRouter.analyzeFood, PHOTO, { context: ctx("own", ai) });
    expect(sent.map((s) => s.kind).sort()).toEqual(["measure", "measure", "scan", "scan"]);
    const scans = sent.filter((s) => s.kind === "scan");
    expect(scans.filter((s) => s.prompt.includes('"piring di foto", piring datar, diameter 24 cm'))).toHaveLength(1);
    expect(scans.filter((s) => !s.prompt.includes("piring di foto"))).toHaveLength(1);
    expect(grams(result)).toEqual([100]);
    expect(result.plate).toEqual({ status: "matched", id: "card", name: "piring di foto", kind: "flat", diameterCm: 24, widthCm: null, source: "card" });
    const ledger = await ledgerOf("own");
    expect(ledger.cardPlate).toMatchObject({
      seen: true,
      used: true,
      diameterCm: 24,
      rescanned: true,
      card: { box: [400, 50, 526, 250], aspect: 1.59 },
      plate: { kind: "flat", box: [200, 300, 761, 861] },
      usage: { prompt_tokens: 1110, completion_tokens: 134 },
    });
    expect(ledger.cardPlate!.ms).toBeNumber();
    expect(ledger.plate).toEqual({ registered: 0, matched: "card", answer: "P1" });
  });

  test("no card in the photo: one scan, the user's scan as before, and the ledger says it was looked for", async () => {
    const { ai, sent } = fakeAi(MEASURE_NO_CARD);
    const result = await call(aiRouter.analyzeFood, PHOTO, { context: ctx("own", ai) });
    expect(sent.filter((s) => s.kind === "scan")).toHaveLength(1);
    expect(sent.find((s) => s.kind === "scan")!.prompt).not.toContain("piring di foto");
    expect(grams(result)).toEqual([150]);
    expect("plate" in result).toBe(false);
    expect((await ledgerOf("own")).cardPlate).toMatchObject({ seen: false, used: false, skipped: "no_card" });
  });

  test("an implausible diameter is a skipped measurement and an unchanged scan", async () => {
    const tiny = JSON.stringify({ card: { seen: true, corners: [[50, 400], [250, 400], [250, 526], [50, 526]] }, plate: { kind: "flat", box: [200, 300, 300, 400] } });
    const { ai, sent } = fakeAi(tiny);
    const result = await call(aiRouter.analyzeFood, PHOTO, { context: ctx("own", ai) });
    expect(sent.filter((s) => s.kind === "scan")).toHaveLength(1);
    expect(grams(result)).toEqual([150]);
    expect((await ledgerOf("own")).cardPlate).toMatchObject({ seen: true, used: false, skipped: "implausible_diameter" });
  });

  test("an unparseable or failing measure call never fails the scan: same items, skip logged", async () => {
    for (const [measure, skipped] of [["maaf, tidak bisa", "unparseable"], [new Error("boom"), "error"]] as const) {
      const { ai, sent } = fakeAi(measure);
      const result = await call(aiRouter.analyzeFood, PHOTO, { context: ctx("own", ai) });
      expect(sent.filter((s) => s.kind === "scan")).toHaveLength(1);
      expect(grams(result)).toEqual([150]);
      expect((await ledgerOf("own")).cardPlate).toMatchObject({ used: false, skipped });
    }
  });

  test("a photo whose size cannot be read makes no measure call and scans as before", async () => {
    const { ai, sent } = fakeAi(MEASURE_GOOD);
    const result = await call(aiRouter.analyzeFood, UNREADABLE, { context: ctx("own", ai) });
    expect(sent.map((s) => s.kind)).toEqual(["scan"]);
    expect(grams(result)).toEqual([150]);
    expect((await ledgerOf("own")).cardPlate).toMatchObject({ seen: false, used: false, skipped: "no_size" });
  });

  test("a user outside the allowlist: no measure call, no second scan, nothing new in the result or the ledger", async () => {
    const { ai, sent } = fakeAi(MEASURE_GOOD);
    const result = await call(aiRouter.analyzeFood, PHOTO, { context: ctx("bob", ai) });
    expect(sent.map((s) => s.kind)).toEqual(["scan"]);
    expect(sent[0]!.prompt).not.toContain("Kartu pembanding");
    expect(grams(result)).toEqual([150]);
    expect("plate" in result || "card" in result).toBe(false);
    const ledger = await ledgerOf("bob");
    expect(ledger).not.toHaveProperty("cardPlate");
    expect(ledger).not.toHaveProperty("plate");
  });
});

describe("card measures the plate: the stream and Hitung ulang", () => {
  const collect = async <T>(source: AsyncIterable<T>) => {
    const out: T[] = [];
    for await (const event of source) out.push(event);
    return out;
  };

  test("the stream shows the measured scan only, then done carries the plate", async () => {
    const { ai, sent } = fakeAi(MEASURE_GOOD);
    const events = (await collect(await call(aiRouter.analyzeFoodStream, PHOTO, { context: ctx("own", ai) }))) as Array<ScanStreamEvent<AnalyzeFoodResult>>;
    expect(sent.filter((s) => s.kind === "scan")).toHaveLength(2);
    const items = events.flatMap((e) => (e.type === "item" ? [e.item.grams] : []));
    expect(items).toEqual([100]);
    expect(events.some((e) => e.type === "reset")).toBe(false);
    const done = events.at(-1)!;
    expect(done.type === "done" && done.result.plate).toMatchObject({ status: "matched", source: "card", diameterCm: 24 });
  });

  test("the stream of a photo without a card shows the one scan it has", async () => {
    const { ai, sent } = fakeAi(MEASURE_NO_CARD);
    const events = (await collect(await call(aiRouter.analyzeFoodStream, PHOTO, { context: ctx("own", ai) }))) as Array<ScanStreamEvent<AnalyzeFoodResult>>;
    expect(sent.filter((s) => s.kind === "scan")).toHaveLength(1);
    expect(events.flatMap((e) => (e.type === "item" ? [e.item.grams] : []))).toEqual([150]);
    expect(events.at(-1)!.type).toBe("done");
  });

  test("Hitung ulang measures again and rescans with the plate; without a card it retries as before", async () => {
    const first = await call(aiRouter.analyzeFood, PHOTO, { context: ctx("own", fakeAi(MEASURE_NO_CARD).ai) });
    expect(first.photoId).not.toBeNull();
    const { ai, sent } = fakeAi(MEASURE_GOOD);
    const retry = await call(aiRouter.analyzeFoodRetry, { photoId: first.photoId! }, { context: ctx("own", ai) });
    expect(sent.map((s) => s.kind).sort()).toEqual(["measure", "measure", "scan", "scan"]);
    expect(grams(retry)).toEqual([100]);
    expect(retry.plate).toMatchObject({ status: "matched", source: "card", diameterCm: 24 });
    expect((await ledgerOf("own", "retry")).cardPlate).toMatchObject({ used: true, rescanned: true, diameterCm: 24 });

    const plain = fakeAi(MEASURE_NO_CARD);
    const again = await call(aiRouter.analyzeFoodRetry, { photoId: first.photoId! }, { context: ctx("own", plain.ai) });
    expect(plain.sent.filter((s) => s.kind === "scan")).toHaveLength(1);
    expect(grams(again)).toEqual([150]);
    expect((await ledgerOf("own", "retry")).cardPlate).toMatchObject({ used: false, skipped: "no_card" });
  });
});
