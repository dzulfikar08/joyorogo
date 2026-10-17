// Scan-accuracy harness. Runs the CURRENT production vision pipeline
// (analyzeFoodPhoto: same prompt, same default model, same TKPI calibration) on
// every labelled photo and scores it against what the user saved.
//
// Cases
//   owner      .tmp/dataset/owner/<caseId>/     truth = the diary save (final.items)
//   feedback   .tmp/dataset/feedback/<caseId>/  truth = savedItems of a consented photo
//   wikimedia  (--wikimedia) the bench-accuracy set; truth = a kcal band + the dish name
//   Export the first two with scripts/dataset-export.ts. Cases with no saved label are
//   skipped and listed in the report.
//
// Usage: bun run scripts/eval-scans.ts [options]
//   --variant <name>   run a named variant (repeatable; default baseline). With 2+, the
//                      report compares every later variant against the first.
//   --wikimedia        add the Wikimedia bench set (structure check; band truth)
//   --dir <path>       exported dataset dir (default .tmp/dataset)
//   --limit <N>        at most N cases in total (owner, feedback, then wikimedia)
//   --reps <N>         repeat every (case, variant) N times (run-to-run noise; default 1)
//   --concurrency <N>  parallel model calls (default 3)
//   --no-cache         ignore .tmp/eval/cache
//   --list-variants    print the registered variants and exit
// Auth: CLOUDFLARE_API_TOKEN, else the wrangler OAuth login; CLOUDFLARE_ACCOUNT_ID
// (default: the Workers AI account of the prod worker). Workers AI calls cost money.
//
// Output: .tmp/eval/report-<YYYY-MM-DD>.md and .json. Model outputs are cached in
// .tmp/eval/cache by (photo hash, variant, prompt+model fingerprint, rep), so re-runs
// only pay for what changed. Reports carry anonymized case ids (a hash) and item
// names / grams / kcal only: no photos, no user identifiers.
//
// Honest limits (also in the report): an owner scan the user saved unedited has
// the model's own answer as its "truth", so a re-run of the same model scores well
// on it by construction; the signal is in the corrected, retried and feedback cases.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { analyzeFoodPhoto, DEFAULT_VISION_MODEL, visionPrompt, VisionError } from "../packages/api/src/lib/vision";
import type { AiRunner } from "../packages/api/src/lib/vision";
import { TKPI_DISHES } from "../packages/api/src/lib/tkpi";
import type { EvalItem, SummaryRow } from "./dataset-export";

// ---------------------------------------------------------------------------
// VARIANTS: the one place to register a variant. `baseline` is production
// exactly (no model override, no prompt change) and must stay that way.
// promptTransform receives the production prompt and returns the one to send,
// so a variant is a diff on the prompt, never a copy of it.
// ---------------------------------------------------------------------------
type Variant = {
  model?: string;
  promptTransform?: (base: string) => string;
  notes: string;
};

const VARIANTS: Record<string, Variant> = {
  baseline: { notes: "Production exactly: default model, shipped prompt, TKPI calibration." },
  "prompt-b": {
    // PLACEHOLDER: shows the mechanism. The wording is illustrative, not a recommendation.
    promptTransform: (base) =>
      `${base}\nCatatan porsi: perkirakan berat sebagai satu porsi rumahan untuk satu orang, bukan porsi restoran besar; jangan melebih-lebihkan.`,
    notes: "Placeholder: production prompt plus one portion-size line. Mechanism demo only.",
  },
};
// ---------------------------------------------------------------------------

const ROOT = join(import.meta.dir, "..");
const EVAL_DIR = join(ROOT, ".tmp", "eval");
const CACHE_DIR = join(EVAL_DIR, "cache");
const WIKI_DIR = join(EVAL_DIR, "wikimedia");
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? "b7e6f8457bd39fa37a7eea5249799754";
/** |signed error| under this share of the true value is "close", not over/under. */
const CLOSE_PCT = 5;

type Group = "owner" | "feedback" | "wikimedia";
type Case = {
  id: string;
  group: Group;
  photo: string;
  label: string;
  /** What production answered when the photo was scanned (owner/feedback). */
  recorded: EvalItem[] | null;
  /** The user's saved items; null = unlabelled. */
  truth: EvalItem[] | null;
  /** Wikimedia only: dish name and the kcal band one serving is expected in. */
  wiki?: { dish: string; min: number; max: number };
};

