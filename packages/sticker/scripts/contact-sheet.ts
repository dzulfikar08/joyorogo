// Contact sheet of every template with fixture data, plus a light/dark pair sheet and the goldens.
//   bun scripts/contact-sheet.ts            render sheets into OUT (default /run/media/dzul/ioswork/stickers/joyorogo)
//   bun scripts/contact-sheet.ts --update   also rewrite __goldens__/
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

import { rogoTemplates } from "../src/rogo";
import { fixtureFor } from "../src/rogo/fixtures";
import { createHarness, sceneFor, toGolden } from "./harness";
import type { Template } from "../src/core";

const OUT = process.env.STICKER_OUT ?? "/run/media/dzul/ioswork/stickers/joyorogo";
const GOLDENS = join(import.meta.dir, "../__goldens__");
const update = process.argv.includes("--update");
mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, "png"), { recursive: true });
if (update) mkdirSync(GOLDENS, { recursive: true });

const TILE_H = 560;
const GAP = 28;
const LABEL_H = 44;
const PAD = 40;
const BG = "#101311";

const label = (text: string, w: number) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${LABEL_H}"><text x="0" y="30" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="600" fill="#c9d1cc">${text.replace(/&/g, "&amp;")}</text></svg>`,
  );

const checker = (w: number, h: number, light: boolean) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><pattern id="c" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="${light ? "#d9d6cf" : "#1a1d1b"}"/><rect width="12" height="12" fill="${light ? "#eceae4" : "#262a28"}"/><rect x="12" y="12" width="12" height="12" fill="${light ? "#eceae4" : "#262a28"}"/></pattern></defs><rect width="${w}" height="${h}" fill="url(#c)"/></svg>`,
  );

type Tile = { id: string; png: Buffer; w: number; h: number; transparent: boolean; light: boolean };

async function tileOf(id: string, png: Buffer, transparent: boolean, light: boolean): Promise<Tile> {
  const scaled = await sharp(png).resize({ height: TILE_H }).png().toBuffer();
  const meta = await sharp(scaled).metadata();
  return { id, png: scaled, w: meta.width ?? 0, h: meta.height ?? 0, transparent, light };
}

async function compose(rows: Array<{ title: string; tiles: Tile[] }>, file: string, maxWidth: number) {
  // Wrap each kind's tiles into lines no wider than maxWidth.
  type Line = { title: string; tiles: Tile[] };
  const lines: Line[] = [];
  for (const row of rows) {
    let cur: Tile[] = [];
    let width = 0;
    let first = true;
    for (const tile of row.tiles) {
      if (cur.length && width + GAP + tile.w > maxWidth - PAD * 2) {
        lines.push({ title: first ? row.title : "", tiles: cur });
        first = false;
        cur = [];
        width = 0;
      }
      cur.push(tile);
      width += (cur.length > 1 ? GAP : 0) + tile.w;
    }
    if (cur.length) lines.push({ title: first ? row.title : "", tiles: cur });
  }
  const lineH = TILE_H + LABEL_H + GAP + 36;
  const height = PAD + lines.length * lineH + PAD;
  const layers: sharp.OverlayOptions[] = [];
  lines.forEach((line, li) => {
    const top = PAD + li * lineH;
    if (line.title) layers.push({ input: label(line.title.toUpperCase(), 800), left: PAD, top });
    let x = PAD;
    for (const tile of line.tiles) {
      const y = top + 36;
      if (tile.transparent) layers.push({ input: checker(tile.w, tile.h, tile.light), left: x, top: y });
      layers.push({ input: tile.png, left: x, top: y });
      layers.push({ input: label(tile.id, tile.w), left: x, top: y + tile.h + 4 });
      x += tile.w + GAP;
    }
  });
  await sharp({ create: { width: maxWidth, height, channels: 4, background: BG } })
    .composite(layers)
    .png({ compressionLevel: 9 })
    .toFile(file);
  console.log(file, `${maxWidth}x${height}`);
}

const { templates, issues } = rogoTemplates();
if (issues.length) throw new Error(`template issues: ${JSON.stringify(issues)}`);

const harness = await createHarness();
try {
  const byKind = new Map<string, Template[]>();
  for (const t of templates) byKind.set(t.kind, [...(byKind.get(t.kind) ?? []), t]);

  const darkRows: Array<{ title: string; tiles: Tile[] }> = [];
  const lightRows: Array<{ title: string; tiles: Tile[] }> = [];
  for (const [kind, list] of byKind) {
    const dark: Tile[] = [];
    const light: Tile[] = [];
    for (const template of list) {
      const fixture = fixtureFor(template);
      for (const mode of ["dark", "light"] as const) {
        const scene = sceneFor({ template, fixture, mode });
        const png = await harness.svgPng(scene);
        if (mode === "dark") writeFileSync(join(OUT, "png", `${template.id}.png`), png);
        if (update) writeFileSync(join(GOLDENS, `${template.id}.${mode}.png`), await toGolden(png));
        (mode === "dark" ? dark : light).push(await tileOf(template.id, png, scene.transparent, mode === "light"));
      }
    }
    darkRows.push({ title: kind, tiles: dark });
    lightRows.push({ title: kind, tiles: light });
  }
  await compose(darkRows, join(OUT, "contact-sheet.png"), 4200);
  await compose(lightRows, join(OUT, "contact-sheet-light.png"), 4200);

  // Light and dark of the same templates, side by side.
  const pairIds = ["day.bold.story", "day.minimal.sticker", "meal.receipt.story", "streak.badge.sticker", "week.poster.story", "weight.trend.story"];
  const pairs: Tile[] = [];
  for (const id of pairIds) {
    const template = templates.find((t) => t.id === id);
    if (!template) continue;
    for (const mode of ["dark", "light"] as const) {
      const scene = sceneFor({ template, fixture: fixtureFor(template), mode });
      pairs.push(await tileOf(`${id} (${mode})`, await harness.svgPng(scene), scene.transparent, mode === "light"));
    }
  }
  await compose([{ title: "light and dark", tiles: pairs }], join(OUT, "light-dark.png"), 4200);
} finally {
  await harness.close();
}
