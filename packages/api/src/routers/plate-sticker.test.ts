// Whole-plate stickers, barcode product stickers and the opt-in kept pack photo through the food and barcode routers.

import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { LABEL_PROMPT } from "../lib/barcode-label";
import { productStickerKey } from "../lib/barcode-image";
import { makePng } from "../lib/png-fixture";
import { pendingStickerKey, stickerKey } from "../lib/sticker";
import type { ImagesBinding } from "../lib/sticker";
import { barcodeRouter } from "./barcode";
import { foodRouter } from "./food";

const { client, db } = await d1TestDb();
await client.executeMultiple(`INSERT INTO "user" (id, name, email) VALUES ('u1', 'u1', 'u1@test.id'), ('u2', 'u2', 'u2@test.id');`);

type Stored = { bytes: ArrayBuffer; userId?: string };
const objects = new Map<string, Stored>();
const bucket = {
  put: async (key: string, value: ArrayBuffer, options?: { customMetadata?: Record<string, string> }) => {
    objects.set(key, { bytes: value, userId: options?.customMetadata?.userId });
  },
  get: async (key: string) => {
    const found = objects.get(key);
    return found
      ? { size: found.bytes.byteLength, arrayBuffer: async () => found.bytes, customMetadata: { userId: found.userId ?? "" } }
      : null;
  },
  delete: async (keys: string | string[]) => {
    for (const key of [keys].flat()) objects.delete(key);
  },
};

/** Whole-photo segmentation answers a plate in a 400x300 frame; trims answer 3 bytes. */
const plate = (x: number, y: number) => (x >= 100 && x < 300 && y >= 60 && y < 240 ? 255 : 0);
const segmented = makePng(400, 300, plate);
const images: ImagesBinding = {
  info: async () => ({ width: 400, height: 300 }),
  input: () => {
    const pipeline = (options: Record<string, unknown>): ReturnType<ImagesBinding["input"]> => ({
      transform: (next) => pipeline({ ...options, ...next }),
      output: async () => ({
        response: () => new Response(options.trim ? new Uint8Array([5, 5, 5]) : segmented),
      }),
    });
    return pipeline({});
  },
};

const background: Array<Promise<unknown>> = [];
const asUser = (id: string) => ({
  context: {
    db,
    env: { STICKERS: bucket, IMAGES: images },
    waitUntil: (work: Promise<unknown>) => {
      background.push(work);
    },
    session: { user: { id } },
  } as unknown as Context,
});
const u1 = asUser("u1");
const settle = async () => {
  await Promise.all(background.splice(0));
};

const PHOTO = Buffer.from("x".repeat(64)).toString("base64");
const items = [
  { name: "Nasi", kcal: 200, box: [100, 100, 500, 500] },
  { name: "Ayam", kcal: 250, box: [500, 500, 900, 900] },
];
const scan = (extra: Record<string, unknown> = {}) =>
  call(foodRouter.addScan, { meal: "makan_siang", imageBase64: PHOTO, mimeType: "image/jpeg", items, ...extra }, u1);

