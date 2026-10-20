// Downloads the accuracy datasets into .tmp/dataset/ and writes one JSONL
// summary row per scan:
//   owner     R2 dataset/<userId>/<scanId>/   every scan of the owner (label from the diary save)
//   feedback  R2 feedback/<userId>/<photoId>/ photos users opted in to keep with a
//                                             negative rating (empty until users opt in)
//   external  R2 dataset/external/<source>/<caseId>/  weighed meals contributed by people
//             outside the app (see packages/api/src/lib/external-case.ts); written to
//             .tmp/dataset/external/<source>/<caseId>/ as is (no user ids in them) and
//             read by scripts/eval-scans.ts straight from there, not through summary.jsonl
//
// Usage: AI_BENCH_KEY=... bun run scripts/dataset-export.ts
//        EXPORT_URL=https://api.joyorogo.com  (default)
//
// Reads through the key-gated /ai/dataset/* routes of the server (the same
// X-Bench-Key secret as /ai/bench); only those two prefixes are reachable.
// Photos already on disk are not downloaded again; meta.json is always fetched
// because it changes over a scan's life (retry, corrections, diary save).
//
// Anonymized on disk: cases live at .tmp/dataset/<set>/<caseId>/ where caseId is
// a stable 10-hex hash of the user id + scan id; user ids never reach the
// disk, the summary or the log. A local meta.json is the server's with userId
// replaced by the case id and the free-text note dropped.
//
// Row: { case_id, set, photo, model, created_at, ai_items, retry_items, truth_items,
//        retried, retries, corrections, label, rating?, reasons?, after_retry? }
//   items are { name, grams?, kcal }.
//   truth_items = what the user saved (owner final.items, feedback savedItems); null = unlabelled.
//   label (owner)    correct | corrected | retried | unsaved  (see datasetLabel)
//   label (feedback) rated_<rating>, or unsaved when nothing was saved afterwards
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { datasetLabel } from "../packages/api/src/lib/dataset";
import type { DatasetItem, DatasetMeta } from "../packages/api/src/lib/dataset";
import type { FeedbackKeepMeta } from "../packages/api/src/lib/feedback-keep";

const base = process.env.EXPORT_URL ?? "https://api.joyorogo.com";
const key = process.env.AI_BENCH_KEY ?? "";
const outDir = join(import.meta.dir, "..", ".tmp", "dataset");

export type EvalItem = { name: string; grams?: number; kcal: number };
export type SummaryRow = {
  case_id: string;
  set: "owner" | "feedback";
  photo: string;
  model?: string;
  created_at: string;
  ai_items: EvalItem[];
  retry_items: EvalItem[] | null;
  truth_items: EvalItem[] | null;
  retried: boolean;
  retries: number;
  corrections: number;
  label: string;
  rating?: string;
  reasons?: string[];
  after_retry?: boolean;
};

const toEval = (item: DatasetItem): EvalItem => ({ name: item.name, grams: item.grams, kcal: item.kcal });
const fromCompact = (item: { n: string; g?: number; k: number }): EvalItem => ({
  name: item.n,
  grams: item.g,
  kcal: item.k,
});

/** Stable, non-reversible case id; the only identifier that reaches disk and reports. */
export function caseId(userId: string, scanId: string): string {
  return createHash("sha256").update(`joyorogo-eval:${userId}/${scanId}`).digest("hex").slice(0, 10);
}

async function get(path: string): Promise<Response> {
  const response = await fetch(`${base}${path}`, { headers: { "X-Bench-Key": key } });
  if (response.status === 404) {
    throw new Error(`404 on ${path.split("?")[0]}: wrong key, or the object is gone`);
  }
  if (!response.ok) throw new Error(`${response.status} on ${path.split("?")[0]}`);
  return response;
}

