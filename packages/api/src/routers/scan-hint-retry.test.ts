// A scan the model could not read ("bukan makanan", unclear) keeps its photo so the person's spoken or typed context
// ("nasi padang pakai tuna balado") can recount it once; other failures drop the photo.

import { call, ORPCError } from "@orpc/server";
import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import type { StickersBucket } from "../lib/sticker";
import { aiRouter } from "./ai";

const { client, db } = await d1TestDb();
await client.executeMultiple(`INSERT INTO "user" (id, name, email) VALUES ('u1', 'u1', 'u1@test.id');`);

const NOT_FOOD = JSON.stringify({ items: [], problem: "bukan_makanan" });
const RENDANG = JSON.stringify({
  items: [{ name: "nasi padang tuna balado", kind: "makanan", portion: "1 porsi", grams: 350, kcal: 600, protein: 25, carbs: 70, fat: 22, confidence: 0.8 }],
});

/** Answers "not food" until a prompt carries the person's hint, then the dish. Records the prompts. */
const prompts: string[] = [];
const fakeAi = (failWith?: Error) => ({
  run: (_model: string, body: { messages: Array<{ content: unknown }> }) => {
    if (failWith) return Promise.reject(failWith);
    const content = body.messages[0]?.content;
    const text = Array.isArray(content)
      ? content.map((part: { text?: string }) => part.text ?? "").join(" ")
      : String(content ?? "");
    prompts.push(text);
    const answer = text.includes("tuna balado") ? RENDANG : NOT_FOOD;
    return Promise.resolve({ choices: [{ message: { content: answer }, finish_reason: "stop" }], usage: { prompt_tokens: 300, completion_tokens: 9 } });
  },
});

const objects = new Map<string, { bytes: ArrayBuffer; meta?: Record<string, string> }>();
const bucket = {
  put: (key: string, value: ArrayBuffer, options?: { customMetadata?: Record<string, string> }) => {
    objects.set(key, { bytes: value, meta: options?.customMetadata });
    return Promise.resolve();
  },
  get: (key: string) => {
    const found = objects.get(key);
    return Promise.resolve(
      found
        ? { body: new ReadableStream(), size: found.bytes.byteLength, arrayBuffer: () => Promise.resolve(found.bytes), httpMetadata: { contentType: "image/jpeg" }, customMetadata: found.meta }
        : null,
    );
  },
  delete: (keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    return Promise.resolve();
  },
  list: ({ prefix }: { prefix: string }) =>
    Promise.resolve({ objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }),
} as unknown as StickersBucket;

const background: Promise<unknown>[] = [];
const ctx = (failWith?: Error) =>
  ({
    db,
    env: { AI: fakeAi(failWith), STICKERS: bucket, SHADOW_SAMPLE_RATE: "0" },
    locale: "id",
    waitUntil: (promise: Promise<unknown>) => background.push(promise),
    session: { user: { id: "u1" } },
    requestStartedAt: Date.now(),
  }) as unknown as Context;
const INPUT = { imageBase64: "aGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQ=", mimeType: "image/jpeg" as const };

const failure = (run: Promise<unknown>) =>
  run.then(
    () => null,
    (e: unknown) => e as ORPCError<string, { reason: string; photoId?: string }>,
  );

describe("a scan the model could not read keeps its photo for a hinted recount", () => {
  test("not_food answers with the photo id, and a recount with the person's words reads the dish", async () => {
    const error = await failure(call(aiRouter.analyzeFood, INPUT, { context: ctx() }));
    await Promise.all(background.splice(0));
    expect(error).toBeInstanceOf(ORPCError);
    expect(error?.data.reason).toBe("not_food");
    const photoId = error?.data.photoId;
    expect(photoId).toBeString();

    const retried = await call(
      aiRouter.analyzeFoodRetry,
      { photoId: photoId!, hint: "nasi padang pakai tuna balado" },
      { context: ctx() },
    );
    expect(retried.items[0]?.name).toContain("tuna balado");
    expect(prompts.at(-1)).toContain("tuna balado");
  });

  test("a failure a hint cannot fix (the model call itself failed) drops the photo and sends no id", async () => {
    objects.clear();
    const error = await failure(call(aiRouter.analyzeFood, INPUT, { context: ctx(new Error("upstream 500")) }));
    await Promise.all(background.splice(0));
    expect(error).toBeInstanceOf(ORPCError);
    expect(error?.data.photoId).toBeUndefined();
    expect([...objects.keys()].filter((key) => key.startsWith("scan-src/"))).toEqual([]);
  });
});