// Same set as scripts/bench-accuracy.ts (that script runs on import, so it cannot be imported).
const WIKI_CASES: Array<{ dish: string; url: string; min: number; max: number }> = [
  ["nasi goreng", "3/3e/Nasi_goreng_indonesia.jpg", 350, 700],
  ["sate ayam", "2/25/Sate_Ayam_Al-Huda_Jember.jpg", 250, 600],
  ["bakso", "6/6e/Bakso_Indonesian_Meatball_Soup_from_Solo.jpg", 250, 600],
  ["gado-gado", "3/30/Gado-gado_in_Jakarta.JPG", 250, 600],
  ["rendang", "5/50/Beef_Rendang..JPG", 300, 700],
  ["mie ayam", "8/82/Mi_ayam_jamur.JPG", 350, 700],
  ["es teh", "f/f3/Glass_of_iced_tea_-_Evan_Swigart.jpg", 10, 120],
  ["pisang goreng", "0/0f/Pisang_Goreng.jpg", 200, 500],
].map(([dish, path, min, max]) => ({
  dish: dish as string,
  url: `https://thumb.wikimedia.org/wikipedia/commons/thumb/${(path as string).replace(/\/([^/]+)$/, "/$1/960px-$1")}`,
  min: min as number,
  max: max as number,
}));

