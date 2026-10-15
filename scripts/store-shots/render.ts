#!/usr/bin/env bun
/**
 * Store screenshot generator: dark marketing slide (wordmark, 2-line headline with a highlighted
 * word, subhead) above a realistic phone frame that holds a real app capture.
 *
 *   bun scripts/store-shots/render.ts <spec.json> [--only <name>] [--width 1390] [--out-dir <dir>]
 *
 * Spec: `{ "defaults": {...}, "slides": [{...}] }` (or a bare array of slides). Paths in a spec
 * resolve relative to the spec file. See README.md for the fields.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const HERE = import.meta.dir;
const FONT_DIR = resolve(HERE, '../../apps/native/assets/widget/fonts');

type Slide = {
  /** Output file, relative to the spec file; --out-dir keeps only its file name. */
  out: string;
  brand: string;
  /** Colour of the second wordmark part (JoyoRogo: "Rogo"). */
  brandColor: string;
  /** Colour of the highlighted headline word. */
  highlightColor: string;
  /** Headline; use "\n" for an explicit line break, otherwise the text balances itself. */
  headline: string;
  /** Substring of `headline` painted in `highlightColor`. */
  highlight: string;
  subhead: string;
  /** App capture (PNG). */
  screen: string;
  /** Source pixels cut from the capture before it is fitted into the screen (status bar, nav bar, edge artefacts). */
  crop?: { top?: number; bottom?: number; left?: number; right?: number };
  /** Draw the JoyoRogo leaf over the wordmark. */
  leaf?: boolean;
};

type Spec = { defaults?: Partial<Slide>; slides: Slide[] } | Slide[];

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const specPath = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!specPath) {
  console.error('usage: bun scripts/store-shots/render.ts <spec.json> [--only <name>] [--width 1390] [--out-dir <dir>]');
  process.exit(2);
}
const WIDTH = Number(flag('width') ?? 1390);
const HEIGHT = 2778;
const only = flag('only');
const outDirFlag = flag('out-dir');
const specFile = resolve(specPath);
const specDir = dirname(specFile);
const parsed = JSON.parse(readFileSync(specFile, 'utf8')) as Spec;
const defaults = Array.isArray(parsed) ? {} : (parsed.defaults ?? {});
const slides = (Array.isArray(parsed) ? parsed : parsed.slides).map((s) => ({ ...defaults, ...s }) as Slide);

const fromSpec = (p: string) => (isAbsolute(p) ? p : resolve(specDir, p));
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Phone geometry (px at a 2778 tall canvas), measured from the App Store set.
const PHONE_W = 943;
const PHONE_H = 2004;
const PHONE_TOP = 724;
const BEZEL = 16;
const SCREEN_W = PHONE_W - BEZEL * 2;
const CONTENT_TOP = 126; // from the phone top: below the status bar, where the app UI starts
const CONTENT_RADIUS = 56;
const BOTTOM_INSET = 82; // black strip under the app UI, as in the App Store set, keeps a tab bar clear of the screen corners

const FONT_CSS = [
  [500, 'PlusJakartaSans_500Medium.ttf'],
  [700, 'PlusJakartaSans_700Bold.ttf'],
  [800, 'PlusJakartaSans_800ExtraBold.ttf'],
]
  .map(([weight, file]) => {
    const path = resolve(FONT_DIR, file as string);
    if (!existsSync(path)) throw new Error(`missing font ${file} in ${FONT_DIR}`);
    const b64 = readFileSync(path).toString('base64');
    return `@font-face{font-family:'PJS';font-weight:${weight};src:url(data:font/ttf;base64,${b64})}`;
  })
  .join('\n');

function splitBrand(name: string): [string, string] {
  const m = name.match(/^(.+?)([A-Z][a-z0-9]*)$/);
  return m ? [m[1]!, m[2]!] : [name, ''];
}

