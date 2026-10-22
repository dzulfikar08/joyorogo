import { describe, expect, test } from "bun:test";

import { barcodeFromItemsJson, isProductImageUrl, productStickerKey, storeProductSticker } from "./barcode-image";
import { makePng } from "./png-fixture";
import {
  pendingStickerKey,
  stickerKey,
  storePendingPlateSticker,
  storePlateStickerFromPhoto,
  trimPlateCutout,
  type ImagesBinding,
  type StickersBucket,
  type WholeCutout,
} from "./sticker";

const ID = "a".repeat(32);
const CROP = new Uint8Array([9, 9, 9]).buffer;

/** A plate in the middle of a 400x300 frame: opaque from (100,60) to (300,240). */
const plate = (x: number, y: number) => (x >= 100 && x < 300 && y >= 60 && y < 240 ? 255 : 0);

/** Images binding fake: a whole-photo segmentation answers `segmented`; a trim answers CROP and is recorded. */
function fakeImages(segmented: ArrayBuffer | null) {
  const calls: Array<Record<string, unknown>> = [];
  const pipeline = (options: Record<string, unknown>) => ({
    transform: (next: Record<string, unknown>) => pipeline({ ...options, ...next }),
    output: async () => {
      calls.push(options);
      if (options.trim) return { response: () => new Response(CROP) };
      return { response: () => (segmented ? new Response(segmented) : new Response("no", { status: 500 })) };
    },
  });
  const binding: ImagesBinding = {
    info: async () => ({ width: 400, height: 300 }),
    input: () => pipeline({}),
  };
  return { binding, calls };
}

function fakeBucket(seed: Record<string, { bytes: ArrayBuffer; userId?: string }> = {}) {
  const objects = new Map(Object.entries(seed));
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
  } as unknown as StickersBucket;
  return { bucket, objects };
}

const whole = (png: ArrayBuffer): WholeCutout => ({ png, width: 400, height: 300, doneAt: 0 });

describe("trimPlateCutout", () => {
  test("crops to the plate's silhouette with a little room around it", async () => {
    const { binding, calls } = fakeImages(null);
    const trimmed = await trimPlateCutout(binding, whole(makePng(400, 300, plate)));
    expect(new Uint8Array(trimmed)).toEqual(new Uint8Array(CROP));
    // 200 x 180 box, padded by 3% of the longer side (6 px).
    expect(calls[0]?.trim).toEqual({ left: 94, top: 54, width: 212, height: 192 });
  });

  test("keeps the cutout whole when it is not an image it can read", async () => {
    const { binding, calls } = fakeImages(null);
    const png = new Uint8Array([1, 2, 3]).buffer;
    expect(await trimPlateCutout(binding, whole(png))).toBe(png);
    expect(calls).toHaveLength(0);
  });

  test("keeps the cutout whole when the plate already fills the frame", async () => {
    const { binding, calls } = fakeImages(null);
    const png = makePng(400, 300, () => 255);
    expect(await trimPlateCutout(binding, whole(png))).toBe(png);
    expect(calls).toHaveLength(0);
  });

  test("falls back to the untrimmed cutout when the crop fails", async () => {
    const failing: ImagesBinding = {
      info: async () => ({}),
      input: () => ({
        transform: () => failing.input(new ArrayBuffer(0)),
        output: async () => {
          throw new Error("boom");
        },
      }),
    };
    const png = makePng(400, 300, plate);
    expect(await trimPlateCutout(failing, whole(png))).toBe(png);
  });
});

describe("plate sticker storage", () => {
  test("the pending plate sticker lands under the expiring prefix with its owner", async () => {
    const { binding } = fakeImages(null);
    const { bucket, objects } = fakeBucket();
    const ok = await storePendingPlateSticker(binding, bucket, "u1", ID, Promise.resolve(whole(makePng(400, 300, plate))));
    expect(ok).toBe(true);
    expect(objects.get(pendingStickerKey(ID))).toMatchObject({ userId: "u1" });
    expect(new Uint8Array(objects.get(pendingStickerKey(ID))!.bytes)).toEqual(new Uint8Array(CROP));
  });

  test("nothing is stored when the whole-photo cutout failed", async () => {
    const { binding } = fakeImages(null);
    const { bucket, objects } = fakeBucket();
    expect(await storePendingPlateSticker(binding, bucket, "u1", ID, Promise.resolve(null))).toBe(false);
    expect(objects.size).toBe(0);
  });

  test("cutting from the saved photo writes the final key", async () => {
    const { binding, calls } = fakeImages(makePng(400, 300, plate));
    const { bucket, objects } = fakeBucket();
    await storePlateStickerFromPhoto(binding, bucket, new ArrayBuffer(8), ID);
    expect([...objects.keys()]).toEqual([stickerKey(ID)]);
    expect(calls[0]).toMatchObject({ segment: "foreground", width: 400 });
  });

  test("a failed segmentation stores nothing and does not throw", async () => {
    const { binding } = fakeImages(null);
    const { bucket, objects } = fakeBucket();
    await storePlateStickerFromPhoto(binding, bucket, new ArrayBuffer(8), ID);
    expect(objects.size).toBe(0);
  });
});

