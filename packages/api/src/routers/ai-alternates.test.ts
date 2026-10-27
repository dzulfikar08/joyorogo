// "Mungkin juga": the scan answer's `alt` reaches the item and the ledger, and a tap on a chip runs the
// Koreksi path (ai.correctScan) and is logged on the correction row and on the scan's session.

import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { aiUsage } from "@joyorogo/db/schema/fitness";
import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { loadSession } from "../lib/scan-outcome";
import type { StickersBucket } from "../lib/sticker";
import { aiRouter } from "./ai";

const { client, db } = await d1TestDb();
await client.executeMultiple(`INSERT INTO "user" (id, name, email) VALUES ('u1', 'u1', 'u1@test.id');`);

const SCAN = JSON.stringify({
  items: [
    { name: "nasi kuning", kind: "makanan", portion: "1 piring", grams: 200, kcal: 320, confidence: 0.8, box: [100, 100, 700, 700], alt: ["nasi uduk", "nasi liwet", "nasi kebuli"] },
    { name: "telur rebus", kind: "makanan", portion: "1 butir", grams: 50, kcal: 77, confidence: 0.95, box: [500, 500, 700, 700], alt: [] },
  ],
});
const RENAME = JSON.stringify({ ops: [{ op: "rename", i: 1, name: "nasi uduk", grams: 200, kcal100: 180, protein100: 3, carbs100: 32, fat100: 4 }] });

/** Answers the correction prompt with a rename, every other prompt with the scan. */
const fakeAi = {
  run: (_model: string, body: { messages: Array<{ content: unknown }> }) => {
    const content = body.messages[0]?.content;
    const text = Array.isArray(content) ? content.map((part: { text?: string }) => part.text ?? "").join(" ") : String(content ?? "");
    const answer = text.includes("memperbaiki daftar makanan") ? RENAME : SCAN;
    return Promise.resolve({ choices: [{ message: { content: answer }, finish_reason: "stop" }], usage: { prompt_tokens: 300, completion_tokens: 9 } });
  },
};

const objects = new Map<string, ArrayBuffer>();
const bucket = {
  put: (key: string, value: ArrayBuffer) => {
    objects.set(key, value);
    return Promise.resolve();
  },
  get: (key: string) => {
    const found = objects.get(key);
    return Promise.resolve(found ? { body: new ReadableStream(), size: found.byteLength, arrayBuffer: () => Promise.resolve(found), httpMetadata: { contentType: "image/jpeg" } } : null);
  },
  delete: () => Promise.resolve(),
  list: () => Promise.resolve({ objects: [], truncated: false }),
} as unknown as StickersBucket;

const background: Promise<unknown>[] = [];
const ctx = () =>
  ({
    db,
    env: { AI: fakeAi, STICKERS: bucket, SHADOW_SAMPLE_RATE: "0" },
    locale: "id",
    waitUntil: (promise: Promise<unknown>) => background.push(promise),
    session: { user: { id: "u1" } },
    requestStartedAt: Date.now(),
  }) as unknown as Context;

const INPUT = { imageBase64: "aGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQ=", mimeType: "image/jpeg" as const };

describe("alternate dish names", () => {
  test("the scan carries alt on the item that has it, and the ledger keeps what the user saw", async () => {
    const scan = await call(aiRouter.analyzeFood, INPUT, { context: ctx() });
    await Promise.all(background.splice(0));
    expect(scan.items[0]!.alt).toEqual(["nasi uduk", "nasi liwet"]);
    expect("alt" in scan.items[1]!).toBe(false);
    const { session } = (await loadSession(db, "u1", scan.photoId!))!;
    expect(session.aiItems?.[0]?.a).toEqual(["nasi uduk", "nasi liwet"]);
    expect(session.aiItems?.[1]).not.toHaveProperty("a");
  });

  test("a chip tap is a correction: the dish is renamed, and the tap is logged on the ledger row and the scan", async () => {
    const scan = await call(aiRouter.analyzeFood, INPUT, { context: ctx() });
    await Promise.all(background.splice(0));
    const patch = await call(
      aiRouter.correctScan,
      {
        photoId: scan.photoId!,
        items: scan.items.map(({ name, portion, grams, kcal }) => ({ name, portion, grams, kcal })),
        text: "bukan nasi kuning, nasi uduk",
        altTap: { from: "nasi kuning", to: "nasi uduk" },
      },
      { context: ctx() },
    );
    await Promise.all(background.splice(0));
    expect(patch.items[0]!.name).toBe("nasi uduk");
    expect(patch.changes).toEqual([{ index: 0, kind: "renamed" }]);

    const { session } = (await loadSession(db, "u1", scan.photoId!))!;
    expect(session.corrections).toBe(1);
    expect(session.altTaps).toEqual([{ f: "nasi kuning", t: "nasi uduk" }]);

    const rows = await db.select().from(aiUsage).where(eq(aiUsage.scanType, "correction"));
    const logged = rows.map((row) => JSON.parse(row.usageJson ?? "{}") as { altTap?: unknown; outcome?: string });
    expect(logged).toEqual([expect.objectContaining({ outcome: "ok", altTap: { from: "nasi kuning", to: "nasi uduk" } })]);
  });

  test("a typed correction logs no tap", async () => {
    const scan = await call(aiRouter.analyzeFood, INPUT, { context: ctx() });
    await Promise.all(background.splice(0));
    await call(
      aiRouter.correctScan,
      { photoId: scan.photoId!, items: scan.items.map(({ name, kcal }) => ({ name, kcal })), text: "itu nasi uduk" },
      { context: ctx() },
    );
    await Promise.all(background.splice(0));
    const { session } = (await loadSession(db, "u1", scan.photoId!))!;
    expect(session.corrections).toBe(1);
    expect(session.altTaps).toBeUndefined();
  });
});
