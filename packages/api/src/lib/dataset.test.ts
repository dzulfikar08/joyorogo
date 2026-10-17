import { describe, expect, test } from "bun:test";

import {
  datasetEnabled,
  datasetLabel,
  datasetMetaKey,
  datasetPhotoKey,
  itemsDiff,
  recordCorrection,
  recordFeedback,
  recordFinal,
  recordRetry,
  recordScan,
} from "./dataset";
import type { DatasetMeta } from "./dataset";
import type { StickersBucket } from "./sticker";

type Stored = { bytes: ArrayBuffer | string; contentType?: string };

function memoryBucket() {
  const objects = new Map<string, Stored>();
  const bucket: StickersBucket = {
    async put(key, value, options) {
      objects.set(key, {
        bytes: value as ArrayBuffer | string,
        contentType: options?.httpMetadata?.contentType,
      });
    },
    async get(key) {
      const hit = objects.get(key);
      if (!hit) return null;
      const bytes =
        typeof hit.bytes === "string" ? new TextEncoder().encode(hit.bytes).buffer : hit.bytes;
      return {
        body: new ReadableStream(),
        size: bytes.byteLength,
        arrayBuffer: async () => bytes as ArrayBuffer,
        httpMetadata: { contentType: hit.contentType },
      };
    },
    async delete() {},
    async list() {
      return { objects: [], truncated: false };
    },
  };
  return { bucket, objects };
}

const ai = [
  { name: "nasi putih", grams: 150, kcal: 195 },
  { name: "perkedel", grams: 60, kcal: 130 },
  { name: "sambal", grams: 20, kcal: 25 },
];
const scanId = "c".repeat(32);

function metaOf(objects: Map<string, Stored>, userId = "owner"): DatasetMeta {
  return JSON.parse(objects.get(datasetMetaKey(userId, scanId))!.bytes as string);
}

async function started() {
  const { bucket, objects } = memoryBucket();
  await recordScan(bucket, {
    userId: "owner",
    scanId,
    photo: new Uint8Array([1, 2, 3]).buffer,
    mimeType: "image/jpeg",
    model: "@cf/google/gemma-4-26b-a4b-it",
    locale: "id",
    items: ai,
    tooMany: false,
  });
  return { bucket, objects };
}

describe("datasetEnabled", () => {
  test("only listed user ids; unset or empty means nobody", () => {
    expect(datasetEnabled({ DATASET_USER_IDS: "owner" }, "owner")).toBe(true);
    expect(datasetEnabled({ DATASET_USER_IDS: "x, owner ,y" }, "owner")).toBe(true);
    expect(datasetEnabled({ DATASET_USER_IDS: "owner" }, "someone")).toBe(false);
    expect(datasetEnabled({ DATASET_USER_IDS: "" }, "")).toBe(false);
    expect(datasetEnabled({}, "owner")).toBe(false);
  });
});