describe("barcode product stickers", () => {
  const CODE = "8999999000011";
  const URL_OK = "https://images.openfoodfacts.org/images/products/899/999/900/0011/front_en.5.400.jpg";

  test("only Open Food Facts https images are fetched", () => {
    expect(isProductImageUrl(URL_OK)).toBe(true);
    expect(isProductImageUrl("https://static.openfoodfacts.org/a.jpg")).toBe(true);
    expect(isProductImageUrl("http://images.openfoodfacts.org/a.jpg")).toBe(false);
    expect(isProductImageUrl("https://evil.example/openfoodfacts.org/a.jpg")).toBe(false);
    expect(isProductImageUrl("https://openfoodfacts.org.evil.example/a.jpg")).toBe(false);
    expect(isProductImageUrl("not a url")).toBe(false);
    expect(isProductImageUrl(null)).toBe(false);
  });

  test("the barcode comes from the row's itemsJson and is normalized", () => {
    expect(barcodeFromItemsJson(JSON.stringify({ barcode: "8999999000011", brand: "X" }))).toBe(CODE);
    expect(barcodeFromItemsJson(JSON.stringify({ barcode: "123" }))).toBeNull();
    expect(barcodeFromItemsJson(JSON.stringify([{ name: "ai item" }]))).toBeNull();
    expect(barcodeFromItemsJson("not json")).toBeNull();
    expect(barcodeFromItemsJson(undefined)).toBeNull();
  });

  test("the first log cuts the product and caches it; the next copies the cache", async () => {
    const original = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-type": "image/jpeg" } });
    }) as unknown as typeof fetch;
    try {
      const { binding } = fakeImages(new Uint8Array([7, 7]).buffer);
      const { bucket, objects } = fakeBucket();
      const first = "b".repeat(32);
      const second = "c".repeat(32);
      await storeProductSticker(binding, bucket, CODE, URL_OK, first);
      await storeProductSticker(binding, bucket, CODE, URL_OK, second);
      expect(fetches).toBe(1);
      expect([...objects.keys()].sort()).toEqual([productStickerKey(CODE), stickerKey(first), stickerKey(second)].sort());
      expect(new Uint8Array(objects.get(stickerKey(second))!.bytes)).toEqual(new Uint8Array([7, 7]));
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a segmentation failure still stores the plain product photo", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-type": "image/jpeg" } })) as unknown as typeof fetch;
    try {
      // Segmentation answers 500; the plain resize (no `segment`) answers the same fake, so make that one succeed.
      const calls: Array<Record<string, unknown>> = [];
      const pipeline = (options: Record<string, unknown>) => ({
        transform: (next: Record<string, unknown>) => pipeline({ ...options, ...next }),
        output: async () => {
          calls.push(options);
          return { response: () => (options.segment ? new Response("no", { status: 500 }) : new Response(CROP)) };
        },
      });
      const binding = { info: async () => ({}), input: () => pipeline({}) } as unknown as ImagesBinding;
      const { bucket, objects } = fakeBucket();
      await storeProductSticker(binding, bucket, CODE, URL_OK, ID);
      expect(new Uint8Array(objects.get(stickerKey(ID))!.bytes)).toEqual(new Uint8Array(CROP));
      expect(calls.some((call) => call.segment === "foreground")).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a failed download stores nothing", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("gone", { status: 404 })) as unknown as typeof fetch;
    try {
      const { binding } = fakeImages(null);
      const { bucket, objects } = fakeBucket();
      await storeProductSticker(binding, bucket, CODE, URL_OK, ID);
      expect(objects.size).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});
