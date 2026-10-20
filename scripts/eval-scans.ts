// Scan-accuracy harness. Runs the CURRENT production vision pipeline
// (analyzeFoodPhoto: same prompt, same default model, same TKPI calibration) on
// every labelled photo and scores it against what the user saved.
//
// Cases
//   owner      .tmp/dataset/owner/<caseId>/     truth = the diary save (final.items)
//   feedback   .tmp/dataset/feedback/<caseId>/  truth = savedItems of a consented photo
//   external   .tmp/dataset/external/<source>/<caseId>/  truth = a contributor's own weighed
//              grams (packages/api/src/lib/external-case.ts); kcal = TKPI 2019 / library
//              reference for those grams, never his or the model's number
//   wikimedia  (--wikimedia) the bench-accuracy set; truth = a kcal band + the dish name
//   Export owner/feedback/external with scripts/dataset-export.ts, or write external cases
//   straight from a labels file with scripts/external-import.ts --out .tmp/dataset/external.
//   Cases with no saved label are skipped and listed in the report.
//
// Usage: bun run scripts/eval-scans.ts [options]
//   --variant <name>   run a named variant (repeatable; default baseline). With 2+, the
//                      report compares every later variant against the first.
//   --wikimedia        add the Wikimedia bench set (structure check; band truth)
//   --only <group>     run only this group (repeatable): owner, feedback, external, wikimedia
//   --external-trust <high|medium|low>
//                      lowest trust of an external case to run (default medium; see the
//                      labels: low = the photo may not be his plate)
//   --external-uncertain  also score the items marked "uncertain" in the photo
//   --dry-run          list the cases, their truth and the model calls, then exit (no calls)
//   --dir <path>       exported dataset dir (default .tmp/dataset)
//   --limit <N>        at most N cases in total (owner, feedback, external, then wikimedia)
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
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EXTERNAL_META_VERSION, truthOf } from "../packages/api/src/lib/external-case";
import type { ExternalMeta } from "../packages/api/src/lib/external-case";

import { analyzeFoodPhoto, DEFAULT_VISION_MODEL, visionPrompt, VisionError } from "../packages/api/src/lib/vision";
import type { AiRunner } from "../packages/api/src/lib/vision";
import type { CalibrateOptions } from "../packages/api/src/lib/tkpi";
import { NAME_MATCH_MIN, nameScore, pairItems } from "../packages/api/src/lib/scan-match";
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
  /** A calibration variant (tkpi.ts CalibrateOptions): same model call as baseline, other post-processing. */
  calibration?: CalibrateOptions;
  /** One extra prompt line for this case (e.g. from the contributor's own history); undefined = none. */
  caseLine?: (c: Case) => string | undefined;
  /** Only these groups run the variant (default: all). */
  groups?: Group[];
  notes: string;
};

const SCALE_CUES_RULE =
  "Cara memperkirakan grams: gunakan petunjuk skala yang terlihat di foto (diameter piring atau mangkuk, sendok, garpu, tangan, kemasan) dan bandingkan dengan isi piring; jangan otomatis memakai porsi umum atau standar, tiap foto bisa lebih kecil atau lebih besar dari itu.";

