import { describe, expect, test } from "bun:test";

import {
  SCAN_ID_RE,
  claimBoxSticker,
  cropRect,
  cutBoxSticker,
  makeBoxSticker,
  makeSticker,
  markBoxPending,
  newScanId,
  runScanStickers,
  pendingStickerKey,
  stickerKey,
  storeStickers,
  waitBoxSticker,
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

describe("makeBoxSticker / pendingStickerKey", () => {
  test("pending stickers live under the expiring scan-src/ prefix", () => {
    expect(pendingStickerKey("a".repeat(32))).toBe(`scan-src/stk/${"a".repeat(32)}.png`);
  });

  test("segments only the boxed region", async () => {
    const { binding, trims } = recordingImages();
    const png = await makeBoxSticker(binding, new ArrayBuffer(8), [0, 0, 500, 500]);
    expect(png).not.toBeNull();
    expect(trims).toHaveLength(1);
    expect(trims[0]).not.toBeNull();
  });

  test("an unusable box yields null without a transform", async () => {
    const { binding, trims } = recordingImages({ width: 40, height: 40 });
    expect(await makeBoxSticker(binding, new ArrayBuffer(8), [0, 0, 100, 100])).toBeNull();
    expect(trims).toHaveLength(0);
  });

  test("null when the image info cannot be read", async () => {
    const binding = {
      info: async () => {
        throw new Error("boom");
      },
    } as unknown as ImagesBinding;
    expect(await makeBoxSticker(binding, new ArrayBuffer(8), [0, 0, 500, 500])).toBeNull();
  });
});

/** In-memory R2 stand-in with metadata and prefix listing. */
function ledgerBucket() {
  const store = new Map<string, { customMetadata?: Record<string, string> }>();
  const bucket = {
    put: async (key: string, _v: unknown, options?: { customMetadata?: Record<string, string> }) => {
      store.set(key, { customMetadata: options?.customMetadata });
    },
    get: async (key: string) => store.get(key) ?? null,
    list: async ({ prefix }: { prefix: string }) => ({
      objects: [...store.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })),
      truncated: false,
    }),
  } as unknown as StickersBucket;
  return { bucket, store };
}

describe("box sticker ledger", () => {
  const PHOTO = "scan-src/u1/" + "p".repeat(32);
  const BOX = [0, 0, 500, 500] as const;

  test("first claim wins, then the box reports pending and later its sticker", async () => {
    const { bucket } = ledgerBucket();
    expect(await claimBoxSticker(bucket, PHOTO, BOX, 36)).toEqual({ kind: "claimed" });
    expect(await claimBoxSticker(bucket, PHOTO, BOX, 36)).toEqual({
      kind: "existing",
      scanId: null,
      pending: true,
      final: false,
    });
    const { binding } = recordingImages();
    const id = await cutBoxSticker(binding, bucket, "u1", PHOTO, new ArrayBuffer(8), BOX);
    expect(id).toMatch(SCAN_ID_RE);
    expect(await claimBoxSticker(bucket, PHOTO, BOX, 36)).toEqual({
      kind: "existing",
      scanId: id,
      pending: false,
      final: true,
    });
  });

  test("a failed cut is remembered so the box is not cut again", async () => {
    const { bucket } = ledgerBucket();
    await claimBoxSticker(bucket, PHOTO, BOX, 36);
    const { binding, trims } = recordingImages({ width: 40, height: 40 });
    expect(await cutBoxSticker(binding, bucket, "u1", PHOTO, new ArrayBuffer(8), BOX)).toBeNull();
    expect(trims).toHaveLength(0);
    expect(await claimBoxSticker(bucket, PHOTO, BOX, 36)).toEqual({
      kind: "existing",
      scanId: null,
      pending: false,
      final: true,
    });
  });

  test("the per-photo cap stops new boxes but not known ones", async () => {
    const { bucket } = ledgerBucket();
    await claimBoxSticker(bucket, PHOTO, [0, 0, 100, 100], 2);
    await claimBoxSticker(bucket, PHOTO, [0, 0, 200, 200], 2);
    expect(await claimBoxSticker(bucket, PHOTO, [0, 0, 300, 300], 2)).toEqual({ kind: "capped" });
    expect((await claimBoxSticker(bucket, PHOTO, [0, 0, 100, 100], 2)).kind).toBe("existing");
  });

  test("a stale pending claim is taken over", async () => {
    const { bucket, store } = ledgerBucket();
    await claimBoxSticker(bucket, PHOTO, BOX, 36);
    for (const entry of store.values()) {
      if (entry.customMetadata?.state === "pending") {
        entry.customMetadata.at = String(Date.now() - 60_000);
      }
    }
    expect(await claimBoxSticker(bucket, PHOTO, BOX, 36)).toEqual({ kind: "claimed" });
  });

  test("waitBoxSticker returns the id once the cut settles, null on timeout", async () => {
    const { bucket } = ledgerBucket();
    await markBoxPending(bucket, PHOTO, BOX);
    expect((await waitBoxSticker(bucket, PHOTO, BOX, 50)).scanId).toBeNull();
    const { binding } = recordingImages();
    const waiting = waitBoxSticker(bucket, PHOTO, BOX, 5_000);
    const id = await cutBoxSticker(binding, bucket, "u1", PHOTO, new ArrayBuffer(8), BOX);
    expect(await waiting).toEqual({ scanId: id, final: true });
  });

  test("a quick marker answers 'any' at once and 'final' only after the refinement", async () => {
    const { bucket } = ledgerBucket();
    await bucket.put(`${PHOTO}.stk/${BOX.join("-")}`, "", {
      customMetadata: { state: "quick", scanId: "q".repeat(32), at: String(Date.now()) },
    });
    expect(await waitBoxSticker(bucket, PHOTO, BOX, 50, "any")).toEqual({
      scanId: "q".repeat(32),
      final: false,
    });
    expect(await waitBoxSticker(bucket, PHOTO, BOX, 50, "final")).toEqual({
      scanId: "q".repeat(32),
      final: false,
    });
    expect(await claimBoxSticker(bucket, PHOTO, BOX, 36)).toEqual({
      kind: "existing",
      scanId: "q".repeat(32),
      pending: false,
      final: false,
    });
  });
});

