import { describe, expect, test } from "bun:test";

import { opaqueBounds } from "./png-bounds";
import { makePng } from "./png-fixture";

const blob = (x: number, y: number) => (x >= 40 && x < 140 && y >= 25 && y < 95 ? 255 : 0);

describe("opaqueBounds", () => {
  test("finds the box of the opaque pixels", async () => {
    expect(await opaqueBounds(makePng(200, 120, blob))).toEqual({
      left: 40,
      top: 25,
      right: 140,
      bottom: 95,
      width: 200,
      height: 120,
    });
  });

  test("reads every scanline filter the encoder may pick", async () => {
    for (const filter of [0, 1, 2, 3, 4] as const) {
      const bounds = await opaqueBounds(makePng(200, 120, blob, { filter }));
      expect(bounds).toMatchObject({ left: 40, top: 25, right: 140, bottom: 95 });
    }
  });

  test("reads grey+alpha PNGs", async () => {
    expect(await opaqueBounds(makePng(200, 120, blob, { channels: 2, filter: 4 }))).toMatchObject({
      left: 40,
      right: 140,
    });
  });

  test("soft edge noise and a lone speck do not stretch the box", async () => {
    const noisy = (x: number, y: number) => {
      if (x === 3 && y === 3) return 255;
      if (x === 150 && y === 90) return 20;
      return blob(x, y);
    };
    expect(await opaqueBounds(makePng(200, 120, noisy))).toMatchObject({ left: 40, top: 25, right: 140, bottom: 95 });
  });

  test("a fully transparent image has no bounds", async () => {
    expect(await opaqueBounds(makePng(64, 64, () => 0))).toBeNull();
  });

  test("anything it cannot read is null, never a throw", async () => {
    expect(await opaqueBounds(new ArrayBuffer(0))).toBeNull();
    expect(await opaqueBounds(new Uint8Array([1, 2, 3, 4]).buffer)).toBeNull();
    expect(await opaqueBounds(makePng(64, 64, blob, { interlace: 1 }))).toBeNull();
    const truncated = makePng(64, 64, blob);
    expect(await opaqueBounds(truncated.slice(0, 60))).toBeNull();
  });
});
