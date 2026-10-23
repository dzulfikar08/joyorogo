import { describe, expect, test } from "bun:test";

import { type FixedBox, type KmCandidate, KM_STEPS, MAX_KM_PILLS, pickKmPills } from "./km-pills";

const pill = (km: number, x: number, y: number): KmCandidate => ({ km, x, y, w: 20, h: 18 });

/** 157 km ride drawn left to right across `width` px, gently wavy. */
function ride(width: number): KmCandidate[] {
  return Array.from({ length: 157 }, (_, i) =>
    pill(i + 1, 20 + ((i + 1) / 157) * width, 100 + Math.sin(i / 9) * 30),
  );
}

describe("pickKmPills", () => {
  test("157 km fitted: at most 12, no overlaps, 20 km multiples", () => {
    const all = ride(800);
    const kept = pickKmPills(all);
    expect(kept.length).toBeGreaterThanOrEqual(3);
    expect(kept.length).toBeLessThanOrEqual(MAX_KM_PILLS);
    expect(kept.every((km) => km % 10 === 0)).toBe(true);
    const boxes = all.filter((c) => kept.includes(c.km));
    for (const a of boxes)
      for (const b of boxes)
        if (a !== b) expect(Math.abs(a.x - b.x) >= 20 || Math.abs(a.y - b.y) >= 18).toBe(true);
  });

  test("157 evenly spaced pills step to every 20 km", () => {
    const at = Array.from({ length: 157 }, (_, i) => pill(i + 1, 10 + i * 40, 100));
    expect(pickKmPills(at)).toEqual([20, 40, 60, 80, 100, 120, 140]);
  });

  test("zoomed into a stretch shows every km again", () => {
    const run = Array.from({ length: 8 }, (_, i) => pill(41 + i, 20 + i * 38, 100));
    expect(pickKmPills(run)).toEqual([41, 42, 43, 44, 45, 46, 47, 48]);
  });

  test("steps 1/2/5/10 as count grows", () => {
    const at = (n: number) => Array.from({ length: n }, (_, i) => pill(i + 1, 10 + i * 40, 100));
    expect(pickKmPills(at(12))).toHaveLength(12);
    expect(pickKmPills(at(13))).toEqual([2, 4, 6, 8, 10, 12]);
    expect(pickKmPills(at(30))).toEqual([5, 10, 15, 20, 25, 30]);
    expect(KM_STEPS.slice(0, 6)).toEqual([1, 2, 5, 10, 20, 50]);
  });

  test("a pill under start or finish is dropped", () => {
    const fixed: FixedBox[] = [{ x: 52, y: 50, w: 20, h: 20 }];
    expect(pickKmPills([pill(1, 50, 50)], fixed)).toEqual([]);
  });

  test("out-and-back drops the return pill that lands on the outbound one", () => {
    expect(pickKmPills([pill(20, 100, 100), pill(60, 250, 100), pill(80, 102, 100)])).toEqual([20, 60]);
  });

  test("nothing on screen, nothing drawn", () => {
    expect(pickKmPills([])).toEqual([]);
  });
});
