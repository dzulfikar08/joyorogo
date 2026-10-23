// Renders one real diary day as the two share formats (story + carousel) to PNG, through the same builder the apps use
// (packages/api lib/day-share) and the same painter as the goldens.
//
//   bun scripts/render-day-share.ts --rows rows.json --plates plates.json --stickers ./cutouts --out ./out --prefix day-share
//        [--date 2026-10-22] [--kcal 1850] [--protein 110] [--locale id|en|ms] [--mode dark|light] [--plate-fixture]
//
// rows.json is `wrangler d1 execute ... --json` over `select ... from food_log` (snake_case columns: meal, name, kcal, protein,
// carbs, fat, fiber, grams, scan_id, plate_scan_id, plate_id); plates.json the same over `select id, name from plate`.
// stickers is a directory of `<scanId>.png`. `--plate-fixture` stands the repo's fixture cutout in for a whole-plate sticker
// on every plate of two foods or more, to show that variant (production has no plate stickers for that day).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { macroTargets, mealLabel, NORMAL_SLOTS } from "../../api/src/lib/engine";
import { buildDayShare, type DayShareRow } from "../../api/src/lib/day-share";
import type { Template } from "../src/core";
import { rogoTemplates, renderSlides, rogoWebFonts, type StorySpec } from "../src/rogo";
import { createHarness } from "./harness";

const args = process.argv.slice(2);
const arg = (name: string, fallback?: string): string => {
  const i = args.indexOf(`--${name}`);
  const value = i >= 0 ? args[i + 1] : fallback;
  if (value === undefined) throw new Error(`missing --${name}`);
  return value;
};
const rowsFile = arg("rows");
const platesFile = arg("plates");
const stickerDir = arg("stickers");
const out = arg("out");
const prefix = arg("prefix", "day-share");
const date = arg("date", "2026-10-22");
const locale = arg("locale", "id") as "id" | "en" | "ms";
const mode = arg("mode", "dark") as "dark" | "light";
const kcalTarget = Number(arg("kcal", "1850"));
const proteinTarget = Number(arg("protein", "110"));
const plateFixture = args.includes("--plate-fixture");

type D1 = Array<{ results: Array<Record<string, unknown>> }>;
const d1 = async (file: string): Promise<Array<Record<string, unknown>>> => ((await Bun.file(file).json()) as D1)[0]!.results;

const str = (v: unknown) => (typeof v === "string" ? v : null);
const numOrNull = (v: unknown) => (typeof v === "number" ? v : null);

const plateIds = new Map<string, number>();
const rowsRaw = await d1(rowsFile);
for (const r of rowsRaw) if (r.plate_id) plateIds.set(String(r.plate_id), (plateIds.get(String(r.plate_id)) ?? 0) + 1);

const rows: DayShareRow[] = rowsRaw.map((r) => {
  const plateId = str(r.plate_id);
  const fixturePlate = plateFixture && plateId !== null && (plateIds.get(plateId) ?? 0) >= 2;
  return {
    name: String(r.name),
    meal: String(r.meal),
    kcal: Number(r.kcal),
    protein: numOrNull(r.protein),
    carbs: numOrNull(r.carbs),
    fat: numOrNull(r.fat),
    fiber: numOrNull(r.fiber),
    grams: numOrNull(r.grams),
    scanId: str(r.scan_id),
    plateScanId: fixturePlate ? `plate-${plateId}` : str(r.plate_scan_id),
    plateId,
  };
});
const plateNames: Record<string, string> = {};
for (const p of await d1(platesFile)) plateNames[String(p.id)] = String(p.name);

const budgets = macroTargets(kcalTarget, 70);
const eaten = rows.reduce((total, row) => total + row.kcal, 0);
const spec = buildDayShare({
  date,
  rows,
  plateNames,
  slots: NORMAL_SLOTS,
  mealLabel: (meal) => mealLabel(meal as never, locale),
  stickerUrl: (id) => (id.startsWith("plate-") ? "fixture:cutout.png" : `fixture:${join(stickerDir, `${id}.png`)}`),
  eatenKcal: eaten,
  targets: { kcal: kcalTarget, proteinG: proteinTarget, carbsG: budgets.carbsG, fatG: budgets.fatG, fiberG: budgets.fiberG },
});

mkdirSync(out, { recursive: true });
const { templates } = rogoTemplates();
const find = (id: string) => {
  const template = templates.find((t) => t.id === id);
  if (!template) throw new Error(`template ${id} missing`);
  return template;
};
const harness = await createHarness();
const written: string[] = [];
try {
  const draw = async (file: string, template: Template) => {
    for (const [index, scene] of renderSlides({ template, spec: spec as StorySpec, locale, mode, fonts: rogoWebFonts }).entries()) {
      if (scene.issues.length) console.warn(file, index, scene.issues);
      const name = template.id === "dayfood.full.story" ? `${file}-story.png` : `${file}-carousel-${index + 1}.png`;
      writeFileSync(join(out, name), await harness.svgPng(scene));
      written.push(name);
    }
  };
  await draw(prefix, find("dayfood.full.story"));
  await draw(prefix, find("dayfood.cover.carousel"));
} finally {
  await harness.close();
}
console.log(JSON.stringify({ kcal: spec.kcal, meals: spec.meals.map((m) => [m.label, m.kcal, m.stickers.length]), written }, null, 1));