describe("food.addScan plate sticker", () => {
  test("the pending plate sticker is promoted and stored on every row of the scan", async () => {
    const id = "1".repeat(32);
    objects.set(pendingStickerKey(id), { bytes: new Uint8Array([4, 2]).buffer, userId: "u1" });
    const { items: rows } = await scan({ plateScanId: id });
    await settle();
    expect(rows.map((row) => row.plateScanId)).toEqual([id, id]);
    expect(new Uint8Array(objects.get(stickerKey(id))!.bytes)).toEqual(new Uint8Array([4, 2]));
    // Component stickers keep their own ids, next to the plate's.
    expect(rows.every((row) => row.scanId && row.scanId !== id)).toBe(true);
  });

  test("a plate sticker that is not ready is cut from the photo under a new id", async () => {
    const asked = "2".repeat(32);
    const { items: rows } = await scan({ plateScanId: asked });
    await settle();
    const id = rows[0]!.plateScanId!;
    expect(id).not.toBe(asked);
    expect(rows[1]!.plateScanId).toBe(id);
    expect(objects.has(stickerKey(id))).toBe(true);
    expect(objects.has(stickerKey(asked))).toBe(false);
  });

  test("someone else's pending sticker is never promoted", async () => {
    const theirs = "3".repeat(32);
    objects.set(pendingStickerKey(theirs), { bytes: new Uint8Array([6]).buffer, userId: "u2" });
    const { items: rows } = await scan({ plateScanId: theirs });
    await settle();
    expect(rows[0]!.plateScanId).not.toBe(theirs);
    expect(objects.has(stickerKey(theirs))).toBe(false);
  });

  test("builds that send no plate sticker id get none, as before", async () => {
    const before = objects.size;
    const { items: rows } = await scan();
    await settle();
    expect(rows.map((row) => row.plateScanId)).toEqual([null, null]);
    // only the two component stickers were cut
    expect(objects.size - before).toBe(2);
  });

  test("removing rows keeps the plate sticker until the scan's last row is gone", async () => {
    const id = "4".repeat(32);
    objects.set(pendingStickerKey(id), { bytes: new Uint8Array([4]).buffer, userId: "u1" });
    const { items: rows } = await scan({ plateScanId: id });
    await settle();
    await call(foodRouter.remove, { id: rows[0]!.id }, u1);
    expect(objects.has(stickerKey(id))).toBe(true);
    await call(foodRouter.remove, { id: rows[1]!.id }, u1);
    expect(objects.has(stickerKey(id))).toBe(false);
  });
});

describe("food.add barcode product sticker", () => {
  const CODE = "8999999000011";
  const itemsJson = JSON.stringify({ barcode: CODE, brand: "X", source: "off" });
  const log = (extra: Record<string, unknown> = {}) =>
    call(foodRouter.add, { meal: "snack", name: "Biskuit", kcal: 120, source: "barcode", itemsJson, ...extra }, u1);
  const original = globalThis.fetch;

  async function seedProduct(imageUrl: string | null) {
    await client.execute({ sql: `DELETE FROM barcode_product WHERE code = ?`, args: [CODE] });
    await client.execute({
      sql: `INSERT INTO barcode_product (code, status, source, name, kcal_100, image_url) VALUES (?, 'found', 'off', 'Biskuit', 450, ?)`,
      args: [CODE, imageUrl],
    });
  }

  test("a logged product gets its front photo as the row's sticker", async () => {
    await seedProduct("https://images.openfoodfacts.org/images/products/front.400.jpg");
    globalThis.fetch = (async () =>
      new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } })) as unknown as typeof fetch;
    try {
      const row = await log();
      await settle();
      expect(row!.scanId).toMatch(/^[a-f0-9]{32}$/);
      expect(objects.has(stickerKey(row!.scanId!))).toBe(true);
      expect(objects.has(productStickerKey(CODE))).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a photo cutout the client already has wins over the product photo", async () => {
    await seedProduct("https://images.openfoodfacts.org/images/products/front.400.jpg");
    const mine = "5".repeat(32);
    objects.set(pendingStickerKey(mine), { bytes: new Uint8Array([7, 7]).buffer, userId: "u1" });
    objects.delete(productStickerKey(CODE));
    const row = await log({ scanId: mine });
    await settle();
    expect(row!.scanId).toBe(mine);
    expect(new Uint8Array(objects.get(stickerKey(mine))!.bytes)).toEqual(new Uint8Array([7, 7]));
    // The product photo was never fetched or cut for this row.
    expect(objects.has(productStickerKey(CODE))).toBe(false);
  });

  test("a kept cutout that expired or is someone else's falls back to the product photo", async () => {
    await seedProduct("https://images.openfoodfacts.org/images/products/front.400.jpg");
    globalThis.fetch = (async () =>
      new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } })) as unknown as typeof fetch;
    try {
      const gone = "6".repeat(32);
      const expired = await log({ scanId: gone });
      const theirs = "7".repeat(32);
      objects.set(pendingStickerKey(theirs), { bytes: new Uint8Array([9]).buffer, userId: "u2" });
      const stolen = await log({ scanId: theirs });
      await settle();
      for (const [row, asked] of [[expired, gone], [stolen, theirs]] as const) {
        expect(row!.scanId).toMatch(/^[a-f0-9]{32}$/);
        expect(row!.scanId).not.toBe(asked);
        expect(objects.has(stickerKey(asked))).toBe(false);
        expect(objects.has(stickerKey(row!.scanId!))).toBe(true);
      }
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a product without a usable photo stays without a sticker", async () => {
    await seedProduct(null);
    expect((await log())!.scanId).toBeNull();
    await seedProduct("https://evil.example/front.jpg");
    expect((await log())!.scanId).toBeNull();
  });

  test("only barcode meals are looked up", async () => {
    await seedProduct("https://images.openfoodfacts.org/images/products/front.400.jpg");
    const row = await log({ source: "manual" });
    expect(row!.scanId).toBeNull();
  });
});

