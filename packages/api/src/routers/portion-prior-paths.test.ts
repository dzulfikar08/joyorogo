// The owner's egg whites (lib/fixtures/owner-putih-telur.json) through every path that shows a scan:
// photo scan, its stream, "Hitung ulang" and Cerita. The model keeps answering 50 g; each path must start at
// the 100 g he saved every time, with the model's number kept in the note.

import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { jakartaToday, shiftDate } from "../lib/engine";
import { ownerPutihTelurRows } from "../lib/owner-putih-telur-fixture";
import type { ScanStreamEvent } from "../lib/scan-live";
import type { StickersBucket } from "../lib/sticker";
import { aiRouter } from "./ai";
import type { AnalyzeFoodResult } from "./ai";

const { client, db } = await d1TestDb();
await client.executeMultiple(`INSERT INTO "user" (id, name, email) VALUES ('owner', 'owner', 'owner@test.id'), ('fresh', 'fresh', 'fresh@test.id');`);

// The diary after the owner's last save of 2026-10-22: the rows keep their spacing, the newest one an hour old.
const rows = ownerPutihTelurRows();
const newest = rows.at(-1)!.at;
const today = jakartaToday();
for (const [index, row] of rows.entries()) {
  await client.execute({
    sql: `INSERT INTO food_log (id, user_id, date, meal, name, kcal, grams, source, items_json, created_at) VALUES (?, 'owner', ?, 'snack', ?, ?, ?, ?, ?, ?)`,
    args: [`egg${index}`, shiftDate(today, -1), row.name, row.grams! / 2, row.grams, row.source, row.itemsJson, Date.now() - 3_600_000 - (newest - row.at)],
  });
}

/** The answer the owner kept getting: one boiled egg white, 50 g. */
const WHITE = { name: "putih telur", kind: "makanan", portion: "1 buah", grams: 50, kcal: 25, protein: 5, carbs: 1, fat: 0, confidence: 0.9, box: [119, 103, 672, 546] };
const ANSWER = JSON.stringify({ items: [WHITE] });
const STORY = JSON.stringify({ items: [{ name: "putih telur", portion: "1 buah", grams: 50, kcal: 25, protein: 5, carbs: 1, fat: 0, meal: "snack", day: null }] });

/** Workers AI fake: a plain chat completion, or a chat stream when asked to stream. */
const fakeAi = {
  run: (_model: string, body: { stream?: boolean; messages: Array<{ content: unknown }> }) => {
    // A photo scan sends content parts, a story a plain string.
    const text = typeof body.messages[0]?.content === "string" ? STORY : ANSWER;
    if (body.stream !== true) {
      return Promise.resolve({ choices: [{ message: { content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 300, completion_tokens: 9 } });
    }
    const encoder = new TextEncoder();
    const frames: string[] = [];
    for (let i = 0; i < text.length; i += 8) {
      frames.push(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + 8) }, finish_reason: null }] })}\n\n`);
    }
    frames.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
    frames.push(`data: ${JSON.stringify({ response: "", usage: { prompt_tokens: 300, completion_tokens: 9 } })}\n\n`, "data: [DONE]\n\n");
    return Promise.resolve(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const frame of frames) controller.enqueue(encoder.encode(frame));
          controller.close();
        },
      }),
    );
  },
};

/** In-memory R2: only what the scan and the retry touch. */
const objects = new Map<string, { bytes: ArrayBuffer; contentType?: string }>();
const bucket = {
  put: (key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }) => {
    objects.set(key, { bytes: value, contentType: options?.httpMetadata?.contentType });
    return Promise.resolve();
  },
  get: (key: string) => {
    const found = objects.get(key);
    return Promise.resolve(
      found
        ? { body: new ReadableStream(), size: found.bytes.byteLength, arrayBuffer: () => Promise.resolve(found.bytes), httpMetadata: { contentType: found.contentType }, customMetadata: undefined }
        : null,
    );
  },
  delete: (keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    return Promise.resolve();
  },
  list: ({ prefix }: { prefix: string }) => Promise.resolve({ objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }),
} as unknown as StickersBucket;

const background: Promise<unknown>[] = [];
const ctx = (userId: string) =>
  ({
    db,
    env: { AI: fakeAi, STICKERS: bucket },
    locale: "id",
    waitUntil: (promise: Promise<unknown>) => background.push(promise),
    session: { user: { id: userId } },
    requestStartedAt: Date.now(),
  }) as unknown as Context;
const INPUT = { imageBase64: "aGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQ=", mimeType: "image/jpeg" as const };

/** What the usual portion does to the 50 g answer: 100 g, 52 kcal-ish, the model's 50 g in the chip. */
const startsAtUsual = {
  name: "putih telur",
  grams: 100,
  portionPrior: { active: "prior", source: "you", other: { grams: 50 } },
};

describe("the owner's egg white starts at 100 g on every path", () => {
  test("photo scan", async () => {
    const result = await call(aiRouter.analyzeFood, INPUT, { context: ctx("owner") });
    expect(result.items[0]).toMatchObject(startsAtUsual);
    expect(result.items[0]!.kcal).toBeGreaterThanOrEqual(50);
    expect(result.items[0]!.kcal).toBeLessThanOrEqual(54);
  });

  test("stream: the closing done event carries the same answer", async () => {
    const stream = await call(aiRouter.analyzeFoodStream, INPUT, { context: ctx("owner") });
    let done: AnalyzeFoodResult | undefined;
    for await (const event of stream as AsyncIterable<ScanStreamEvent<AnalyzeFoodResult>>) {
      if (event.type === "done") done = event.result;
    }
    expect(done?.items[0]).toMatchObject(startsAtUsual);
  });

  test("Hitung ulang", async () => {
    const first = await call(aiRouter.analyzeFood, INPUT, { context: ctx("owner") });
    expect(first.photoId).not.toBeNull();
    const retry = await call(aiRouter.analyzeFoodRetry, { photoId: first.photoId! }, { context: ctx("owner") });
    expect(retry.items[0]).toMatchObject(startsAtUsual);
  });

  test("Hitung ulang with a count in the hint scales per piece", async () => {
    const first = await call(aiRouter.analyzeFood, INPUT, { context: ctx("owner") });
    const retry = await call(aiRouter.analyzeFoodRetry, { photoId: first.photoId!, hint: "putih telur 3 buah" }, { context: ctx("owner") });
    expect(retry.items[0]).toMatchObject({ name: "putih telur", grams: 300, portionPrior: { active: "prior", other: { grams: 150 } } });
  });

  test("Cerita", async () => {
    const story = await call(aiRouter.describeFood, { text: "makan putih telur", meal: "snack", date: today, slots: ["sarapan", "makan_siang", "makan_malam", "snack"] }, { context: ctx("owner") });
    expect(story.items[0]).toMatchObject(startsAtUsual);
  });

  test("a user without that history gets the model's 50 g untouched, on every path", async () => {
    const scan = await call(aiRouter.analyzeFood, INPUT, { context: ctx("fresh") });
    expect(scan.items[0]).toMatchObject({ name: "putih telur", grams: 50 });
    expect("portionPrior" in scan.items[0]!).toBe(false);
    const retry = await call(aiRouter.analyzeFoodRetry, { photoId: scan.photoId! }, { context: ctx("fresh") });
    expect(retry.items[0]).toMatchObject({ grams: 50 });
    const story = await call(aiRouter.describeFood, { text: "makan putih telur", meal: "snack", date: today, slots: ["sarapan", "makan_siang", "makan_malam", "snack"] }, { context: ctx("fresh") });
    expect(story.items[0]).toMatchObject({ grams: 50 });
  });
});