describe("runScanStickers", () => {
  const PHOTO = "scan-src/u1/" + "p".repeat(32);
  const BOX = [0, 0, 500, 500] as const;

  function setup(wholeResult: "ok" | "fail", refine: boolean) {
    const { binding, trims } = recordingImages();
    const { bucket, store } = ledgerBucket();
    const states: string[] = [];
    const put = bucket.put.bind(bucket);
    bucket.put = async (key, value, options) => {
      if (key.includes(".stk/")) states.push(options?.customMetadata?.state ?? "?");
      return put(key, value, options);
    };
    const whole = Promise.resolve(
      wholeResult === "ok"
        ? { png: new ArrayBuffer(8), width: 1000, height: 1000, doneAt: Date.now() }
        : null,
    );
    const run = () =>
      runScanStickers({
        images: binding,
        bucket,
        userId: "u1",
        photoKey: PHOTO,
        bytes: new ArrayBuffer(8),
        boxes: [BOX],
        size: { width: 1000, height: 1000 },
        whole,
        refine,
        startedAt: Date.now(),
      });
    return { run, trims, states, store };
  }

  test("refine on: quick crop first, then the refined per-box cut wins", async () => {
    const { run, trims, states, store } = setup("ok", true);
    const timing = await run();
    // One crop of the whole cutout, one per-box segmentation.
    expect(trims).toHaveLength(2);
    expect(states.at(-1)).toBe("done");
    const marker = store.get(`${PHOTO}.stk/${BOX.join("-")}`)!.customMetadata!;
    expect(marker.state).toBe("done");
    expect(marker.scanId).toMatch(SCAN_ID_RE);
    expect(timing.quickMs[0]).not.toBeNull();
    expect(timing.finalMs[0]).not.toBeNull();
  });

  test("refine off: the quick crop is final and no per-box segmentation runs", async () => {
    const { run, trims, store } = setup("ok", false);
    const timing = await run();
    expect(trims).toHaveLength(1);
    const marker = store.get(`${PHOTO}.stk/${BOX.join("-")}`)!.customMetadata!;
    expect(marker.state).toBe("done");
    expect(marker.scanId).toMatch(SCAN_ID_RE);
    expect(timing.finalMs[0]).toBeNull();
  });

  test("a failed whole cutout falls back to the per-box sticker even with refine off", async () => {
    const { run, store } = setup("fail", false);
    const timing = await run();
    const marker = store.get(`${PHOTO}.stk/${BOX.join("-")}`)!.customMetadata!;
    expect(marker.state).toBe("done");
    expect(marker.scanId).toMatch(SCAN_ID_RE);
    expect(timing.quickMs[0]).toBeNull();
    expect(timing.finalMs[0]).not.toBeNull();
  });

  test("every outcome fails: the marker still settles so the box is not retried", async () => {
    const { binding } = recordingImages({ width: 40, height: 40 });
    const { bucket, store } = ledgerBucket();
    await runScanStickers({
      images: binding,
      bucket,
      userId: "u1",
      photoKey: PHOTO,
      bytes: new ArrayBuffer(8),
      boxes: [BOX],
      size: { width: 40, height: 40 },
      whole: Promise.resolve(null),
      refine: true,
      startedAt: Date.now(),
    });
    const marker = store.get(`${PHOTO}.stk/${BOX.join("-")}`)!.customMetadata!;
    expect(marker).toMatchObject({ state: "done", scanId: "" });
  });
});
