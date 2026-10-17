// Downloads the owner's internal accuracy dataset (R2 dataset/<userId>/<scanId>/)
// into .tmp/dataset/ and writes one JSONL summary row per scan.
//
// Usage: AI_BENCH_KEY=... bun run scripts/dataset-export.ts
//        EXPORT_URL=https://api.joyorogo.com  (default)
//
// Reads through the key-gated /ai/dataset/* routes of the server (the same
// X-Bench-Key secret as /ai/bench); only the dataset/ prefix is reachable.
// Photos already on disk are not downloaded again; meta.json is always fetched
// because it changes over a scan's life (retry, corrections, diary save).
//
// Row: { scan_id, user_id, photo, model, created_at, ai_items, final_items,
//        retried, retries, corrections, label }
//   label = correct   saved exactly as the AI answered
//         | corrected saved with edits (final_items vs ai_items is the diff)
//         | retried   the user asked for a re-read: the first answer was wrong
//         | unsaved   no diary save yet (kept so nothing is lost; filter it out)
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { datasetLabel } from "../packages/api/src/lib/dataset";
import type { DatasetMeta } from "../packages/api/src/lib/dataset";

const base = process.env.EXPORT_URL ?? "https://api.joyorogo.com";
const key = process.env.AI_BENCH_KEY ?? "";
const outDir = join(import.meta.dir, "..", ".tmp", "dataset");

if (!key) {
  console.error("AI_BENCH_KEY is required (and must match the AI_BENCH_KEY secret).");
  process.exit(1);
}

async function get(path: string): Promise<Response> {
  const response = await fetch(`${base}${path}`, { headers: { "X-Bench-Key": key } });
  if (response.status === 404) {
    throw new Error(`404 on ${path}: wrong key, or the object is gone`);
  }
  if (!response.ok) throw new Error(`${response.status} on ${path}`);
  return response;
}

async function listKeys(): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = (await (
      await get(`/ai/dataset/list${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`)
    ).json()) as { keys: string[]; cursor?: string };
    keys.push(...page.keys);
    cursor = page.cursor;
  } while (cursor);
  return keys;
}

async function download(objectKey: string, to: string): Promise<void> {
  const response = await get(`/ai/dataset/object?key=${encodeURIComponent(objectKey)}`);
  await Bun.write(to, response);
}

const keys = await listKeys();
const scans = keys
  .map((k) => /^dataset\/([^/]+)\/([^/]+)\/meta\.json$/.exec(k))
  .filter((m): m is RegExpExecArray => m !== null)
  .map((m) => ({ userId: m[1]!, scanId: m[2]! }));
console.log(`${scans.length} scans in the dataset`);

const rows: string[] = [];
const counts: Record<string, number> = {};
for (const { userId, scanId } of scans) {
  const dir = join(outDir, userId, scanId);
  await mkdir(dir, { recursive: true });
  const prefix = `dataset/${userId}/${scanId}`;
  const photo = join(dir, "photo.jpg");
  const metaFile = join(dir, "meta.json");
  await download(`${prefix}/meta.json`, metaFile);
  if (!(await Bun.file(photo).exists())) await download(`${prefix}/photo.jpg`, photo);
  const meta = (await Bun.file(metaFile).json()) as DatasetMeta;
  const label = datasetLabel(meta);
  counts[label] = (counts[label] ?? 0) + 1;
  rows.push(
    JSON.stringify({
      scan_id: scanId,
      user_id: userId,
      photo: join(".tmp", "dataset", userId, scanId, "photo.jpg"),
      model: meta.model,
      created_at: meta.createdAt,
      ai_items: meta.aiItems,
      final_items: meta.final?.items ?? null,
      retried: meta.retries.length > 0,
      retries: meta.retries,
      corrections: meta.corrections,
      label,
    }),
  );
}

await mkdir(outDir, { recursive: true });
await Bun.write(join(outDir, "summary.jsonl"), rows.length ? `${rows.join("\n")}\n` : "");
console.log(`wrote ${join(".tmp", "dataset", "summary.jsonl")}`, counts);