// ------------------------------------------------------------------ args
type Args = {
  variants: string[];
  wikimedia: boolean;
  dir: string;
  limit: number;
  reps: number;
  concurrency: number;
  cache: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    variants: [],
    wikimedia: false,
    dir: join(ROOT, ".tmp", "dataset"),
    limit: Infinity,
    reps: 1,
    concurrency: 3,
    cache: true,
  };
  const value = (i: number) => {
    const v = argv[i + 1];
    if (v === undefined) throw new Error(`${argv[i]} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--variant":
        args.variants.push(value(i++));
        break;
      case "--wikimedia":
        args.wikimedia = true;
        break;
      case "--dir":
        args.dir = join(process.cwd(), value(i++));
        break;
      case "--limit":
        args.limit = Number(value(i++));
        break;
      case "--reps":
        args.reps = Math.max(1, Number(value(i++)));
        break;
      case "--concurrency":
        args.concurrency = Math.max(1, Number(value(i++)));
        break;
      case "--no-cache":
        args.cache = false;
        break;
      case "--list-variants":
        for (const [name, v] of Object.entries(VARIANTS)) console.log(`${name.padEnd(12)} ${v.notes}`);
        process.exit(0);
        break;
      default:
        throw new Error(`unknown option ${argv[i]}`);
    }
  }
  if (args.variants.length === 0) args.variants.push("baseline");
  for (const name of args.variants) {
    if (!VARIANTS[name]) throw new Error(`unknown variant "${name}" (have: ${Object.keys(VARIANTS).join(", ")})`);
  }
  if (!Number.isFinite(args.limit) && args.limit !== Infinity) throw new Error("--limit must be a number");
  return args;
}

// ----------------------------------------------------------- name matching
const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// TKPI dish library: name + aliases -> canonical dish, longest key wins (as tkpi.ts matches).
const TKPI_KEYS = TKPI_DISHES.flatMap((dish) =>
  [dish.name, ...dish.aliases].map((key) => ({ key: normalize(key), canon: dish.name })),
)
  .filter((entry) => entry.key.length >= 4)
  .sort((a, b) => b.key.length - a.key.length);

/** The library dish a name stands for, or null. */
function canonOf(name: string): string | null {
  const q = ` ${normalize(name)} `;
  return TKPI_KEYS.find((entry) => q.includes(` ${entry.key} `))?.canon ?? null;
}

function editSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[b.length]! / Math.max(a.length, b.length);
}

/**
 * 0..1 name agreement. Two different library dishes never match; the same
 * library dish (alias included) always does; otherwise token overlap or
 * spelling distance decides.
 */
export function nameScore(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ca = canonOf(a);
  const cb = canonOf(b);
  if (ca && cb) return ca === cb ? 1 : 0;
  const ta = new Set(na.split(" "));
  const tb = new Set(nb.split(" "));
  const shared = [...ta].filter((t) => tb.has(t)).length;
  const jaccard = shared / (ta.size + tb.size - shared);
  return Math.max(jaccard, editSimilarity(na, nb));
}

const NAME_MATCH_MIN = 0.5;

/** One-to-one greedy pairing of answer items with truth items by name score. */
export function pairItems(ai: EvalItem[], truth: EvalItem[]): Array<{ ai: EvalItem; truth: EvalItem }> {
  const scored = ai.flatMap((a, i) =>
    truth.map((t, j) => ({ i, j, score: nameScore(a.name, t.name) })),
  );
  scored.sort((x, y) => y.score - x.score);
  const usedAi = new Set<number>();
  const usedTruth = new Set<number>();
  const pairs: Array<{ ai: EvalItem; truth: EvalItem }> = [];
  for (const { i, j, score } of scored) {
    if (score < NAME_MATCH_MIN) break;
    if (usedAi.has(i) || usedTruth.has(j)) continue;
    usedAi.add(i);
    usedTruth.add(j);
    pairs.push({ ai: ai[i]!, truth: truth[j]! });
  }
  return pairs;
}

// ---------------------------------------------------------------- scoring
type ErrPoint = { err: number; pct: number };
type Scored = {
  /** Item names: matches, answer items, truth items (owner/feedback). */
  names: { tp: number; ai: number; truth: number } | null;
  /** Wikimedia: the dish name appears among the answer items. */
  nameHit: boolean | null;
  itemKcal: ErrPoint[];
  grams: ErrPoint[];
  plate: ErrPoint & { aiKcal: number; truthKcal: number };
  /** Wikimedia: the answer's total is inside the band. */
  inBand: boolean | null;
};

const total = (items: EvalItem[]) => items.reduce((sum, item) => sum + item.kcal, 0);
const point = (ai: number, truth: number): ErrPoint => ({
  err: ai - truth,
  pct: truth > 0 ? ((ai - truth) / truth) * 100 : 0,
});

function scoreCase(c: Case, items: EvalItem[]): Scored {
  const aiKcal = total(items);
  if (c.wiki) {
    const { dish, min, max } = c.wiki;
    // Outside the band the error is the distance to the nearest edge; inside it there is none.
    const target = Math.min(max, Math.max(min, aiKcal));
    return {
      names: null,
      nameHit: items.some((item) => nameScore(item.name, dish) >= NAME_MATCH_MIN),
      itemKcal: [],
      grams: [],
      plate: { ...point(aiKcal, target), aiKcal, truthKcal: target },
      inBand: aiKcal >= min && aiKcal <= max,
    };
  }
  const truth = c.truth ?? [];
  const pairs = pairItems(items, truth);
  const truthKcal = total(truth);
  return {
    names: { tp: pairs.length, ai: items.length, truth: truth.length },
    nameHit: null,
    itemKcal: pairs.map((p) => point(p.ai.kcal, p.truth.kcal)),
    grams: pairs.flatMap((p) =>
      p.ai.grams !== undefined && p.truth.grams !== undefined ? [point(p.ai.grams, p.truth.grams)] : [],
    ),
    plate: { ...point(aiKcal, truthKcal), aiKcal, truthKcal },
    inBand: null,
  };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : NaN);
function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;
}

type Side = { n: number; meanPct: number; medianPct: number; meanAbs: number; medianAbs: number };
type ErrStats = { n: number; over: Side; under: Side; close: number; signedMeanPct: number; mae: number };

function side(points: ErrPoint[]): Side {
  const abs = points.map((p) => Math.abs(p.err));
  const pct = points.map((p) => Math.abs(p.pct));
  return {
    n: points.length,
    meanPct: mean(pct),
    medianPct: quantile(pct, 0.5),
    meanAbs: mean(abs),
    medianAbs: quantile(abs, 0.5),
  };
}

/** Over / under are reported apart: an under-estimate is the worse error here. */
function errStats(points: ErrPoint[]): ErrStats {
  return {
    n: points.length,
    over: side(points.filter((p) => p.pct > CLOSE_PCT)),
    under: side(points.filter((p) => p.pct < -CLOSE_PCT)),
    close: points.filter((p) => Math.abs(p.pct) <= CLOSE_PCT).length,
    signedMeanPct: mean(points.map((p) => p.pct)),
    mae: mean(points.map((p) => Math.abs(p.err))),
  };
}

// ----------------------------------------------------------- model runner
function apiToken(): string {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const toml = readFileSync(join(homedir(), ".config/.wrangler/config/default.toml"), "utf8");
  const found = /oauth_token = "([^"]+)"/.exec(toml);
  if (!found) throw new Error("no CLOUDFLARE_API_TOKEN and no wrangler login");
  return found[1]!;
}

function restRunner(token: string): AiRunner {
  return {
    async run(model, input) {
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${model}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      // Boundary: the REST envelope; only `result` is read.
      const json = (await res.json()) as { result?: unknown };
      if (!res.ok || !json.result) throw new Error(`ai ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
      return json.result;
    },
  };
}

