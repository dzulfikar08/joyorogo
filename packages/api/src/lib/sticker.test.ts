import { describe, expect, test } from "bun:test";

import { SCAN_ID_RE, makeSticker, newScanId, stickerKey } from "./sticker";

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
