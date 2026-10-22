import { describe, expect, test } from "bun:test";

import { HEADER_ART_HEIGHT, HEADER_ART_WIDTH, headerArtPaths } from "./header-art";

describe("headerArtPaths", () => {
  const paths = headerArtPaths(HEADER_ART_WIDTH, HEADER_ART_HEIGHT);

  test("draws both the dot grid and the paw prints, quietly", () => {
    expect(new Set(paths.map((p) => p.tone))).toEqual(new Set(["grid", "paw"]));
    for (const p of paths) {
      expect(p.opacity).toBeGreaterThan(0);
      expect(p.opacity).toBeLessThanOrEqual(0.6);
      expect(p.d).not.toContain("NaN");
    }
  });

  test("merges into a few dozen paths, not one per dot", () => {
    expect(paths.length).toBeLessThan(60);
  });

  test("the grid is strongest in the corner and faint toward the edges", () => {
    const grid = paths.filter((p) => p.tone === "grid");
    expect(Math.max(...grid.map((p) => p.opacity))).toBeGreaterThan(0.5);
    expect(Math.min(...grid.map((p) => p.opacity))).toBeLessThan(0.1);
  });

  test("scales into a smaller box", () => {
    expect(headerArtPaths(116, 84).length).toBeGreaterThan(0);
  });
});