function headlineHtml(s: Slide) {
  const text = s.headline;
  const i = text.indexOf(s.highlight);
  if (i === -1) throw new Error(`highlight "${s.highlight}" not found in headline "${text}"`);
  const part = (t: string) => esc(t).replace(/\n/g, '<br>');
  return (
    part(text.slice(0, i)) +
    `<span style="color:${s.highlightColor}">${part(s.highlight)}</span>` +
    part(text.slice(i + s.highlight.length))
  );
}

const STATUS_ICONS = `
<svg width="150" height="40" viewBox="0 0 150 40" fill="none">
  <rect x="0" y="24" width="8" height="12" rx="2.5" fill="#fff"/>
  <rect x="13" y="17" width="8" height="19" rx="2.5" fill="#fff"/>
  <rect x="26" y="9" width="8" height="27" rx="2.5" fill="#fff"/>
  <rect x="39" y="1" width="8" height="35" rx="2.5" fill="#fff"/>
  <path d="M57 14.5a24 24 0 0 1 36 0M63 21.5a15 15 0 0 1 24 0" stroke="#fff" stroke-width="4.4" stroke-linecap="round"/>
  <circle cx="75" cy="31" r="3.4" fill="#fff"/>
  <rect x="104.500" y="3.500" width="38" height="29" rx="9" stroke="#fff" stroke-opacity=".45" stroke-width="3"/>
  <rect x="108.500" y="7.500" width="30" height="21" rx="5.500" fill="#fff"/>
  <path d="M146 13v10c2-.8 3.200-2.600 3.200-5s-1.200-4.200-3.200-5z" fill="#fff" fill-opacity=".45"/>
</svg>`;

const leaf = (color: string) =>
  `<svg class="leaf" viewBox="0 0 20 20"><path d="M2 18C2 8 8 2 18 2 18 12 12 18 2 18z" fill="${color}"/></svg>`;

type Shot = { w: number; h: number; dataUrl: string };

function html(s: Slide, shot: Shot) {
  const [a, b] = splitBrand(s.brand);
  const maxH = PHONE_H - BEZEL - CONTENT_TOP - BOTTOM_INSET;
  // Fit to the screen width; a taller capture shrinks to the available height so a bottom tab bar is
  // never cut, and the capture's own edge pixel columns, stretched, fill the leftover side margins.
  const scale = Math.min(SCREEN_W / shot.w, maxH / shot.h);
  const imgW = Math.round(shot.w * scale);
  const imgH = Math.round(shot.h * scale);
  const margin = Math.floor((SCREEN_W - imgW) / 2);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${FONT_CSS}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden}
