import { describe, expect, test } from "bun:test";

import {
  SCAN_ID_RE,
  cropRect,
  makeSticker,
  newScanId,
  stickerKey,
  storeStickers,
  type ImagesBinding,
  type StickersBucket,
} from "./sticker";

describe("newScanId", () => {
  test("produces 32 lowercase hex chars", () => {
    for (let i = 0; i < 50; i++) {
      expect(newScanId()).toMatch(SCAN_ID_RE);
    }
  });

  test("ids are unique", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newScanId()));
    expect(ids.size).toBe(200);
  });
});

describe("stickerKey", () => {
  test("maps scan id to the scans/ prefix", () => {
    expect(stickerKey("a".repeat(32))).toBe("scans/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png");
  });
});

describe("makeSticker", () => {
  test("returns null when the images binding is missing", async () => {
    expect(await makeSticker(undefined, new ArrayBuffer(8))).toBeNull();
  });

  test("returns null when the transform fails", async () => {
    const failing = {
      input() {
        throw new Error("boom");
      },
    } as never;
    expect(await makeSticker(failing, new ArrayBuffer(8))).toBeNull();
  });

  test("returns null on non-ok transform response", async () => {
    const binding = {
      input: () => ({
        transform: () => ({
          output: async () => ({ response: () => ({ ok: false, status: 500 }) }),
        }),
      }),
    } as never;
    expect(await makeSticker(binding, new ArrayBuffer(8))).toBeNull();
  });
});

describe("cropRect", () => {
  test("maps a 0-1000 box to padded pixels on the photo", () => {
    // 576x1024 portrait; box covers the left half of the top half.
    expect(cropRect([0, 0, 500, 500], 576, 1024)).toEqual({
      left: 0,
      top: 0,
      width: 300,
      height: 533,
    });
    expect(cropRect([200, 400, 600, 800], 1000, 1000)).toEqual({
      left: 380,
      top: 180,
      width: 440,
      height: 440,
    });
  });

  test("never runs past the photo edges", () => {
    const rect = cropRect([900, 900, 1000, 1000], 640, 480)!;
    expect(rect.left + rect.width).toBeLessThanOrEqual(640);
    expect(rect.top + rect.height).toBeLessThanOrEqual(480);
  });

  test("a box too small to cut a sticker from is rejected", () => {
    expect(cropRect([500, 500, 510, 510], 640, 480, 0)).toBeNull();
  });
});

/** Images binding fake that records each pipeline's trim and returns a PNG. */
function recordingImages(size = { width: 1000, height: 1000 }) {
  const trims: Array<unknown> = [];
  const pipeline = (trim?: unknown) => ({
    transform(options: Record<string, unknown>) {
      return pipeline(options.trim ?? trim);
    },
    async output() {
      trims.push(trim ?? null);
      return { response: () => new Response(new Uint8Array([1, 2, 3])) };
    },
  });
  const binding = { info: async () => size, input: () => pipeline() };
  return { binding: binding as unknown as ImagesBinding, trims };
}

function memoryBucket() {
  const keys: string[] = [];
  const bucket = {
    put: async (key: string) => {
      keys.push(key);
    },
  } as unknown as StickersBucket;
  return { bucket, keys };
}

describe("storeStickers", () => {
  const A = "a".repeat(32);
  const B = "b".repeat(32);

  test("cuts one sticker per boxed item from its own region", async () => {
    const { binding, trims } = recordingImages();
    const { bucket, keys } = memoryBucket();
    await storeStickers(binding, bucket, new ArrayBuffer(8), [
      { scanId: A, box: [0, 0, 500, 500] },
      { scanId: B, box: [500, 500, 1000, 1000] },
    ]);
    expect(keys.sort()).toEqual([stickerKey(A), stickerKey(B)].sort());
    expect(trims).toHaveLength(2);
    expect(trims.every((t) => t !== null)).toBe(true);
  });

  test("an unboxed job segments the whole photo", async () => {
    const { binding, trims } = recordingImages();
    const { bucket, keys } = memoryBucket();
    await storeStickers(binding, bucket, new ArrayBuffer(8), [{ scanId: A }]);
    expect(keys).toEqual([stickerKey(A)]);
    expect(trims).toEqual([null]);
  });

  test("a boxed item with an unusable crop gets no sticker instead of the whole plate", async () => {
    const { binding } = recordingImages({ width: 40, height: 40 });
    const { bucket, keys } = memoryBucket();
    await storeStickers(binding, bucket, new ArrayBuffer(8), [
      { scanId: A, box: [0, 0, 100, 100] },
    ]);
    expect(keys).toEqual([]);
  });
});