async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const query = `prefix=${encodeURIComponent(prefix)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const page = (await (await get(`/ai/dataset/list?${query}`)).json()) as {
      keys: string[];
      cursor?: string;
    };
    keys.push(...page.keys);
    cursor = page.cursor;
  } while (cursor);
  return keys;
}

async function download(objectKey: string, to: string): Promise<void> {
  const response = await get(`/ai/dataset/object?key=${encodeURIComponent(objectKey)}`);
  await Bun.write(to, response);
}

/** The scans of one prefix: ids parsed from the meta.json keys. */
function scansOf(keys: string[], prefix: string): Array<{ userId: string; id: string }> {
  // Exactly two segments below the prefix: dataset/external/<source>/<caseId>/ is deeper and never matches.
  const re = new RegExp(`^${prefix}([^/]+)/([^/]+)/meta\\.json$`);
  return keys.flatMap((k) => {
    const m = re.exec(k);
    return m ? [{ userId: m[1]!, id: m[2]! }] : [];
  });
}

/** External cases among the dataset/ keys: <source>/<caseId> of every meta.json. */
function externalCasesOf(keys: string[]): Array<{ source: string; id: string }> {
  return keys.flatMap((k) => {
    const m = /^dataset\/external\/([^/]+)\/([^/]+)\/meta\.json$/.exec(k);
    return m ? [{ source: m[1]!, id: m[2]! }] : [];
  });
}

async function fetchCase(
  set: SummaryRow["set"],
  prefix: string,
  userId: string,
  id: string,
): Promise<{ id: string; meta: unknown }> {
  const cid = caseId(userId, id);
  const dir = join(outDir, set, cid);
  await mkdir(dir, { recursive: true });
  const remote = `${prefix}${userId}/${id}`;
  const photo = join(dir, "photo.jpg");
  const metaFile = join(dir, "meta.json");
  await download(`${remote}/meta.json`, metaFile);
  if (!(await Bun.file(photo).exists())) await download(`${remote}/photo.jpg`, photo);
  // Boundary: the server's own meta.json, whose shape depends on the set.
  const meta: Record<string, unknown> = await Bun.file(metaFile).json();
  // Strip identifiers and free text before anything else reads it.
  const { note: _note, feedback, ...rest } = meta;
  const clean = {
    ...rest,
    userId: cid,
    ...(feedback && typeof feedback === "object" ? { feedback: { ...feedback, note: undefined } } : {}),
  };
  await Bun.write(metaFile, JSON.stringify(clean));
  return { id: cid, meta: clean };
}

async function main() {
  if (!key) {
    console.error("AI_BENCH_KEY is required (and must match the AI_BENCH_KEY secret).");
    process.exit(1);
  }

  const rows: SummaryRow[] = [];
  const counts: Record<string, number> = {};
  const count = (label: string) => {
    counts[label] = (counts[label] ?? 0) + 1;
  };

  const datasetKeys = await listKeys("dataset/");
  const owner = scansOf(datasetKeys, "dataset/");
  console.log(`${owner.length} scans in the owner dataset`);
  for (const { userId, id } of owner) {
    const { id: cid, meta } = await fetchCase("owner", "dataset/", userId, id);
    const m = meta as DatasetMeta;
    const label = datasetLabel(m);
    count(`owner:${label}`);
    const lastRetry = m.retries.at(-1);
    rows.push({
      case_id: cid,
      set: "owner",
      photo: join(".tmp", "dataset", "owner", cid, "photo.jpg"),
      model: m.model,
      created_at: m.createdAt,
      ai_items: m.aiItems.map(toEval),
      retry_items: lastRetry ? lastRetry.items.map(toEval) : null,
      truth_items: m.final ? m.final.items.map(toEval) : null,
      retried: m.retries.length > 0,
      retries: m.retries.length,
      corrections: m.corrections.length,
      label,
    });
  }

  const feedback = scansOf(await listKeys("feedback/"), "feedback/");
  console.log(`${feedback.length} consented feedback photos`);
  for (const { userId, id } of feedback) {
    const { id: cid, meta } = await fetchCase("feedback", "feedback/", userId, id);
    const m = meta as FeedbackKeepMeta;
    const label = m.savedItems ? `rated_${m.rating}` : "unsaved";
    count(`feedback:${label}`);
    rows.push({
      case_id: cid,
      set: "feedback",
      photo: join(".tmp", "dataset", "feedback", cid, "photo.jpg"),
      model: m.model,
      created_at: m.createdAt,
      ai_items: m.aiItems.map(fromCompact),
      retry_items: m.retryItems ? m.retryItems.map(fromCompact) : null,
      truth_items: m.savedItems ? m.savedItems.map(fromCompact) : null,
      retried: m.afterRetry,
      retries: m.afterRetry ? 1 : 0,
      corrections: 0,
      label,
      rating: m.rating,
      reasons: m.reasons,
      after_retry: m.afterRetry,
    });
  }

  const external = externalCasesOf(datasetKeys);
  console.log(`${external.length} external cases`);
  for (const { source, id } of external) {
    const dir = join(outDir, "external", source, id);
    await mkdir(dir, { recursive: true });
    const remote = `dataset/external/${source}/${id}`;
    await download(`${remote}/meta.json`, join(dir, "meta.json"));
    if (!(await Bun.file(join(dir, "photo.jpg")).exists())) await download(`${remote}/photo.jpg`, join(dir, "photo.jpg"));
    count(`external:${source}`);
  }

  await mkdir(outDir, { recursive: true });
  await Bun.write(
    join(outDir, "summary.jsonl"),
    rows.length ? `${rows.map((r) => JSON.stringify(r)).join("\n")}\n` : "",
  );
  console.log(`wrote ${join(".tmp", "dataset", "summary.jsonl")}`, counts);
}

if (import.meta.main) await main();