const VARIANTS: Record<string, Variant> = {
  baseline: { notes: "Production exactly: default model, shipped prompt, TKPI calibration." },
  "prompt-b": {
    // PLACEHOLDER: shows the mechanism. The wording is illustrative, not a recommendation.
    promptTransform: (base) =>
      `${base}\nCatatan porsi: perkirakan berat sebagai satu porsi rumahan untuk satu orang, bukan porsi restoran besar; jangan melebih-lebihkan.`,
    notes: "Placeholder: production prompt plus one portion-size line. Mechanism demo only.",
  },
  "band-wide": {
    calibration: { bandSlack: 0.5 },
    notes: "Calibration only: the library kcal band for a matched dish (already scaled with grams) is widened by 50% each side. Same model answers as baseline.",
  },
  "band-off": {
    calibration: { bandSlack: Infinity },
    notes: "Calibration only: no library kcal band for matched dishes (the 9 kcal/g cap, the Atwater guard and the TKPI 2019 recompute stay). Same model answers as baseline.",
  },
  "scale-cues": {
    promptTransform: (base) => {
      const swapped = base.replace("estimasi realistis porsi umum", "estimasi realistis untuk porsi yang TERLIHAT di foto, bukan porsi umum");
      if (swapped === base) throw new Error("scale-cues: the production prompt no longer has the 'porsi umum' phrase");
      return `${swapped}\n${SCALE_CUES_RULE}`;
    },
    notes: "Prompt: 'porsi umum' becomes 'porsi yang TERLIHAT', plus a rule to read grams from visible scale cues (plate or bowl diameter, spoon, fork, hand) and not default to typical portions.",
  },
  "user-prior": {
    caseLine: (c) => portionHistoryLine(c),
    groups: ["external"],
    notes: "Simulated per-user portion prior (external cases only): the median of the contributor's OTHER weighed meals, per dish eaten at least twice, as one prompt line. Production would build it from the user's diary history.",
  },
};
// ---------------------------------------------------------------------------

const ROOT = join(import.meta.dir, "..");
const EVAL_DIR = join(ROOT, ".tmp", "eval");
const CACHE_DIR = join(EVAL_DIR, "cache");
const RAW_DIR = join(EVAL_DIR, "raw");
const WIKI_DIR = join(EVAL_DIR, "wikimedia");
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? "b7e6f8457bd39fa37a7eea5249799754";
/** |signed error| under this share of the true value is "close", not over/under. */
const CLOSE_PCT = 5;