body{
  font-family:'PJS',sans-serif;position:relative;color:#f0ede6;
  background:
    radial-gradient(ellipse 1150px 470px at 50% 0, rgba(71,128,89,.22), rgba(71,128,89,0) 100%),
    linear-gradient(180deg,#151310 0,#100f0d 100%);
}
.brand{position:absolute;top:108px;left:0;right:0;text-align:center;font-weight:800;font-size:40px;letter-spacing:-.02em;line-height:60px}
.brand .a{color:#e5f1de}
.brand .b{color:${s.brandColor}}
.brand span.in{position:relative;display:inline-block}
.leaf{position:absolute;width:15px;height:15px;left:58px;top:2px;transform:rotate(8deg)}
h1{position:absolute;top:230px;left:0;right:0;text-align:center;font-weight:800;font-size:95px;line-height:99px;letter-spacing:-.025em;padding:0 40px;text-wrap:balance}
.sub{position:absolute;top:464px;left:0;right:0;text-align:center;font-weight:500;font-size:42px;line-height:56px;letter-spacing:-.005em;color:#b0aa9e;padding:0 90px}
.phone{
  position:absolute;left:${(WIDTH - PHONE_W) / 2}px;top:${PHONE_TOP}px;width:${PHONE_W}px;height:${PHONE_H}px;
  border-radius:134px;background:#0a0a09;
  box-shadow:0 0 0 2px rgba(255,255,255,.07) inset,0 0 0 1px rgba(255,255,255,.12),0 40px 120px rgba(0,0,0,.55);
}
.screen{position:absolute;inset:${BEZEL}px;border-radius:118px;background:#050504;overflow:hidden;box-shadow:0 0 0 1.500px rgba(255,255,255,.06)}
.island{position:absolute;left:50%;top:26px;width:190px;height:54px;margin-left:-95px;border-radius:27px;background:#000}
.time{position:absolute;left:83px;top:34px;font-weight:700;font-size:34px;line-height:40px;letter-spacing:.01em;color:#fff}
.icons{position:absolute;right:77px;top:33px}.icons svg{display:block;width:168px;height:45px}
.content{position:absolute;left:0;top:${CONTENT_TOP - BEZEL}px;width:${SCREEN_W}px;height:${imgH}px;overflow:hidden;border-radius:${CONTENT_RADIUS}px ${CONTENT_RADIUS}px 0 0}
.content img{position:absolute;display:block}
.content .edge{top:0;height:${imgH}px;object-fit:fill}
.content .edge.l{left:0;width:${margin + 2}px;object-view-box:inset(0 calc(100% - 1px) 0 0)}
.content .edge.r{right:0;width:${margin + 2}px;object-view-box:inset(0 0 0 calc(100% - 1px))}
.content .shot{left:${margin}px;top:0;width:${imgW}px;height:${imgH}px}
</style></head><body>
<div class="brand"><span class="in"><span class="a">${esc(a)}</span><span class="b">${esc(b)}</span>${
    s.leaf ? leaf(s.brandColor) : ''
  }</span></div>
<h1>${headlineHtml(s)}</h1>
<div class="sub">${esc(s.subhead)}</div>
<div class="phone"><div class="screen">
  <div class="time">9.41</div><div class="island"></div><div class="icons">${STATUS_ICONS}</div>
  <div class="content">${
    margin > 0
      ? `<img class="edge l" src="${shot.dataUrl}"><img class="edge r" src="${shot.dataUrl}">`
      : ''
  }<img class="shot" src="${shot.dataUrl}"></div>
</div></div>
</body></html>`;
}

async function loadShot(path: string, crop: Slide['crop']): Promise<Shot> {
  const { width, height } = await sharp(path).metadata();
  const c = { top: crop?.top ?? 0, bottom: crop?.bottom ?? 0, left: crop?.left ?? 0, right: crop?.right ?? 0 };
  const w = width! - c.left - c.right;
  const h = height! - c.top - c.bottom;
  if (w <= 0 || h <= 0) throw new Error(`${path}: crop leaves nothing of ${width}x${height}`);
  const buf = await sharp(path).extract({ left: c.left, top: c.top, width: w, height: h }).png().toBuffer();
  return { w, h, dataUrl: `data:image/png;base64,${buf.toString('base64')}` };
}

async function main() {
  const todo = slides.filter((s) => !only || basename(s.out, '.png') === only || s.out === only);
  if (!todo.length) throw new Error(`no slide matches --only ${only}`);

  const exe = process.env.CHROMIUM ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({ executablePath: exe });
  try {
    for (const s of todo) {
      for (const k of ['out', 'brand', 'brandColor', 'highlightColor', 'headline', 'highlight', 'subhead', 'screen'] as const) {
        if (!s[k]) throw new Error(`slide ${s.out ?? '?'}: missing "${k}"`);
      }
      const screenPath = fromSpec(s.screen);
      const shot = await loadShot(screenPath, s.crop);
      const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
      await page.setContent(html(s, shot), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
      await page.close();

      const outPath = outDirFlag ? resolve(outDirFlag, basename(s.out)) : fromSpec(s.out);
      mkdirSync(dirname(outPath), { recursive: true });
      // Play wants 24-bit RGB without alpha.
      await sharp(png).flatten({ background: '#100f0d' }).removeAlpha().toColourspace('srgb').png().toFile(outPath);
      console.log(outPath);
    }
  } finally {
    await browser.close();
  }
}

await main();