type RunResult =
  | { ok: true; items: EvalItem[]; ms: number; modelMs: number; tooMany: boolean; cached: boolean }
  | { ok: false; reason: string; ms: number; cached: false };

const fingerprint = (variant: Variant) =>
  createHash("sha256")
    .update(`${variant.model ?? DEFAULT_VISION_MODEL}\n${(variant.promptTransform ?? ((p) => p))(visionPrompt())}`)
    .digest("hex")
    .slice(0, 8);

async function runOne(
  ai: AiRunner,
  c: Case,
  hash: string,
  name: string,
  rep: number,
  useCache: boolean,
): Promise<RunResult> {
  const variant = VARIANTS[name]!;
  const cacheFile = join(CACHE_DIR, `${hash}.${name}.${fingerprint(variant)}.${rep}.json`);
  if (useCache && existsSync(cacheFile)) {
    const hit: RunResult = await Bun.file(cacheFile).json();
    if (hit.ok) return { ...hit, cached: true };
  }
  const bytes = await Bun.file(c.photo).arrayBuffer();
  const started = Date.now();
  try {
    const analysis = await analyzeFoodPhoto(ai, {
      imageBase64: Buffer.from(bytes).toString("base64"),
      mimeType: "image/jpeg",
      model: variant.model,
      promptTransform: variant.promptTransform,
    });
    const result: RunResult = {
      ok: true,
      items: analysis.items.map((item) => ({ name: item.name, grams: item.grams, kcal: item.kcal })),
      ms: Date.now() - started,
      modelMs: analysis.timing.modelMs,
      tooMany: analysis.tooMany,
      cached: false,
    };
    await Bun.write(cacheFile, JSON.stringify(result));
    return result;
  } catch (error) {
    const reason = error instanceof VisionError ? error.reason : "error";
    return { ok: false, reason, ms: Date.now() - started, cached: false };
  }
}

// ----------------------------------------------------------------- cases
async function loadCases(args: Args): Promise<{ cases: Case[]; skipped: Case[] }> {
  const cases: Case[] = [];
  const skipped: Case[] = [];
  const summary = join(args.dir, "summary.jsonl");
  if (existsSync(summary)) {
    const rows: SummaryRow[] = (await Bun.file(summary).text())
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    rows.sort((a, b) => a.case_id.localeCompare(b.case_id));
    for (const row of rows) {
      const photo = join(args.dir, row.set, row.case_id, "photo.jpg");
      if (!existsSync(photo)) continue;
      const c: Case = {
        id: row.case_id,
        group: row.set,
        photo,
        label: row.label,
        recorded: row.ai_items,
        truth: row.truth_items && row.truth_items.length ? row.truth_items : null,
      };
      (c.truth ? cases : skipped).push(c);
    }
  } else {
    console.log(`no ${join(".tmp", "dataset", "summary.jsonl")}: run scripts/dataset-export.ts first (0 owner/feedback cases)`);
  }
  if (args.wikimedia) {
    mkdirSync(WIKI_DIR, { recursive: true });
    for (const w of WIKI_CASES) {
      const photo = join(WIKI_DIR, `${w.dish.replace(/\W+/g, "-")}.jpg`);
      if (!existsSync(photo)) await downloadWiki(w.url, photo);
      cases.push({
        id: `wiki-${w.dish.replace(/\W+/g, "-")}`,
        group: "wikimedia",
        photo,
        label: "band",
        recorded: null,
        truth: null,
        wiki: { dish: w.dish, min: w.min, max: w.max },
      });
    }
  }
  return { cases: cases.slice(0, args.limit), skipped };
}

async function downloadWiki(url: string, to: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JoyorogoBench/1.0; +https://joyorogo.com)" },
    });
    if (res.ok) {
      await Bun.write(to, await res.arrayBuffer());
      return;
    }
    await Bun.sleep(2000 * (attempt + 1));
  }
  throw new Error(`download failed: ${url}`);
}