describe("barcode.readLabel keepFront (opt-in pack photo sticker)", () => {
  const CODE = "8999999000028";
  const LABEL_ANSWER = JSON.stringify({
    servingSize: 34,
    unit: "g",
    perServing: { kcal: 180, protein: 2, carbs: 18, fat: 11, fiber: 1, sugar: 1 },
  });
  const ai = (answer: string) => ({
    run: (_model: string, input: unknown) => {
      const text = (input as { messages: Array<{ content: Array<{ text?: string }> }> }).messages[0]!.content[0]!.text;
      return Promise.resolve({ response: text === LABEL_PROMPT ? answer : JSON.stringify({ name: "Keripik", brand: "X" }) });
    },
  });
  const readAs = (userId: string, answer: string, extra: Record<string, unknown>) =>
    call(
      barcodeRouter.readLabel,
      { code: CODE, label: { imageBase64: PHOTO, mimeType: "image/jpeg" }, front: { imageBase64: PHOTO, mimeType: "image/jpeg" }, ...extra },
      {
        context: {
          db,
          env: { AI: ai(answer), AI_VISION_MODEL: "m", STICKERS: bucket, IMAGES: images },
          locale: "id",
          waitUntil: (work: Promise<unknown>) => {
            background.push(work);
          },
          session: { user: { id: userId } },
        } as unknown as Context,
      },
    );
  const pendingKeys = () => [...objects.keys()].filter((key) => key.startsWith("scan-src/stk/"));

  test("off by default: nothing of the photos is kept", async () => {
    const before = pendingKeys().length;
    const result = await readAs("u1", LABEL_ANSWER, {});
    await settle();
    expect(result.stickerScanId).toBeNull();
    expect(pendingKeys()).toHaveLength(before);
  });

  test("opted in: the front photo's cutout is parked for the user and logs as the meal's sticker", async () => {
    const result = await readAs("u1", LABEL_ANSWER, { keepFront: true });
    await settle();
    const id = result.stickerScanId!;
    expect(id).toMatch(/^[a-f0-9]{32}$/);
    expect(objects.get(pendingStickerKey(id))?.userId).toBe("u1");
    const row = await call(
      foodRouter.add,
      { meal: "snack", name: "Keripik", kcal: 100, source: "barcode", itemsJson: JSON.stringify({ barcode: CODE, source: "label_photo" }), scanId: id },
      u1,
    );
    expect(row!.scanId).toBe(id);
    expect(objects.has(stickerKey(id))).toBe(true);
  });

  test("opted in without a front photo keeps nothing", async () => {
    const before = pendingKeys().length;
    const result = await readAs("u1", LABEL_ANSWER, { keepFront: true, front: undefined });
    await settle();
    expect(result.stickerScanId).toBeNull();
    expect(pendingKeys()).toHaveLength(before);
  });

  test("a label that cannot be read leaves no cutout behind", async () => {
    const before = pendingKeys().length;
    await readAs("u1", JSON.stringify({ problem: "buram" }), { keepFront: true }).catch(() => undefined);
    await settle();
    expect(pendingKeys()).toHaveLength(before);
  });
});
