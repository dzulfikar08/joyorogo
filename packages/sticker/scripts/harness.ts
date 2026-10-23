// Headless render harness: Scene -> PNG through real Chromium (SVG painter and Canvas painter),
// with the repo's own font files, so goldens do not depend on system fonts.
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import sharp from "sharp";
import { chromium, type Browser, type Page } from "playwright";

import { toSvg } from "../src/core/emit-svg";
import type { Mode } from "../src/core/color";
import type { Scene } from "../src/core/scene";
import type { Locale } from "../src/core/format";
import { renderSticker, rogoWebFonts, type StickerPrefs } from "../src/rogo";
import { FIXTURES, type FixtureId } from "../src/rogo/fixtures";
import type { Template } from "../src/core/schema";

const ROOT = join(import.meta.dir, "..");
const FONT_DIR = join(ROOT, "fixtures/fonts");
const CHROMIUM = process.env.CHROMIUM_PATH ?? "/usr/bin/chromium";

export const chromiumAvailable = () => existsSync(CHROMIUM);

const FONT_FACES: Array<{ family: string; weight: number; file: string }> = [
  ...[500, 600, 700, 800].map((weight, i) => ({
    family: "Plus Jakarta Sans Variable",
    weight,
    file: ["PlusJakartaSans_500Medium", "PlusJakartaSans_600SemiBold", "PlusJakartaSans_700Bold", "PlusJakartaSans_800ExtraBold"][i]!,
  })),
  ...[400, 500, 700].map((weight, i) => ({
    family: "IBM Plex Mono",
    weight,
    file: ["IBMPlexMono_400Regular", "IBMPlexMono_500Medium", "IBMPlexMono_700Bold"][i]!,
  })),
];

const fontCss = FONT_FACES.map(
  (f) =>
    `@font-face{font-family:"${f.family}";font-weight:${f.weight};src:url(data:font/ttf;base64,${readFileSync(join(FONT_DIR, `${f.file}.ttf`)).toString("base64")})}`,
).join("");

const imageCache = new Map<string, string>();

/** `fixture:meal.jpg` -> data URI; anything else passes through. */
export function fixtureHref(uri: string): string {
  if (!uri.startsWith("fixture:")) return uri;
  let hit = imageCache.get(uri);
  if (!hit) {
    const file = uri.slice(8);
    const mime = file.endsWith(".png") ? "image/png" : "image/jpeg";
    // `fixture:/abs/path.png` reads any file (the day-share render uses real cutouts saved outside the repo).
    hit = `data:${mime};base64,${readFileSync(isAbsolute(file) ? file : join(ROOT, "fixtures", file)).toString("base64")}`;
    imageCache.set(uri, hit);
  }
  return hit;
}

export type Harness = {
  svgPng(scene: Scene): Promise<Buffer>;
  canvasPng(scene: Scene): Promise<Buffer>;
  close(): Promise<void>;
};

export async function createHarness(): Promise<Harness> {
  const browser: Browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
  const page: Page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.setContent(
    `<html><head><style>${fontCss} html,body{margin:0;background:transparent}</style></head><body></body></html>`,
  );
  await page.evaluate(async () => {
    await Promise.all(["500", "600", "700", "800"].map((w) => document.fonts.load(`${w} 40px "Plus Jakarta Sans Variable"`)));
    await Promise.all(["400", "500", "700"].map((w) => document.fonts.load(`${w} 40px "IBM Plex Mono"`)));
  });
  const painter = await Bun.build({
    entrypoints: [join(import.meta.dir, "canvas-entry.ts")],
    target: "browser",
  });
  const script = await painter.outputs[0]!.text();
  await page.addScriptTag({ content: script });

  const shot = async (scene: Scene): Promise<Buffer> => {
    await page.setViewportSize({ width: scene.width, height: scene.height });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    return Buffer.from(await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: scene.width, height: scene.height } }));
  };

  return {
    async svgPng(scene) {
      const svg = toSvg(scene, { fonts: rogoWebFonts, imageHref: fixtureHref });
      await page.evaluate(async (markup) => {
        document.body.innerHTML = markup;
        const images = [...document.querySelectorAll("image")];
        await Promise.all(
          images.map(
            (el) =>
              new Promise<void>((resolve) => {
                const probe = new Image();
                probe.onload = () => resolve();
                probe.onerror = () => resolve();
                probe.src = el.getAttribute("href") ?? "";
              }),
          ),
        );
      }, svg);
      return shot(scene);
    },
    async canvasPng(scene) {
      const fonts: Record<string, { family: string; weight?: number }> = {};
      const images: Record<string, string> = {};
      const walk = (nodes: Scene["nodes"]) => {
        for (const n of nodes) {
          if (n.k === "text") fonts[`${n.font}|${n.weight}`] = rogoWebFonts.paint(n.font, n.weight);
          if (n.k === "image") images[n.uri] = fixtureHref(n.uri);
          if (n.k === "group") walk(n.children);
        }
      };
      walk(scene.nodes);
      await page.evaluate(
        async ({ sceneJson, fonts: f, images: i }) => {
          const w = window as unknown as { __paintScene(s: unknown, f: unknown, i: unknown): Promise<void> };
          await w.__paintScene(sceneJson, f, i);
        },
        { sceneJson: scene, fonts, images },
      );
      return shot(scene);
    },
    async close() {
      await browser.close();
    },
  };
}

export type RenderCase = {
  template: Template;
  fixture: FixtureId;
  mode: Mode;
  locale?: Locale;
  options?: StickerPrefs["options"];
};

/** Template + fixture -> Scene with the fixture photo wired as `fixture:<file>`. */
export function sceneFor(c: RenderCase): Scene {
  const fixture = FIXTURES[c.fixture] as { spec: Parameters<typeof renderSticker>[0]["spec"]; photo?: string };
  return renderSticker({
    template: c.template,
    spec: fixture.spec,
    prefs: {
      photo: fixture.photo ? { uri: `fixture:${fixture.photo}` } : null,
      options: c.options,
    },
    locale: c.locale ?? "id",
    mode: c.mode,
    fonts: rogoWebFonts,
  });
}

/** Pixel difference between two PNGs of the same size: mean per-channel delta and share of pixels off by > 40. */
export async function pngDiff(a: Buffer, b: Buffer): Promise<{ mean: number; bad: number }> {
  const [ra, rb] = await Promise.all([
    sharp(a).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (ra.info.width !== rb.info.width || ra.info.height !== rb.info.height) return { mean: 255, bad: 1 };
  let sum = 0;
  let bad = 0;
  const px = ra.info.width * ra.info.height;
  for (let i = 0; i < px; i++) {
    let worst = 0;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(ra.data[i * 4 + c]! - rb.data[i * 4 + c]!);
      sum += d;
      if (d > worst) worst = d;
    }
    if (worst > 40) bad++;
  }
  return { mean: sum / (px * 4), bad: bad / px };
}

/** Golden size: 1/3 of the export, enough to catch layout regressions and keep the repo small. */
export async function toGolden(png: Buffer): Promise<Buffer> {
  const meta = await sharp(png).metadata();
  return sharp(png).resize({ width: Math.round((meta.width ?? 1080) / 3), kernel: "lanczos3" }).png({ compressionLevel: 9 }).toBuffer();
}
