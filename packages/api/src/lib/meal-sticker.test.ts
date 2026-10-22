import { describe, expect, test } from "bun:test";

import { mealStickerTarget, type StickerRowLike } from "./meal-sticker";

const PLATE = "p".repeat(32);
const row = (over: Partial<StickerRowLike> = {}): StickerRowLike => ({
  name: "Nasi",
  kcal: 200,
  protein: 4,
  carbs: 44,
  fat: 0.5,
  scanId: "a".repeat(32),
  plateScanId: PLATE,
  photoId: null,
  ...over,
});
const more = (first: string, others: number) => `${first} +${others}`;

describe("mealStickerTarget", () => {
  const nasi = row();
  const ayam = row({ name: "Ayam", kcal: 250, protein: 20, carbs: null, fat: 14, scanId: "b".repeat(32), photoId: "photo1" });
  const other = row({ name: "Kopi", kcal: 30, plateScanId: "q".repeat(32), scanId: "c".repeat(32) });

  test("a scan with a plate sticker is shown and shared as the plate, once", () => {
    const target = mealStickerTarget(ayam, [nasi, ayam, other], more);
    expect(target).toEqual({
      scanId: PLATE,
      fallbackScanId: "a".repeat(32),
      plate: true,
      name: "Nasi +1",
      kcal: 450,
      protein: 24,
      carbs: 44,
      fat: 14.5,
      photoId: "photo1",
    });
  });

  test("whichever component is tapped, the plate comes up", () => {
    expect(mealStickerTarget(nasi, [nasi, ayam], more)?.scanId).toBe(PLATE);
    expect(mealStickerTarget(ayam, [nasi, ayam], more)?.scanId).toBe(PLATE);
  });

  test("the name the user gave the plate wins over the joined names", () => {
    expect(mealStickerTarget(nasi, [nasi, ayam], more, "  Nasi padang ")?.name).toBe("Nasi padang");
  });

  test("a one-food scan keeps its own name", () => {
    expect(mealStickerTarget(other, [nasi, other], more)).toMatchObject({ name: "Kopi", kcal: 30, plate: true });
  });

  test("a meal scanned before plate stickers falls back to the component, as before", () => {
    const old = row({ plateScanId: null });
    expect(mealStickerTarget(old, [old], more)).toEqual({
      scanId: "a".repeat(32),
      fallbackScanId: null,
      plate: false,
      name: "Nasi",
      kcal: 200,
      protein: 4,
      carbs: 44,
      fat: 0.5,
      photoId: null,
    });
  });

  test("nothing to show without any cutout", () => {
    expect(mealStickerTarget(row({ scanId: null, plateScanId: null }), [], more)).toBeNull();
  });

  test("a plate sticker still opens when the component cutouts are missing", () => {
    const bare = row({ scanId: null });
    expect(mealStickerTarget(bare, [bare], more)).toMatchObject({ scanId: PLATE, fallbackScanId: null, plate: true });
  });

  test("macros nobody logged stay unknown instead of becoming 0", () => {
    const a = row({ protein: null, carbs: null, fat: null });
    expect(mealStickerTarget(a, [a], more)).toMatchObject({ protein: null, carbs: null, fat: null });
  });
});
