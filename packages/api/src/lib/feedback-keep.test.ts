import { describe, expect, test } from "bun:test";

import {
  feedbackMetaKey,
  feedbackPhotoKey,
  keepFeedbackPhoto,
  recordKeptSaved,
} from "./feedback-keep";
import type { FeedbackKeepMeta } from "./feedback-keep";
import { deleteUserMedia } from "./privacy";
import { scanSrcKey } from "./sticker";
import type { StickersBucket } from "./sticker";

function fakeBucket(): StickersBucket & { store: Map<string, { bytes: ArrayBuffer; type?: string }> } {
  const store = new Map<string, { bytes: ArrayBuffer; type?: string }>();
  const toBytes = (value: ArrayBuffer | ReadableStream | string): ArrayBuffer =>
    typeof value === "string" ? (new TextEncoder().encode(value).buffer as ArrayBuffer) : (value as ArrayBuffer);
  return {
    store,
    async put(key, value, options) {
      store.set(key, { bytes: toBytes(value), type: options?.httpMetadata?.contentType });
    },
    async get(key) {
      const hit = store.get(key);
      if (!hit) return null;
      return {
        body: new ReadableStream(),
        size: hit.bytes.byteLength,
        arrayBuffer: async () => hit.bytes,
        httpMetadata: { contentType: hit.type },
      };
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
    },
    async list({ prefix }) {
      return { objects: [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false };
    },
  };
}

const meta = (photoId: string): FeedbackKeepMeta => ({
  version: 1,
  photoId,
  userId: "u1",
  createdAt: "2026-10-17T00:00:00.000Z",
  source: "web",
  rating: "kurang_akurat",
  reasons: ["porsi"],
  note: "nasi goreng kebanyakan",
  afterRetry: false,
  aiItems: [{ n: "nasi goreng", g: 400, k: 800 }],
});

describe("keepFeedbackPhoto", () => {
  test("copies the scan-src photo and writes the meta; the temporary copy is left to expire", async () => {
    const bucket = fakeBucket();
    await bucket.put(scanSrcKey("u1", "p1"), new Uint8Array([1, 2, 3]).buffer, { httpMetadata: { contentType: "image/png" } });
    expect(await keepFeedbackPhoto(bucket, meta("p1"))).toBe(true);
    expect(new Uint8Array(bucket.store.get(feedbackPhotoKey("u1", "p1"))!.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(bucket.store.get(feedbackPhotoKey("u1", "p1"))!.type).toBe("image/png");
    const saved = JSON.parse(new TextDecoder().decode(bucket.store.get(feedbackMetaKey("u1", "p1"))!.bytes));
    expect(saved.note).toBe("nasi goreng kebanyakan");
  });

  test("an expired photo keeps nothing", async () => {
    const bucket = fakeBucket();
    expect(await keepFeedbackPhoto(bucket, meta("gone"))).toBe(false);
    expect(bucket.store.size).toBe(0);
  });

  test("the later diary save lands in the kept meta", async () => {
    const bucket = fakeBucket();
    await bucket.put(scanSrcKey("u1", "p2"), new ArrayBuffer(4));
    await keepFeedbackPhoto(bucket, meta("p2"));
    await recordKeptSaved(bucket, "u1", "p2", { items: [{ n: "nasi goreng", g: 250, k: 500 }], at: 5 });
    const saved = JSON.parse(new TextDecoder().decode(bucket.store.get(feedbackMetaKey("u1", "p2"))!.bytes));
    expect(saved.savedItems).toEqual([{ n: "nasi goreng", g: 250, k: 500 }]);
    expect(saved.savedAt).toBe(5);
  });
});

describe("deleteUserMedia", () => {
  test("removes the user's kept feedback photos and nobody else's", async () => {
    const bucket = fakeBucket();
    for (const user of ["u1", "u2"]) {
      await bucket.put(scanSrcKey(user, "p"), new ArrayBuffer(1));
      await keepFeedbackPhoto(bucket, { ...meta("p"), userId: user });
    }
    await deleteUserMedia(bucket, "u1", []);
    expect([...bucket.store.keys()].filter((k) => k.includes("/u1/"))).toEqual([]);
    expect(bucket.store.has(feedbackPhotoKey("u2", "p"))).toBe(true);
  });
});
