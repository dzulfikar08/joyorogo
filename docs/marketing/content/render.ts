// Render one piece: bun docs/marketing/content/render.ts <slug>
// Reads docs/marketing/content/<slug>/slides.html, screenshots every <section class="slide"> to dist/marketing/<slug>/NN.png.
// Path tokens in slides.html: @joyorogo/ = this repo, @watch-fit/ = ../watch-fit (override WATCH_FIT_DIR), @content/ = this folder.
import { Glob } from "bun";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const slug = process.argv[2];
if (!slug) throw new Error("usage: bun docs/marketing/content/render.ts <slug>");

const contentDir = import.meta.dir;
const root = resolve(contentDir, "../../..");
const watchFit = resolve(process.env.WATCH_FIT_DIR ?? join(root, "../watch-fit"));
const src = join(contentDir, slug, "slides.html");
if (!existsSync(src)) throw new Error(`missing ${src}`);

function firstMatch(pattern: string, cwd: string): string | undefined {
  return [...new Glob(pattern).scanSync({ cwd, absolute: true })].sort().at(-1);
}

const pwPath = firstMatch(".bun/playwright-core@*/node_modules/playwright-core/index.mjs", join(root, "node_modules"));
if (!pwPath) throw new Error("playwright-core not found under node_modules/.bun (run bun install)");
// Dynamic import: playwright-core lives under a version-pinned bun store path, resolved at runtime.
const { chromium } = await import(pathToFileURL(pwPath).href);

function findBrowser(): string {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const bases = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), ".cache/ms-playwright")].filter(Boolean) as string[];
  for (const base of bases) {
    if (!existsSync(base)) continue;
    const hit = firstMatch("chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell", base);
    if (hit) return hit;
  }
  for (const p of ["/usr/bin/chromium", "/usr/bin/google-chrome", "/usr/bin/chromium-browser"]) if (existsSync(p)) return p;
  throw new Error("no Chromium found; set CHROMIUM_PATH");
}

const fontDir = firstMatch(".bun/@fontsource-variable+plus-jakarta-sans@*/node_modules/@fontsource-variable/plus-jakarta-sans/files", join(root, "node_modules"));
const fontFace = fontDir
  ? ["latin-ext", "latin"]
      .map((s) => `@font-face{font-family:"Plus Jakarta Sans Variable";font-weight:200 800;src:url("${pathToFileURL(join(fontDir, `plus-jakarta-sans-${s}-wght-normal.woff2`)).href}") format("woff2")}`)
      .join("")
  : "";

const url = (p: string) => pathToFileURL(p).href;
const html = readFileSync(src, "utf8")
  .replaceAll("@joyorogo/", url(root) + "/")
  .replaceAll("@watch-fit/", url(watchFit) + "/")
  .replaceAll("@content/", url(contentDir) + "/")
  .replace("</head>", `<style>${fontFace}</style></head>`);

const tmp = join(tmpdir(), `joyo-content-${slug}.html`);
writeFileSync(tmp, html);

const out = join(root, "dist/marketing", slug);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: findBrowser() });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 1500 }, deviceScaleFactor: 1, colorScheme: "light" })).newPage();
await page.goto(url(tmp));
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));

// n/N page counters, and a clipping check: anything outside its slide that is not marked data-bleed is reported.
const problems: string[] = await page.evaluate(() => {
  const slides = [...document.querySelectorAll<HTMLElement>("section.slide")];
  const bad: string[] = [];
  slides.forEach((s, i) => {
    const pg = s.querySelector(".pg");
    if (pg && slides.length > 1) pg.textContent = `${i + 1}/${slides.length}`;
    const r = s.getBoundingClientRect();
    const foot = s.querySelector(".foot")?.getBoundingClientRect();
    for (const el of s.querySelectorAll<HTMLElement>("*")) {
      if (el.closest("[data-bleed]") || el.closest(".foot")) continue;
      // A .snap crops its screenshot on purpose; the .snap box itself is still checked.
      const snap = el.closest(".snap");
      if (snap && snap !== el) continue;
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      const leaf = !el.children.length;
      if (b.left < r.left - 1 || b.right > r.right + 1 || b.top < r.top - 1 || b.bottom > r.bottom + 1) bad.push(`slide ${i + 1}: <${el.tagName.toLowerCase()} class="${el.className}"> outside slide`);
      else if (leaf && foot && b.bottom > foot.top - 8 && el.textContent?.trim()) bad.push(`slide ${i + 1}: "${el.textContent.trim().slice(0, 30)}" runs into footer`);
      else if (el.scrollWidth > el.clientWidth + 1 && !el.classList.contains("snap") && getComputedStyle(el).overflow !== "visible") bad.push(`slide ${i + 1}: <${el.tagName.toLowerCase()} class="${el.className}"> clips content`);
    }
  });
  return bad;
});

const slides = await page.locator("section.slide").all();
for (const [i, s] of slides.entries()) {
  const file = join(out, `${String(i + 1).padStart(2, "0")}.png`);
  await s.screenshot({ path: file });
  const png = readFileSync(file);
  const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  const expect = (await s.evaluate((e) => e.classList.contains("story"))) ? 1920 : 1350;
  if (w !== 1080 || h !== expect) problems.push(`${file}: ${w}x${h}, expected 1080x${expect}`);
}
await browser.close();
rmSync(tmp, { force: true });

console.log(`${slides.length} PNG -> ${out} (${readdirSync(out).join(" ")})`);
for (const p of problems) console.warn("WARN", p);
