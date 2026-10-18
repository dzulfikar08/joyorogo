// Golden snapshots: every built-in template rendered with its fixture through real Chromium
// (headless, repo font files) and compared with __goldens__/ (1/3 size). Also checks that the
// SVG painter and the Canvas painter agree. Not part of `bun test src`; run `bun run test:golden`.
//   Refresh after an intentional visual change: bun run stickers:goldens
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

import { chromiumAvailable, createHarness, pngDiff, sceneFor, toGolden, type Harness } from "../scripts/harness";
import { rogoTemplates } from "../src/rogo";
import { fixtureFor } from "../src/rogo/fixtures";

const GOLDENS = join(import.meta.dir, "../__goldens__");
const { templates } = rogoTemplates();
const run = chromiumAvailable() ? describe : describe.skip;

run("goldens", () => {
  let harness: Harness;
  beforeAll(async () => {
    harness = await createHarness();
  });
  afterAll(async () => {
    await harness?.close();
  });

  for (const template of templates) {
    for (const mode of ["dark", "light"] as const) {
      test(`${template.id} ${mode}`, async () => {
        const scene = sceneFor({ template, fixture: fixtureFor(template), mode });
        const png = await harness.svgPng(scene);
        const meta = await sharp(png).metadata();
        expect([meta.width, meta.height]).toEqual([1080, template.canvas.height]);
        // Transparent stickers keep real transparency (alpha 0 in the corners).
        if (scene.transparent) {
          const corner = await sharp(png).extract({ left: 0, top: 0, width: 4, height: 4 }).ensureAlpha().raw().toBuffer();
          expect(corner[3]).toBe(0);
        }
        const file = join(GOLDENS, `${template.id}.${mode}.png`);
        expect(existsSync(file)).toBe(true);
        const golden = readFileSync(file);
        const mine = await toGolden(png);
        const diff = await pngDiff(mine, golden);
        expect({ id: template.id, mode, mean: diff.mean < 1.2, bad: diff.bad < 0.004 }).toEqual({ id: template.id, mode, mean: true, bad: true });
      }, 30_000);
    }
  }

  test("the Canvas painter agrees with the SVG painter", async () => {
    // One per style family is enough to catch painter drift without rendering everything twice.
    const seen = new Set<string>();
    for (const template of templates) {
      if (seen.has(template.style)) continue;
      seen.add(template.style);
      const scene = sceneFor({ template, fixture: fixtureFor(template), mode: "dark" });
      const diff = await pngDiff(await harness.svgPng(scene), await harness.canvasPng(scene));
      expect({ id: template.id, mean: diff.mean < 2.5, bad: diff.bad < 0.01 }).toEqual({ id: template.id, mean: true, bad: true });
    }
  }, 120_000);
});