type Group = "owner" | "feedback" | "external" | "wikimedia";
/** A truth item. noKcal = there is no reference kcal for it (kcal is 0 and is never scored). */
type TruthItem = EvalItem & { noKcal?: true; ref?: string };
type Case = {
  id: string;
  group: Group;
  photo: string;
  label: string;
  /** What production answered when the photo was scanned (owner/feedback). */
  recorded: EvalItem[] | null;
  /** The user's saved items; null = unlabelled. */
  truth: TruthItem[] | null;
  /** Wikimedia only: dish name and the kcal band one serving is expected in. */
  wiki?: { dish: string; min: number; max: number };
  /** External cases only. */
  external?: {
    trust: ExternalMeta["trust"];
    /** Every scored item has a reference kcal; item and plate kcal are scored only then. */
    kcalComplete: boolean;
    /** Weighed grams of the scored items (combined weights once), null when an item has none. */
    plateGrams: number | null;
    /** Visible in the photo but not part of his weights: an answer item for one is neither right nor wrong. */
    ignore: string[];
  };
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
  only: Group[];
  externalTrust: ExternalMeta["trust"];
  externalUncertain: boolean;
  dryRun: boolean;
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
    only: [],
    externalTrust: "medium",
    externalUncertain: false,
    dryRun: false,
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
      case "--only": {
        const group = value(i++);
        if (!["owner", "feedback", "external", "wikimedia"].includes(group)) throw new Error(`--only: unknown group "${group}"`);
        args.only.push(group as Group);
        break;
      }
      case "--external-trust": {
        const trust = value(i++);
        if (trust !== "high" && trust !== "medium" && trust !== "low") throw new Error("--external-trust must be high, medium or low");
        args.externalTrust = trust;
        break;
      }
      case "--external-uncertain":
        args.externalUncertain = true;
        break;
      case "--dry-run":
        args.dryRun = true;
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

// ---------------------------------------------------------------- scoring
type ErrPoint = { err: number; pct: number };
type Scored = {
  /** Item names: matches, answer items, truth items (owner/feedback/external). */
  names: { tp: number; ai: number; truth: number } | null;
  /** Wikimedia: the dish name appears among the answer items. */
  nameHit: boolean | null;
  itemKcal: ErrPoint[];
  grams: ErrPoint[];
  /** `grams` split: rice (the truth item is a nasi) and everything else (side dishes: lauk, sayur). */
  gramsRice: ErrPoint[];
  gramsSide: ErrPoint[];
  /** null = the truth has no complete reference kcal (an external case with combined weights). */
  plate: (ErrPoint & { aiKcal: number; truthKcal: number }) | null;
  /** Answer total vs the weighed total; null when either side lacks a weight. */
  plateGrams: (ErrPoint & { aiGrams: number; truthGrams: number }) | null;
  /** Wikimedia: the answer's total is inside the band. */
  inBand: boolean | null;
  /** Item by item: what paired, what the answer missed, what it added, what was set aside. */
  detail: { matches: Array<{ truth: TruthItem; ai: EvalItem }>; missed: TruthItem[]; extra: EvalItem[]; ignored: EvalItem[] };
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
      gramsRice: [],
      gramsSide: [],
      plate: { ...point(aiKcal, target), aiKcal, truthKcal: target },
      plateGrams: null,
      inBand: aiKcal >= min && aiKcal <= max,
      detail: { matches: [], missed: [], extra: [], ignored: [] },
    };
  }
  const truth = c.truth ?? [];
  const pairs = pairItems(items, truth) as Array<{ ai: EvalItem; truth: TruthItem }>;
  const paired = new Set<EvalItem>(pairs.map((p) => p.ai));
  const ignoreNames = c.external?.ignore ?? [];
  const ignored = items.filter((i) => !paired.has(i) && ignoreNames.some((n) => nameScore(i.name, n) >= NAME_MATCH_MIN));
  const answer = items.filter((i) => !ignored.includes(i));
  const noKcal = new Set<EvalItem>(truth.filter((t) => t.noKcal));
  const answerKcal = total(answer);
  const truthKcal = total(truth);
  const truthGrams = c.external ? c.external.plateGrams : truth.every((t) => t.grams !== undefined) ? sum(truth.map((t) => t.grams!)) : null;
  const aiGrams = answer.every((i) => i.grams !== undefined) ? sum(answer.map((i) => i.grams!)) : null;
  return {
    names: { tp: pairs.length, ai: answer.length, truth: truth.length },
    nameHit: null,
    itemKcal: pairs.filter((p) => !noKcal.has(p.truth)).map((p) => point(p.ai.kcal, p.truth.kcal)),
    grams: gramsPoints(pairs).map((p) => p.point),
    gramsRice: gramsPoints(pairs).flatMap((p) => (p.rice ? [p.point] : [])),
    gramsSide: gramsPoints(pairs).flatMap((p) => (p.rice ? [] : [p.point])),
    plate: c.external?.kcalComplete === false ? null : { ...point(answerKcal, truthKcal), aiKcal: answerKcal, truthKcal },
    plateGrams:
      truthGrams !== null && truthGrams > 0 && aiGrams !== null
        ? { ...point(aiGrams, truthGrams), aiGrams, truthGrams }
        : null,
    inBand: null,
    detail: {
      matches: pairs,
      missed: truth.filter((t) => !pairs.some((p) => p.truth === t)),
      extra: answer.filter((a) => !paired.has(a)),
      ignored,
    },
  };
}

