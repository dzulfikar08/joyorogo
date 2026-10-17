// Internal accuracy dataset. For users on the DATASET_USER_IDS allowlist (the
// owner) every scan is kept as a labelled eval case in R2:
//
//   dataset/<userId>/<scanId>/photo.jpg   the photo the model saw
//   dataset/<userId>/<scanId>/meta.json   model answer, retries, corrections,
//                                         the diary save, timestamps; rewritten
//                                         as the scan moves along
//
// <scanId> is the photoId analyzeFood hands the clients, so retry, correction,
// feedback and the final food.addScan all find the record from the id they
// already carry. Nobody else's photos are kept: every function here is a no-op
// unless `datasetEnabled`. Bookkeeping only: failures are logged, never thrown.
import type { StickersBucket } from "./sticker";

export const DATASET_PREFIX = "dataset/";

export function datasetPrefix(userId: string): string {
  return `${DATASET_PREFIX}${userId}/`;
}

export function datasetPhotoKey(userId: string, scanId: string): string {
  return `${datasetPrefix(userId)}${scanId}/photo.jpg`;
}

export function datasetMetaKey(userId: string, scanId: string): string {
  return `${datasetPrefix(userId)}${scanId}/meta.json`;
}

/** `DATASET_USER_IDS` is a comma-separated user id allowlist; empty or unset = nobody. */
export function datasetEnabled(env: { DATASET_USER_IDS?: string }, userId: string): boolean {
  return (env.DATASET_USER_IDS ?? "")
    .split(",")
    .some((id) => id.trim() !== "" && id.trim() === userId);
}

/** An item as the model or the diary holds it. */
export type DatasetItem = {
  name: string;
  portion?: string;
  grams?: number;
  kcal: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  confidence?: number;
  kind?: string;
  box?: unknown;
};

export type DatasetCorrection = {
  at: string;
  via: "text" | "voice";
  text: string;
  /** Whisper's transcript (voice only); `text` is what the model got. */
  transcript?: string;
  model: string;
  latencyMs: number;
  before: DatasetItem[];
  after: DatasetItem[];
  changes: Array<{ index: number; kind: string }>;
  removed: string[];
};

export type DatasetMeta = {
  version: 1;
  scanId: string;
  userId: string;
  createdAt: string;
  model: string;
  locale: string;
  /** The model's first answer for the photo. */
  aiItems: DatasetItem[];
  tooMany: boolean;
  /** "Hitung ulang" passes: each one means the answer before it was wrong. */
  retries: Array<{ at: string; model: string; hint?: string; items: DatasetItem[] }>;
  corrections: DatasetCorrection[];
  feedback?: { at: string; rating: string; reasons?: string[]; note?: string };
  /** What the diary got; absent until the user saves. */
  final?: {
    at: string;
    meal: string;
    date: string;
    items: DatasetItem[];
    diff: ItemsDiff;
  };
};

export type DatasetLabel = "correct" | "corrected" | "retried" | "unsaved";

export type ItemsDiff = {
  removed: DatasetItem[];
  added: DatasetItem[];
  changed: Array<{ name: string; ai: DatasetItem; final: DatasetItem }>;
};

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

function sameNumber(a: number | undefined, b: number | undefined, tolerance: number): boolean {
  return a === undefined || b === undefined || Math.abs(a - b) < tolerance;
}

/**
 * What the user changed between the AI's answer and the diary. Items pair up by
 * name (a renamed dish shows as removed + added); a pair differs when kcal or
 * grams moved by 1 or more.
 */
export function itemsDiff(ai: readonly DatasetItem[], final: readonly DatasetItem[]): ItemsDiff {
  const pool = [...final];
  const diff: ItemsDiff = { removed: [], added: [], changed: [] };
  for (const item of ai) {
    const at = pool.findIndex((candidate) => slug(candidate.name) === slug(item.name));
    if (at === -1) {
      diff.removed.push(item);
      continue;
    }
    const [match] = pool.splice(at, 1);
    if (!sameNumber(item.kcal, match!.kcal, 1) || !sameNumber(item.grams, match!.grams, 1)) {
      diff.changed.push({ name: match!.name, ai: item, final: match! });
    }
  }
  diff.added = pool;
  return diff;
}