// ------------------------------------------------------------- aggregation
type Run = { c: Case; rep: number; result: RunResult; scored: Scored | null };

type Agg = {
  group: Group;
  variant: string;
  cases: number;
  runs: number;
  failures: Record<string, number>;
  name: { precision: number; recall: number; f1: number; macroF1: number } | null;
  nameHit: { hit: number; of: number } | null;
  inBand: { hit: number; of: number } | null;
  itemKcal: ErrStats;
  plate: ErrStats;
  grams: ErrStats;
  latency: { p50: number; p95: number };
  tooMany: number;
};

const ratio = (a: number, b: number) => (b > 0 ? a / b : NaN);
const f1 = (p: number, r: number) => (p + r > 0 ? (2 * p * r) / (p + r) : 0);

function aggregate(group: Group, variant: string, runs: Run[]): Agg {
  const ok = runs.filter((r) => r.scored);
  const scored = ok.map((r) => r.scored!);
  const failures: Record<string, number> = {};
  for (const r of runs) {
    if (!r.result.ok) failures[r.result.reason] = (failures[r.result.reason] ?? 0) + 1;
  }
  const withNames = scored.filter((s) => s.names);
  const tp = sum(withNames.map((s) => s.names!.tp));
  const aiN = sum(withNames.map((s) => s.names!.ai));
  const truthN = sum(withNames.map((s) => s.names!.truth));
  const precision = ratio(tp, aiN);
  const recall = ratio(tp, truthN);
  const wiki = scored.filter((s) => s.nameHit !== null);
  const band = scored.filter((s) => s.inBand !== null);
  const ms = ok.flatMap((r) => (r.result.ok ? [r.result.ms] : []));
  return {
    group,
    variant,
    cases: new Set(runs.map((r) => r.c.id)).size,
    runs: runs.length,
    failures,
    name: withNames.length
      ? {
          precision,
          recall,
          f1: f1(precision, recall),
          macroF1: mean(withNames.map((s) => f1(ratio(s.names!.tp, s.names!.ai) || 0, ratio(s.names!.tp, s.names!.truth) || 0))),
        }
      : null,
    nameHit: wiki.length ? { hit: wiki.filter((s) => s.nameHit).length, of: wiki.length } : null,
    inBand: band.length ? { hit: band.filter((s) => s.inBand).length, of: band.length } : null,
    itemKcal: errStats(scored.flatMap((s) => s.itemKcal)),
    plate: errStats(scored.map((s) => s.plate)),
    grams: errStats(scored.flatMap((s) => s.grams)),
    latency: { p50: quantile(ms, 0.5), p95: quantile(ms, 0.95) },
    tooMany: ok.filter((r) => r.result.ok && r.result.tooMany).length,
  };
}

// --------------------------------------------------------------- reporting
const f = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : "-");
const sec = (ms: number) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : "-");
const sideText = (s: Side, unit: "kcal" | "g") =>
  s.n ? `${s.n}: ${f(s.meanPct, 0)}% mean, ${f(s.medianPct, 0)}% med, ${f(s.meanAbs, 0)}${unit} mean, ${f(s.medianAbs, 0)}${unit} med` : "0";

function statsRows(label: string, st: ErrStats, unit: "kcal" | "g"): string[] {
  if (!st.n) return [];
  return [
    `| ${label} over (> +${CLOSE_PCT}%) | ${sideText(st.over, unit)} |`,
    `| ${label} under (< -${CLOSE_PCT}%) | ${sideText(st.under, unit)} |`,
    `| ${label} close (within ±${CLOSE_PCT}%) | ${st.close} of ${st.n} |`,
    `| ${label} signed mean / MAE | ${f(st.signedMeanPct)}% / ${f(st.mae, 0)} ${unit} |`,
  ];
}

