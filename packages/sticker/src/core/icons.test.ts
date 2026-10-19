import { describe, expect, it } from "bun:test";
import { ICONS, ICON_VIEWBOX, isIconName } from "./icons";

/** Every coordinate of a path outside arc flags and rotations is a point or a length in the icon grid. */
function coordinates(d: string): number[] {
  return [...d.matchAll(/-?\d*\.?\d+/g)].map((m) => Number(m[0]));
}

describe("sport glyphs", () => {
  it("has one for every sport kind a sticker draws, plus strength and the fallback", () => {
    for (const name of ["run", "walk", "bike", "swim", "strength", "fitness"]) expect(isIconName(name)).toBe(true);
  });

  it("keeps the Material Design Icons paths inside the shared 512 grid", () => {
    for (const name of ["run", "walk", "bike", "swim", "strength", "fitness"] as const) {
      expect(ICONS[name]).toHaveLength(1);
      const values = coordinates(ICONS[name][0]);
      expect(Math.max(...values)).toBeLessThanOrEqual(ICON_VIEWBOX);
      expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    }
  });

  it("does not draw a run as a standing figure or a swim as a drop", () => {
    expect(ICONS.run).not.toEqual(ICONS.walk);
    expect(ICONS.swim).not.toEqual(ICONS.water);
  });
});