/**
 * correct = saved exactly as the AI answered; corrected = saved with edits (the
 * diff is the label); retried = the user asked for a re-read, so the first
 * answer was wrong whatever got saved; unsaved = no diary save (yet).
 */
export function datasetLabel(meta: DatasetMeta): DatasetLabel {
  if (meta.retries.length > 0) return "retried";
  if (!meta.final) return "unsaved";
  const { removed, added, changed } = itemsDiff(meta.aiItems, meta.final.items);
  return removed.length + added.length + changed.length === 0 ? "correct" : "corrected";
}

async function readMeta(bucket: StickersBucket, key: string): Promise<DatasetMeta | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  return JSON.parse(new TextDecoder().decode(await object.arrayBuffer())) as DatasetMeta;
}

function writeMeta(bucket: StickersBucket, key: string, meta: DatasetMeta): Promise<unknown> {
  return bucket.put(key, JSON.stringify(meta), {
    httpMetadata: { contentType: "application/json" },
  });
}

/**
 * Read-modify-write of one scan's meta.json. A scan with no record (made before
 * the user was on the allowlist) is left alone.
 */
async function updateMeta(
  bucket: StickersBucket,
  userId: string,
  scanId: string,
  change: (meta: DatasetMeta) => void,
): Promise<void> {
  const key = datasetMetaKey(userId, scanId);
  const meta = await readMeta(bucket, key);
  if (!meta) return;
  change(meta);
  await writeMeta(bucket, key, meta);
}

/** Runs one bookkeeping write; a failure is logged and swallowed. */
async function safely(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(`[dataset] ${label} failed`, error);
  }
}

export function recordScan(
  bucket: StickersBucket,
  scan: {
    userId: string;
    scanId: string;
    photo: ArrayBuffer;
    mimeType: string;
    model: string;
    locale: string;
    items: readonly DatasetItem[];
    tooMany: boolean;
  },
): Promise<void> {
  return safely("scan", async () => {
    const meta: DatasetMeta = {
      version: 1,
      scanId: scan.scanId,
      userId: scan.userId,
      createdAt: new Date().toISOString(),
      model: scan.model,
      locale: scan.locale,
      aiItems: [...scan.items],
      tooMany: scan.tooMany,
      retries: [],
      corrections: [],
    };
    await Promise.all([
      bucket.put(datasetPhotoKey(scan.userId, scan.scanId), scan.photo, {
        httpMetadata: { contentType: scan.mimeType },
      }),
      writeMeta(bucket, datasetMetaKey(scan.userId, scan.scanId), meta),
    ]);
  });
}

export function recordRetry(
  bucket: StickersBucket,
  userId: string,
  scanId: string,
  retry: { model: string; hint?: string; items: readonly DatasetItem[] },
): Promise<void> {
  return safely("retry", () =>
    updateMeta(bucket, userId, scanId, (meta) => {
      meta.retries.push({
        at: new Date().toISOString(),
        model: retry.model,
        ...(retry.hint ? { hint: retry.hint } : {}),
        items: [...retry.items],
      });
    }),
  );
}

export function recordCorrection(
  bucket: StickersBucket,
  userId: string,
  scanId: string,
  correction: Omit<DatasetCorrection, "at">,
): Promise<void> {
  return safely("correction", () =>
    updateMeta(bucket, userId, scanId, (meta) => {
      meta.corrections.push({ at: new Date().toISOString(), ...correction });
    }),
  );
}

export function recordFeedback(
  bucket: StickersBucket,
  userId: string,
  scanId: string,
  feedback: { rating: string; reasons?: string[]; note?: string },
): Promise<void> {
  return safely("feedback", () =>
    updateMeta(bucket, userId, scanId, (meta) => {
      meta.feedback = { at: new Date().toISOString(), ...feedback };
    }),
  );
}

/** The diary save: the last one wins when a scan is somehow saved twice. */
export function recordFinal(
  bucket: StickersBucket,
  userId: string,
  scanId: string,
  saved: { meal: string; date: string; items: readonly DatasetItem[] },
): Promise<void> {
  return safely("final", () =>
    updateMeta(bucket, userId, scanId, (meta) => {
      meta.final = {
        at: new Date().toISOString(),
        meal: saved.meal,
        date: saved.date,
        items: [...saved.items],
        diff: itemsDiff(meta.aiItems, saved.items),
      };
    }),
  );
}