function aggTable(a: Agg): string[] {
  const rows = [`| Metric | ${a.variant} |`, "|---|---|"];
  rows.push(`| cases / runs / failures | ${a.cases} / ${a.runs} / ${sum(Object.values(a.failures))}${Object.keys(a.failures).length ? ` (${Object.entries(a.failures).map(([k, v]) => `${k} ${v}`).join(", ")})` : ""} |`);
  if (a.name) {
    rows.push(`| item names P / R / F1 (micro) | ${f(a.name.precision * 100, 0)}% / ${f(a.name.recall * 100, 0)}% / ${f(a.name.f1 * 100, 0)}% |`);
    rows.push(`| item names macro F1 | ${f(a.name.macroF1 * 100, 0)}% |`);
  }
  if (a.nameHit) rows.push(`| dish named | ${a.nameHit.hit} of ${a.nameHit.of} |`);
  if (a.inBand) rows.push(`| plate kcal in expected band | ${a.inBand.hit} of ${a.inBand.of} |`);
  const plateLabel = a.group === "wikimedia" ? "plate (outside band)" : "plate kcal";
  rows.push(...statsRows(plateLabel, a.plate, "kcal"));
  rows.push(...statsRows("item kcal (matched)", a.itemKcal, "kcal"));
  rows.push(...statsRows("grams (matched)", a.grams, "g"));
  rows.push(`| latency p50 / p95 (REST, incl. round trip) | ${sec(a.latency.p50)} / ${sec(a.latency.p95)} |`);
  if (a.tooMany) rows.push(`| answers flagged too many | ${a.tooMany} |`);
  return rows;
}

type Metric = { label: string; get: (a: Agg) => number; digits?: number; lowerBetter?: boolean };
const METRICS: Metric[] = [
  { label: "name F1 %", get: (a) => (a.name ? a.name.f1 * 100 : NaN), digits: 0 },
  { label: "plate under count", get: (a) => a.plate.under.n, digits: 0, lowerBetter: true },
  { label: "plate under mean %", get: (a) => a.plate.under.meanPct, lowerBetter: true },
  { label: "plate over count", get: (a) => a.plate.over.n, digits: 0, lowerBetter: true },
  { label: "plate over mean %", get: (a) => a.plate.over.meanPct, lowerBetter: true },
  { label: "plate signed mean %", get: (a) => a.plate.signedMeanPct },
  { label: "plate MAE kcal", get: (a) => a.plate.mae, digits: 0, lowerBetter: true },
  { label: "item kcal MAE", get: (a) => a.itemKcal.mae, digits: 0, lowerBetter: true },
  { label: "grams signed mean %", get: (a) => a.grams.signedMeanPct },
  { label: "grams MAE g", get: (a) => a.grams.mae, digits: 0, lowerBetter: true },
  { label: "latency p50 s", get: (a) => a.latency.p50 / 1000 },
  { label: "latency p95 s", get: (a) => a.latency.p95 / 1000 },
  { label: "failures", get: (a) => sum(Object.values(a.failures)), digits: 0, lowerBetter: true },
];

/** Plate |error| per case, averaged over reps; unmatched cases (a failed run) are left out. */
function perCasePlateAbs(runs: Run[]): Map<string, number> {
  const by = new Map<string, number[]>();
  for (const r of runs) {
    if (r.scored) by.set(r.c.id, [...(by.get(r.c.id) ?? []), Math.abs(r.scored.plate.err)]);
  }
  return new Map([...by].map(([id, xs]) => [id, mean(xs)]));
}

function deltaSection(group: Group, aggs: Agg[], runsOf: (variant: string) => Run[]): string[] {
  const [a, ...rest] = aggs;
  if (!a || rest.length === 0) return [];
  const lines = [`### ${group}: ${rest.map((b) => b.variant).join(", ")} vs ${a.variant}`, ""];
  lines.push(`| Metric | ${a.variant} | ${rest.map((b) => `${b.variant} | Δ`).join(" | ")} |`);
  lines.push(`|---|---|${rest.map(() => "---|---|").join("")}`);
  for (const m of METRICS) {
    const base = m.get(a);
    if (!Number.isFinite(base) && rest.every((b) => !Number.isFinite(m.get(b)))) continue;
    const cells = rest.map((b) => {
      const v = m.get(b);
      const d = v - base;
      return `${f(v, m.digits ?? 1)} | ${Number.isFinite(d) ? `${d > 0 ? "+" : ""}${f(d, m.digits ?? 1)}` : "-"}`;
    });
    lines.push(`| ${m.label} | ${f(base, m.digits ?? 1)} | ${cells.join(" | ")} |`);
  }
  lines.push("");
  const baseAbs = perCasePlateAbs(runsOf(a.variant));
  for (const b of rest) {
    const other = perCasePlateAbs(runsOf(b.variant));
    const ids = [...baseAbs.keys()].filter((id) => other.has(id));
    const better = ids.filter((id) => other.get(id)! < baseAbs.get(id)! - 1).length;
    const worse = ids.filter((id) => other.get(id)! > baseAbs.get(id)! + 1).length;
    lines.push(`Paired plate |error|, ${b.variant} vs ${a.variant}: closer on ${better}, further on ${worse}, equal (±1 kcal) on ${ids.length - better - worse} of ${ids.length} cases.`);
  }
  lines.push("");
  return lines;
}

