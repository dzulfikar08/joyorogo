import { describe, expect, test } from "bun:test";

import { FEED_TIP_EVERY, TIPS, dailyTip, feedTipIndex, tipRotationOffset } from "./tips";

describe("tips", () => {
  test("slug unik dan field inti terisi", () => {
    const seenSlugs: Record<string, string> = {};
    for (const tip of TIPS) {
      expect(seenSlugs[tip.slug]).toBeUndefined();
      seenSlugs[tip.slug] = tip.slug;
      expect(tip.title.length).toBeGreaterThan(0);
      expect(tip.summary.length).toBeGreaterThan(0);
      expect(tip.sections.length).toBeGreaterThan(0);
      expect(tip.cobaIni.length).toBeGreaterThan(0);
      expect(tip.sources.length).toBeGreaterThan(0);
      expect(tip.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const source of tip.sources) {
        expect(source.url).toMatch(/^https:\/\//);
      }
    }
  });

  test("tip harian deterministik per hari dan berputar", () => {
    const morning = new Date("2026-10-13T02:00:00Z"); // 09:00 WIB
    const night = new Date("2026-10-13T16:00:00Z"); // 23:00 WIB, masih hari yang sama
    expect(dailyTip(morning).slug).toBe(dailyTip(night).slug);
    const nextDay = new Date("2026-10-14T02:00:00Z");
    expect(dailyTip(nextDay).slug).not.toBe(dailyTip(morning).slug);
    expect(tipRotationOffset(morning)).toBeLessThan(TIPS.length);
  });

  test("feedTipIndex selalu mengembalikan indeks valid", () => {
    for (let n = 0; n < TIPS.length * 3; n++) {
      const index = feedTipIndex(n);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(TIPS.length);
    }
    expect(FEED_TIP_EVERY).toBeGreaterThan(1);
  });
});