describe("dataset record over a scan's life", () => {
  test("a scan stores the photo and the first answer under dataset/<user>/<scan>/", async () => {
    const { objects } = await started();
    expect([...objects.keys()].sort()).toEqual([
      `dataset/owner/${scanId}/meta.json`,
      `dataset/owner/${scanId}/photo.jpg`,
    ]);
    expect(objects.get(datasetPhotoKey("owner", scanId))?.contentType).toBe("image/jpeg");
    const meta = metaOf(objects);
    expect(meta.aiItems).toEqual(ai);
    expect(meta.model).toBe("@cf/google/gemma-4-26b-a4b-it");
    expect(meta.retries).toEqual([]);
    expect(meta.final).toBeUndefined();
    expect(datasetLabel(meta)).toBe("unsaved");
  });

  test("saved unchanged is correct", async () => {
    const { bucket, objects } = await started();
    await recordFinal(bucket, "owner", scanId, { meal: "makan_siang", date: "2026-10-17", items: ai });
    const meta = metaOf(objects);
    expect(meta.final?.diff).toEqual({ removed: [], added: [], changed: [] });
    expect(datasetLabel(meta)).toBe("correct");
  });

  test("edited at save: the diff is the label", async () => {
    const { bucket, objects } = await started();
    await recordFinal(bucket, "owner", scanId, {
      meal: "makan_siang",
      date: "2026-10-17",
      items: [
        { name: "nasi putih", grams: 75, kcal: 98 },
        { name: "rolade", grams: 60, kcal: 170 },
      ],
    });
    const meta = metaOf(objects);
    expect(datasetLabel(meta)).toBe("corrected");
    expect(meta.final?.diff.changed.map((c) => c.name)).toEqual(["nasi putih"]);
    expect(meta.final?.diff.removed.map((i) => i.name)).toEqual(["perkedel", "sambal"]);
    expect(meta.final?.diff.added.map((i) => i.name)).toEqual(["rolade"]);
  });

  test("a retry marks the first answer wrong whatever is saved", async () => {
    const { bucket, objects } = await started();
    await recordRetry(bucket, "owner", scanId, {
      model: "m2",
      hint: "ada telur",
      items: [{ name: "telur", kcal: 80 }],
    });
    expect(datasetLabel(metaOf(objects))).toBe("retried");
    await recordFinal(bucket, "owner", scanId, { meal: "sarapan", date: "2026-10-17", items: ai });
    const meta = metaOf(objects);
    expect(meta.retries).toHaveLength(1);
    expect(meta.retries[0]).toMatchObject({ model: "m2", hint: "ada telur" });
    expect(datasetLabel(meta)).toBe("retried");
  });

  test("corrections keep text, transcript and before/after lists", async () => {
    const { bucket, objects } = await started();
    await recordCorrection(bucket, "owner", scanId, {
      via: "voice",
      text: "itu rolade bukan perkedel",
      transcript: "Itu rolade bukan perkedel.",
      model: "m",
      latencyMs: 900,
      before: ai,
      after: [ai[0]!, { name: "rolade", grams: 60, kcal: 170 }, ai[2]!],
      changes: [{ index: 1, kind: "renamed" }],
      removed: [],
    });
    const [correction] = metaOf(objects).corrections;
    expect(correction?.text).toBe("itu rolade bukan perkedel");
    expect(correction?.transcript).toBe("Itu rolade bukan perkedel.");
    expect(correction?.before).toEqual(ai);
    expect(correction?.after[1]?.name).toBe("rolade");
    expect(correction?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("feedback lands in the record", async () => {
    const { bucket, objects } = await started();
    await recordFeedback(bucket, "owner", scanId, { rating: "kurang_akurat", reasons: ["porsi"] });
    expect(metaOf(objects).feedback).toMatchObject({ rating: "kurang_akurat", reasons: ["porsi"] });
  });

  test("a scan with no record (user not on the list then) is left alone and nothing throws", async () => {
    const { bucket, objects } = memoryBucket();
    await recordRetry(bucket, "owner", scanId, { model: "m", items: ai });
    await recordFinal(bucket, "owner", scanId, { meal: "sarapan", date: "2026-10-17", items: ai });
    expect(objects.size).toBe(0);
  });

  test("a bucket failure is swallowed: the scan must not fail over bookkeeping", async () => {
    const { bucket } = memoryBucket();
    const broken: StickersBucket = { ...bucket, put: async () => Promise.reject(new Error("r2 down")) };
    await expect(
      recordScan(broken, {
        userId: "owner",
        scanId,
        photo: new ArrayBuffer(1),
        mimeType: "image/jpeg",
        model: "m",
        locale: "id",
        items: ai,
        tooMany: false,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("itemsDiff", () => {
  test("names compare loosely; kcal and grams within 1 are equal", () => {
    const diff = itemsDiff(
      [{ name: "Nasi Putih", grams: 150, kcal: 195.4 }],
      [{ name: "nasi putih", grams: 150.5, kcal: 195 }],
    );
    expect(diff).toEqual({ removed: [], added: [], changed: [] });
  });

  test("a missing weight on either side is not a difference", () => {
    expect(itemsDiff([{ name: "x", kcal: 10 }], [{ name: "x", grams: 50, kcal: 10 }]).changed).toEqual([]);
  });
});