const showItems = (items: EvalItem[]) =>
  items.length ? items.map((i) => `${i.name}${i.grams !== undefined ? ` ${Math.round(i.grams)}g` : ""} ${Math.round(i.kcal)}kcal`).join("; ") : "(none)";

function worstSection(variant: string, group: Group, runs: Run[], n = 5): string[] {
  const scored = runs.filter((r) => r.scored && r.result.ok);
  const worst = (sign: 1 | -1) =>
    scored
      .filter((r) => r.scored!.plate.pct * sign > CLOSE_PCT)
      .sort((x, y) => y.scored!.plate.pct * sign - x.scored!.plate.pct * sign)
      .slice(0, n);
  const lines: string[] = [];
  for (const [title, sign] of [["Worst over-estimates", 1], ["Worst under-estimates", -1]] as const) {
    const picks = worst(sign);
    if (!picks.length) continue;
    lines.push(`**${title}** (${variant}, ${group})`, "");
    lines.push("| Case | Plate AI / truth | Error | AI answer | Truth |", "|---|---|---|---|---|");
    for (const r of picks) {
      const s = r.scored!;
      const truth = r.c.wiki ? `band ${r.c.wiki.min}-${r.c.wiki.max} kcal (${r.c.wiki.dish})` : showItems(r.c.truth ?? []);
      const answer = r.result.ok ? showItems(r.result.items) : "";
      lines.push(`| ${r.c.id}${r.rep ? `#${r.rep}` : ""} | ${Math.round(s.plate.aiKcal)} / ${Math.round(s.plate.truthKcal)} | ${s.plate.err > 0 ? "+" : ""}${Math.round(s.plate.err)} kcal (${s.plate.pct > 0 ? "+" : ""}${f(s.plate.pct, 0)}%) | ${answer} | ${truth} |`);
    }
    lines.push("");
  }
  return lines;
}

// ------------------------------------------------------------------- main
async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(CACHE_DIR, { recursive: true });
  const { cases, skipped } = await loadCases(args);
  if (cases.length === 0) {
    console.log("no labelled cases to run (export the dataset, or pass --wikimedia)");
  }

  const hashes = new Map<string, string>();
  for (const c of cases) {
    hashes.set(c.id, createHash("sha256").update(new Uint8Array(await Bun.file(c.photo).arrayBuffer())).digest("hex").slice(0, 12));
  }

  const jobs = cases.flatMap((c) =>
    args.variants.flatMap((variant) => Array.from({ length: args.reps }, (_, rep) => ({ c, variant, rep }))),
  );
  const cachedAlready = args.cache
    ? jobs.filter((j) => existsSync(join(CACHE_DIR, `${hashes.get(j.c.id)}.${j.variant}.${fingerprint(VARIANTS[j.variant]!)}.${j.rep}.json`))).length
    : 0;
  console.log(`${cases.length} cases x ${args.variants.length} variant(s) x ${args.reps} rep(s) = ${jobs.length} runs, ${jobs.length - cachedAlready} model calls (${cachedAlready} cached), ${skipped.length} unlabelled skipped`);

  const ai = jobs.length > cachedAlready || !args.cache ? restRunner(apiToken()) : { run: () => Promise.reject(new Error("unreachable: all cached")) };
  const results = new Array<Run>(jobs.length);
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(args.concurrency, jobs.length) }, async () => {
      while (next < jobs.length) {
        const index = next++;
        const { c, variant, rep } = jobs[index]!;
        const result = await runOne(ai, c, hashes.get(c.id)!, variant, rep, args.cache);
        results[index] = { c, rep, result, scored: result.ok ? scoreCase(c, result.items) : null };
        process.stdout.write(`\r${++done}/${jobs.length}`);
      }
    }),
  );
  if (jobs.length) process.stdout.write("\n");

  const runsBy = (variant: string, group: Group) =>
    results.flatMap((r, i) => (jobs[i]!.variant === variant && r.c.group === group ? [r] : []));
  const groups = (["owner", "feedback", "wikimedia"] as const).filter((g) => cases.some((c) => c.group === g));

  const date = new Date().toISOString().slice(0, 10);
  const md: string[] = [`# Scan accuracy eval ${date}`, ""];
  md.push(
    `Cases: ${groups.map((g) => `${g} ${cases.filter((c) => c.group === g).length}`).join(", ") || "none"}; unlabelled skipped ${skipped.length}. Reps ${args.reps}. Model ${DEFAULT_VISION_MODEL} unless a variant overrides it.`,
    "",
    "Variants:",
    ...args.variants.map((v) => `- \`${v}\`: ${VARIANTS[v]!.notes} (fingerprint ${fingerprint(VARIANTS[v]!)})`),
    "",
    `Over / under: signed error beyond ±${CLOSE_PCT}% of the true value; an under-estimate is the worse error for the owner, so both are always shown. Latency is wall time of the Workers AI REST call (the production binding is a little faster).`,
    "",
  );
  if (groups.includes("owner") || groups.includes("feedback")) {
    md.push(
      "Bias note: an owner scan saved unedited has the model's own answer as truth, so a re-run of the same model matches it by construction; the signal is in the corrected, retried and feedback cases. Feedback photos were all rated negative (selection bias).",
      "",
    );
  }

  const allAggs: Agg[] = [];
  for (const group of groups) {
    const aggs = args.variants.map((v) => aggregate(group, v, runsBy(v, group)));
    allAggs.push(...aggs);
    md.push(`## ${group}${group === "wikimedia" ? " (structure check; band truth, not user labels)" : ""}`, "");
    for (const a of aggs) md.push(...aggTable(a), "");
    md.push(...deltaSection(group, aggs, (v) => runsBy(v, group)));
    for (const v of args.variants) md.push(...worstSection(v, group, runsBy(v, group)));
  }

  // The answer production gave at scan time vs the saved items (no model calls).
  const recorded = cases.filter((c) => c.recorded && c.truth);
  if (recorded.length) {
    const rec = recorded.map((c) => ({ c, s: scoreCase(c, c.recorded!) }));
    const st = errStats(rec.map((r) => r.s.plate));
    md.push(
      "## As recorded at scan time",
      "",
      `Production's answer when the photo was scanned vs the saved items, ${rec.length} cases (no model calls; scans saved unedited score perfectly by construction): plate over ${st.over.n}, under ${st.under.n}, close ${st.close}; signed mean ${f(st.signedMeanPct)}%.`,
      "",
    );
  }

  if (skipped.length) {
    md.push(
      "## Unlabelled (skipped)",
      "",
      `${skipped.length} cases have no saved items: ${skipped.map((c) => `${c.id} (${c.label})`).join(", ")}`,
      "",
    );
  }

  mkdirSync(EVAL_DIR, { recursive: true });
  const base = join(EVAL_DIR, `report-${date}`);
  await Bun.write(`${base}.md`, `${md.join("\n")}\n`);
  await Bun.write(
    `${base}.json`,
    JSON.stringify(
      {
        date,
        args: { variants: args.variants, wikimedia: args.wikimedia, limit: Number.isFinite(args.limit) ? args.limit : null, reps: args.reps },
        variants: Object.fromEntries(args.variants.map((v) => [v, { notes: VARIANTS[v]!.notes, fingerprint: fingerprint(VARIANTS[v]!) }])),
        aggregates: allAggs,
        skipped: skipped.map((c) => ({ id: c.id, label: c.label })),
        cases: results.map((r, i) => ({
          id: r.c.id,
          group: r.c.group,
          variant: jobs[i]!.variant,
          rep: r.rep,
          ok: r.result.ok,
          ...(r.result.ok ? { items: r.result.items, ms: r.result.ms, cached: r.result.cached } : { reason: r.result.reason }),
          truth: r.c.wiki ?? r.c.truth,
          plate: r.scored?.plate ?? null,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`wrote ${join(".tmp", "eval", `report-${date}.md`)} and .json`);
  for (const a of allAggs) {
    console.log(
      `${a.group}/${a.variant}: ${a.runs} runs, ${sum(Object.values(a.failures))} failed; plate over ${a.plate.over.n} (${f(a.plate.over.meanPct, 0)}%) under ${a.plate.under.n} (${f(a.plate.under.meanPct, 0)}%) close ${a.plate.close}; p50 ${sec(a.latency.p50)} p95 ${sec(a.latency.p95)}`,
    );
  }
}

if (import.meta.main) await main();