/** Grams error of every pair with a weight on both sides; rice = a nasi on the truth side. */
function gramsPoints(pairs: Array<{ ai: EvalItem; truth: TruthItem }>): Array<{ point: ErrPoint; rice: boolean }> {
  return pairs.flatMap((p) =>
    p.ai.grams !== undefined && p.truth.grams !== undefined
      ? [{ point: point(p.ai.grams, p.truth.grams), rice: /\bnasi\b/i.test(p.truth.name) }]
      : [],
  );
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

/** Cache key of a variant for one case: model, final prompt (variant diff + the case's own line) and calibration. */
const fingerprint = (variant: Variant, line?: string) =>
  createHash("sha256")
    .update(
      `${variant.model ?? DEFAULT_VISION_MODEL}\n${promptFor(variant, line)(visionPrompt())}\n${JSON.stringify(variant.calibration ?? {}, (_k, v) => (v === Infinity ? "inf" : v))}`,
    )
    .digest("hex")
    .slice(0, 8);

const promptFor = (variant: Variant, line?: string) => (base: string) => {
  const prompt = (variant.promptTransform ?? ((p: string) => p))(base);
  return line ? `${prompt}\n${line}` : prompt;
};

/** Where a job's result lives in the result cache. */
const cacheFileOf = (hash: string, name: string, c: Case, rep: number) =>
  join(CACHE_DIR, `${hash}.${name}.${fingerprint(VARIANTS[name]!, VARIANTS[name]!.caseLine?.(c))}.${rep}.json`);

/**
 * Raw model answers, keyed by the exact request (model + prompt + image) and rep.
 * Variants that differ only in calibration send the same request, so they replay
 * one answer instead of paying for another: the comparison is paired, and free of
 * run-to-run noise. Concurrent identical requests share one call.
 */
const RAW_STATS = { calls: 0, replays: 0 };
const inflight = new Map<string, Promise<unknown>>();
function rawCache(base: AiRunner, rep: number, useCache: boolean): AiRunner {
  return {
    run(model, input) {
      const key = `${createHash("sha256").update(`${model}\n${JSON.stringify(input)}`).digest("hex").slice(0, 20)}.${rep}`;
      const file = join(RAW_DIR, `${key}.json`);
      if (useCache && existsSync(file)) {
        RAW_STATS.replays++;
        return Bun.file(file).json();
      }
      const pending = inflight.get(key);
      if (useCache && pending) {
        RAW_STATS.replays++;
        return pending;
      }
      RAW_STATS.calls++;
      const call = base.run(model, input).then(async (result) => {
        await Bun.write(file, JSON.stringify(result));
        return result;
      });
      inflight.set(key, call);
      return call;
    },
  };
}

async function runOne(
  ai: AiRunner,
  c: Case,
  hash: string,
  name: string,
  rep: number,
  useCache: boolean,
): Promise<RunResult> {
  const variant = VARIANTS[name]!;
  const cacheFile = cacheFileOf(hash, name, c, rep);
  if (useCache && existsSync(cacheFile)) {
    const hit: RunResult = await Bun.file(cacheFile).json();
    if (hit.ok) return { ...hit, cached: true };
  }
  const bytes = await Bun.file(c.photo).arrayBuffer();
  const started = Date.now();
  try {
    const analysis = await analyzeFoodPhoto(rawCache(ai, rep, useCache), {
      imageBase64: Buffer.from(bytes).toString("base64"),
      mimeType: "image/jpeg",
      model: variant.model,
      promptTransform: promptFor(variant, variant.caseLine?.(c)),
      calibration: variant.calibration,
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

/**
 * Everything an external contributor weighed, from every case on disk (all trust
 * levels, all `inPhoto` values: what a diary would hold), for the simulated
 * per-user portion prior.
 */
const HISTORY: Array<{ caseId: string; name: string; grams: number }> = [];

/**
 * The `user-prior` prompt line: the median weighed grams per dish over the
 * contributor's OTHER cases (leave-one-out, so a case never sees its own weights),
 * for dishes weighed in at least two other cases. undefined = nothing to say.
 */
function portionHistoryLine(c: Case): string | undefined {
  if (c.group !== "external") return undefined;
  const byName = new Map<string, number[]>();
  for (const h of HISTORY) {
    if (h.caseId !== c.id) byName.set(h.name, [...(byName.get(h.name) ?? []), h.grams]);
  }
  const prior = [...byName]
    .filter(([, grams]) => grams.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 6)
    .map(([name, grams]) => `${name} ${Math.round(quantile(grams, 0.5))} g`);
  if (!prior.length) return undefined;
  return `Riwayat porsi pengguna ini (median dari catatan makannya yang ditimbang): ${prior.join(", ")}. Pakai sebagai perkiraan awal untuk porsi yang tampak serupa; sesuaikan hanya bila foto jelas menunjukkan porsi lain.`;
}

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
  const externalRoot = join(args.dir, "external");
  if (existsSync(externalRoot)) {
    const trustRank = { low: 0, medium: 1, high: 2 };
    const dirs = (path: string) =>
      readdirSync(path, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
    for (const source of dirs(externalRoot)) {
      for (const caseDir of dirs(join(externalRoot, source))) {
        const dir = join(externalRoot, source, caseDir);
        if (!existsSync(join(dir, "meta.json")) || !existsSync(join(dir, "photo.jpg"))) continue;
        // Boundary: meta.json written by scripts/external-import.ts.
        const meta: ExternalMeta = await Bun.file(join(dir, "meta.json")).json();
        if (meta.version !== EXTERNAL_META_VERSION) continue;
        const scored = meta.items.filter((i) => i.inPhoto === "yes" || (args.externalUncertain && i.inPhoto === "uncertain"));
        const truthBlock = truthOf(meta.items, meta.groups, args.externalUncertain);
        const c: Case = {
          id: meta.caseId,
          group: "external",
          photo: join(dir, "photo.jpg"),
          label: `${meta.trust} trust, day ${meta.source.day} ${meta.source.meal}`,
          recorded: null,
          truth: scored.map((i) => ({
            name: i.name,
            ...(i.grams !== null ? { grams: i.grams } : {}),
            kcal: i.kcal ?? 0,
            ...(i.kcal === undefined ? { noKcal: true as const } : {}),
            ...(i.ref ? { ref: `${i.ref.source === "manual" ? "manual" : `${i.ref.source}: ${i.ref.name}`}${i.ref.proxy ? " (proxy)" : ""}` } : {}),
          })),
          external: {
            trust: meta.trust,
            kcalComplete: truthBlock.kcalComplete,
            plateGrams: truthBlock.plateGrams,
            ignore: [
              ...meta.extras.map((e) => e.name),
              ...(args.externalUncertain ? [] : meta.items.filter((i) => i.inPhoto === "uncertain").map((i) => i.name)),
            ],
          },
        };
        HISTORY.push(...meta.items.flatMap((i) => (i.grams !== null && !i.group ? [{ caseId: meta.caseId, name: i.name.toLowerCase(), grams: i.grams }] : [])));
        (trustRank[meta.trust] >= trustRank[args.externalTrust] ? cases : skipped).push(c);
      }
    }
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
  const wanted = args.only.length ? cases.filter((c) => args.only.includes(c.group)) : cases;
  return { cases: wanted.slice(0, args.limit), skipped };
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
  plateGrams: ErrStats;
  grams: ErrStats;
  riceGrams: ErrStats;
  sideGrams: ErrStats;
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
    plate: errStats(scored.flatMap((s) => (s.plate ? [s.plate] : []))),
    plateGrams: errStats(scored.flatMap((s) => (s.plateGrams ? [s.plateGrams] : []))),
    grams: errStats(scored.flatMap((s) => s.grams)),
    riceGrams: errStats(scored.flatMap((s) => s.gramsRice)),
    sideGrams: errStats(scored.flatMap((s) => s.gramsSide)),
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
  rows.push(...statsRows("rice grams", a.riceGrams, "g"));
  rows.push(...statsRows("side-dish grams", a.sideGrams, "g"));
  rows.push(...statsRows("plate grams", a.plateGrams, "g"));
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
  { label: "plate grams signed mean %", get: (a) => a.plateGrams.signedMeanPct },
  { label: "plate grams MAE g", get: (a) => a.plateGrams.mae, digits: 0, lowerBetter: true },
  { label: "latency p50 s", get: (a) => a.latency.p50 / 1000 },
  { label: "latency p95 s", get: (a) => a.latency.p95 / 1000 },
  { label: "failures", get: (a) => sum(Object.values(a.failures)), digits: 0, lowerBetter: true },
];

/** Plate |error| per case, averaged over reps; unmatched cases (a failed run) are left out. */
function perCasePlateAbs(runs: Run[]): Map<string, number> {
  const by = new Map<string, number[]>();
  for (const r of runs) {
    if (r.scored?.plate) by.set(r.c.id, [...(by.get(r.c.id) ?? []), Math.abs(r.scored.plate.err)]);
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
  const scored = runs.filter((r) => r.scored?.plate && r.result.ok);
  const worst = (sign: 1 | -1) =>
    scored
      .filter((r) => r.scored!.plate!.pct * sign > CLOSE_PCT)
      .sort((x, y) => y.scored!.plate!.pct * sign - x.scored!.plate!.pct * sign)
      .slice(0, n);
  const lines: string[] = [];
  for (const [title, sign] of [["Worst over-estimates", 1], ["Worst under-estimates", -1]] as const) {
    const picks = worst(sign);
    if (!picks.length) continue;
    lines.push(`**${title}** (${variant}, ${group})`, "");
    lines.push("| Case | Plate AI / truth | Error | AI answer | Truth |", "|---|---|---|---|---|");
    for (const r of picks) {
      const plate = r.scored!.plate!;
      const truth = r.c.wiki ? `band ${r.c.wiki.min}-${r.c.wiki.max} kcal (${r.c.wiki.dish})` : showItems(r.c.truth ?? []);
      const answer = r.result.ok ? showItems(r.result.items) : "";
      lines.push(`| ${r.c.id}${r.rep ? `#${r.rep}` : ""} | ${Math.round(plate.aiKcal)} / ${Math.round(plate.truthKcal)} | ${plate.err > 0 ? "+" : ""}${Math.round(plate.err)} kcal (${plate.pct > 0 ? "+" : ""}${f(plate.pct, 0)}%) | ${answer} | ${truth} |`);
    }
    lines.push("");
  }
  return lines;
}

/** External cases: every truth item against what the model said for it, grams and kcal side by side. */
function externalDetail(variant: string, runs: Run[]): string[] {
  const rows: string[] = [];
  for (const r of runs) {
    if (!r.scored || !r.result.ok) continue;
    const id = `${r.c.id}${r.rep ? `#${r.rep}` : ""}`;
    const { matches, missed, extra, ignored } = r.scored.detail;
    for (const { truth, ai } of matches) {
      const grams =
        truth.grams !== undefined && ai.grams !== undefined
          ? `${ai.grams - truth.grams > 0 ? "+" : ""}${Math.round(ai.grams - truth.grams)} g (${ai.grams > truth.grams ? "+" : ""}${f(((ai.grams - truth.grams) / truth.grams) * 100, 0)}%)`
          : "-";
      const kcal = truth.noKcal ? "-" : `${Math.round(ai.kcal)} / ${Math.round(truth.kcal)}`;
      rows.push(`| ${id} | ${truth.name} | ${truth.grams ?? "-"} | ${ai.name} | ${ai.grams !== undefined ? Math.round(ai.grams) : "-"} | ${grams} | ${kcal} | ${truth.ref ?? "-"} |`);
    }
    for (const t of missed) rows.push(`| ${id} | ${t.name} | ${t.grams ?? "-"} | (not in the answer) | - | - | - | ${t.ref ?? "-"} |`);
    for (const a of extra) rows.push(`| ${id} | (not in his list) | - | ${a.name} | ${a.grams !== undefined ? Math.round(a.grams) : "-"} | - | ${Math.round(a.kcal)} / - | - |`);
    if (ignored.length) rows.push(`| ${id} | (set aside: visible, not in his weights) | - | ${ignored.map((i) => i.name).join(", ")} | - | - | - | - |`);
  }
  if (!rows.length) return [];
  return [
    `**Item by item** (${variant}, external): grams error is AI minus his weight; kcal is AI / reference`,
    "",
    "| Case | His item | His g | AI item | AI g | Grams error | kcal AI / ref | Reference row |",
    "|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
  ];
}

// ------------------------------------------------------------------- main
async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(CACHE_DIR, { recursive: true });
  const { cases, skipped } = await loadCases(args);
  if (cases.length === 0) {
    console.log("no labelled cases to run (export the dataset, write external cases with scripts/external-import.ts --out, or pass --wikimedia)");
  }

  const hashes = new Map<string, string>();
  for (const c of cases) {
    hashes.set(c.id, createHash("sha256").update(new Uint8Array(await Bun.file(c.photo).arrayBuffer())).digest("hex").slice(0, 12));
  }

  const jobs = cases.flatMap((c) =>
    args.variants
      .filter((variant) => !VARIANTS[variant]!.groups || VARIANTS[variant]!.groups!.includes(c.group))
      .flatMap((variant) => Array.from({ length: args.reps }, (_, rep) => ({ c, variant, rep }))),
  );
  const cachedAlready = args.cache
    ? jobs.filter((j) => existsSync(cacheFileOf(hashes.get(j.c.id)!, j.variant, j.c, j.rep))).length
    : 0;
  console.log(`${cases.length} cases x ${args.variants.length} variant(s) x ${args.reps} rep(s) = ${jobs.length} runs, ${jobs.length - cachedAlready} not in the result cache (model calls only for requests with no raw answer yet; variants that differ in calibration alone replay one answer), ${skipped.length} unlabelled skipped`);

  if (args.dryRun) {
    for (const c of cases) {
      const ext = c.external;
      console.log(`\n${c.group}/${c.id} (${c.label})  ${c.photo}`);
      if (ext) {
        console.log(`  plate truth: ${ext.plateGrams === null ? "grams n/a (an item has no weight)" : `${ext.plateGrams} g`}, kcal ${ext.kcalComplete ? "complete" : "incomplete (plate and item kcal not scored)"}`);
      }
      for (const t of c.truth ?? []) {
        console.log(`  truth  ${t.name.padEnd(22)} ${t.grams !== undefined ? `${t.grams} g`.padEnd(8) : "- g".padEnd(8)} ${t.noKcal ? "no ref kcal" : `${t.kcal} kcal`}${t.ref ? `  [${t.ref}]` : ""}`);
      }
      if (ext?.ignore.length) console.log(`  set aside if the model names them: ${ext.ignore.join(", ")}`);
    }
    for (const c of skipped) console.log(`\nnot run: ${c.group}/${c.id} (${c.label})`);
    console.log("\ndry run: no model calls made, no report written");
    return;
  }

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
  console.log(`Workers AI calls made ${RAW_STATS.calls}, replayed from the raw cache ${RAW_STATS.replays}`);

  const runsBy = (variant: string, group: Group) =>
    results.flatMap((r, i) => (jobs[i]!.variant === variant && r.c.group === group ? [r] : []));
  const groups = (["owner", "feedback", "external", "wikimedia"] as const).filter((g) => cases.some((c) => c.group === g));

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
  if (groups.includes("external")) {
    md.push(
      `External cases: photos from contributors who weighed their food and agreed to internal testing. Truth = their grams; kcal = TKPI 2019 / curated-library reference for those grams (proxy rows are flagged), never their number. Run with trust >= ${args.externalTrust}${args.externalUncertain ? ", uncertain items scored" : ", uncertain items set aside"}. Items he did not weigh as a whole plate (combined weights) are scored on grams and names only. Small n: read the item table, not the averages.`,
      "",
    );
  }

  const allAggs: Agg[] = [];
  const summaryAt = md.length;
  for (const group of groups) {
    const variants = args.variants.filter((v) => !VARIANTS[v]!.groups || VARIANTS[v]!.groups!.includes(group));
    const aggs = variants.map((v) => aggregate(group, v, runsBy(v, group)));
    allAggs.push(...aggs);
    md.push(`## ${group}${group === "wikimedia" ? " (structure check; band truth, not user labels)" : ""}`, "");
    for (const a of aggs) md.push(...aggTable(a), "");
    md.push(...deltaSection(group, aggs, (v) => runsBy(v, group)));
    for (const v of variants) md.push(...worstSection(v, group, runsBy(v, group)));
    if (group === "external") for (const v of variants) md.push(...externalDetail(v, runsBy(v, group)));
  }
  const cell = (st: ErrStats, unit: "g" | "kcal") => (st.n ? `${f(st.signedMeanPct, 0)}% / ${f(st.mae, 0)} ${unit} (n ${st.n})` : "-");
  // An owner scan saved unedited has the model's own answer as truth, so only the edited ones (corrected, retried) test a change.
  const edited = (r: Run) => r.c.label === "corrected" || r.c.label === "retried";
  const summaryRows = allAggs.flatMap((a) => {
    const rows = [{ set: a.group as string, agg: a }];
    if (a.group === "owner") {
      const subset = runsBy(a.variant, "owner").filter(edited);
      if (subset.length) rows.push({ set: "owner, edited only (corrected + retried)", agg: aggregate("owner", a.variant, subset) });
    }
    return rows;
  });
  md.splice(
    summaryAt,
    0,
    "## Variant summary",
    "",
    "Signed mean = mean of (AI - truth) / truth; MAE in g or kcal; n = matched items or plates over all reps. Rice = a truth item named nasi; side = every other matched item (lauk, sayur).",
    "",
    "| Set | Variant | Runs | Name F1 | Rice grams signed / MAE | Side-dish grams signed / MAE | Plate kcal signed / MAE | Plate kcal under / over |",
    "|---|---|---|---|---|---|---|---|",
    ...summaryRows.map(
      ({ set, agg: a }) =>
        `| ${set} | ${a.variant} | ${a.runs} | ${a.name ? `${f(a.name.f1 * 100, 0)}%` : "-"} | ${cell(a.riceGrams, "g")} | ${cell(a.sideGrams, "g")} | ${cell(a.plate, "kcal")} | ${a.plate.under.n} / ${a.plate.over.n} |`,
    ),
    "",
  );

  // The answer production gave at scan time vs the saved items (no model calls).
  const recorded = cases.filter((c) => c.recorded && c.truth);
  if (recorded.length) {
    const rec = recorded.map((c) => ({ c, s: scoreCase(c, c.recorded!) }));
    const st = errStats(rec.flatMap((r) => (r.s.plate ? [r.s.plate] : [])));
    md.push(
      "## As recorded at scan time",
      "",
      `Production's answer when the photo was scanned vs the saved items, ${rec.length} cases (no model calls; scans saved unedited score perfectly by construction): plate over ${st.over.n}, under ${st.under.n}, close ${st.close}; signed mean ${f(st.signedMeanPct)}%.`,
      "",
    );
  }

  if (skipped.length) {
    md.push(
      "## Not run (skipped)",
      "",
      `${skipped.length} cases were not run (no saved items, or an external case below the trust floor): ${skipped.map((c) => `${c.id} (${c.label})`).join(", ")}`,
      "",
    );
  }

  mkdirSync(EVAL_DIR, { recursive: true });
  const base = join(EVAL_DIR, `report-${date}${args.only.length ? `-${args.only.join("+")}` : ""}`);
  await Bun.write(`${base}.md`, `${md.join("\n")}\n`);
  await Bun.write(
    `${base}.json`,
    JSON.stringify(
      {
        date,
        args: { variants: args.variants, wikimedia: args.wikimedia, only: args.only, externalTrust: args.externalTrust, externalUncertain: args.externalUncertain, limit: Number.isFinite(args.limit) ? args.limit : null, reps: args.reps },
        variants: Object.fromEntries(args.variants.map((v) => [v, { notes: VARIANTS[v]!.notes, fingerprint: fingerprint(VARIANTS[v]!) }])),
        aggregates: allAggs,
        skipped: skipped.map((c) => ({ id: c.id, label: c.label })),
        cases: results.map((r, i) => ({
          id: r.c.id,
          group: r.c.group,
          label: r.c.label,
          variant: jobs[i]!.variant,
          rep: r.rep,
          ok: r.result.ok,
          ...(r.result.ok ? { items: r.result.items, ms: r.result.ms, cached: r.result.cached } : { reason: r.result.reason }),
          truth: r.c.wiki ?? r.c.truth,
          plate: r.scored?.plate ?? null,
          plateGrams: r.scored?.plateGrams ?? null,
          detail: r.scored?.detail ?? null,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`wrote ${base.replace(`${ROOT}/`, "")}.md and .json`);
  for (const a of allAggs) {
    console.log(
      `${a.group}/${a.variant}: ${a.runs} runs, ${sum(Object.values(a.failures))} failed; plate over ${a.plate.over.n} (${f(a.plate.over.meanPct, 0)}%) under ${a.plate.under.n} (${f(a.plate.under.meanPct, 0)}%) close ${a.plate.close}; p50 ${sec(a.latency.p50)} p95 ${sec(a.latency.p95)}`,
    );
  }
}

if (import.meta.main) await main();
