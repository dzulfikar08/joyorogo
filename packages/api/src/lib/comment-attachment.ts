// What a comment can carry besides text: one photo the commenter uploaded, or a snapshot of one of their own items in
// the app (workout, meal/plate, weigh-in, weekly recap, route).
//
// An item is read once, on the commenter's own account, when the comment is written, and the numbers other people see
// are that snapshot (`comment.attachment_json`). Nothing else about the item is reachable from the comment: no ids of the
// source row, no place (a plate's lat/lng), no full-resolution route (only the 200 m-trimmed `mapLine`, see feed-route).

import { and, desc, eq, isNull, ne, inArray } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@joyorogo/db";
import type { DayZone } from "@joyorogo/i18n";
import { exerciseLog, foodLog, profile as profileTable, weightLog } from "@joyorogo/db/schema/fitness";
import { plate } from "@joyorogo/db/schema/plans";
import { watchWorkout } from "@joyorogo/db/schema/watch-workout";

import { jakartaToday, shiftDate } from "./engine";
import { cleanImage, sniffImage } from "./image-clean";
import { commentPhotoKey, photoKey } from "./sticker";
import { buildFeedMapLine, sportKindFromName } from "./feed-route";
import { loadWeekRecap } from "./recap-store";
import { recapShare, weekStartOf } from "./recap";
import type { RecapShare } from "./recap";
import { decodePoints, readDoc, watchBlobKey } from "./watch-workout";

export const ITEM_KINDS = ["workout", "food", "weight", "recap", "route"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export type AttachmentStats = Record<string, number | string | null>;

/** What every viewer receives. `hasPhoto`: GET /comment-photo/{commentId} serves an image (the photo, or a meal's photo). */
export type Attachment = {
  kind: "image" | ItemKind;
  /** The item's own name (workout, plate); '' for kinds the clients title themselves (image, weight, recap). */
  title: string;
  /** Day of the item in the sharer's zone, 'YYYY-MM-DD'. */
  date: string | null;
  /** Encoded polyline, only for kind 'route'. */
  mapLine: string | null;
  hasPhoto: boolean;
  stats: AttachmentStats;
};

/** What `post_comment.attachment_json` holds: the preview plus the R2 id of its photo (never sent out). */
export type StoredAttachment = Attachment & { photoId?: string };

export const attachmentInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("image"), photoId: z.string().regex(/^[a-f0-9]{32}$/) }),
  z.object({ kind: z.enum(ITEM_KINDS), refId: z.string().min(1).max(100) }),
]);
export type AttachmentInput = z.infer<typeof attachmentInputSchema>;

export function toPublicAttachment(stored: StoredAttachment): Attachment {
  return {
    kind: stored.kind,
    title: stored.title,
    date: stored.date,
    mapLine: stored.mapLine,
    hasPhoto: stored.hasPhoto,
    stats: stored.stats,
  };
}

/** Stored JSON back to an attachment; null for an empty or damaged value (a comment must never fail to render). */
export function parseStoredAttachment(json: string | null): StoredAttachment | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<StoredAttachment> | null;
    if (!parsed || typeof parsed !== "object" || typeof parsed.kind !== "string") return null;
    if (parsed.kind !== "image" && !(ITEM_KINDS as readonly string[]).includes(parsed.kind)) return null;
    return {
      kind: parsed.kind,
      title: typeof parsed.title === "string" ? parsed.title : "",
      date: typeof parsed.date === "string" ? parsed.date : null,
      mapLine: typeof parsed.mapLine === "string" ? parsed.mapLine : null,
      hasPhoto: parsed.hasPhoto === true,
      stats: parsed.stats && typeof parsed.stats === "object" ? parsed.stats : {},
      ...(typeof parsed.photoId === "string" ? { photoId: parsed.photoId } : {}),
    };
  } catch {
    return null;
  }
}

export type AttachmentFailure = "notFound" | "mapOff" | "noRoute";

const round0 = (n: number) => Math.round(n);
const round1 = (n: number) => Math.round(n * 10) / 10;
const orNull = (n: number | null | undefined, round: (v: number) => number = round0) =>
  n === null || n === undefined || !Number.isFinite(n) ? null : round(n);

/** A weigh-in against where the plan began (a gain plan counts from where the gain began). */
export function weightDeltaKg(
  weightKg: number,
  profile: { goal: string | null; goalStartKg: number | null; startWeightKg: number },
): number {
  const base = profile.goal === "gain" ? (profile.goalStartKg ?? profile.startWeightKg) : profile.startWeightKg;
  return Number((weightKg - base).toFixed(1));
}

// --- Row -> attachment --------------------------------------------------------------------------------------

type WatchRow = typeof watchWorkout.$inferSelect;
type ExerciseRow = typeof exerciseLog.$inferSelect;
type FoodRow = typeof foodLog.$inferSelect;

function watchStartOf(externalId: string | null): number | null {
  const match = /^watch:(\d{9,12})$/.exec(externalId ?? "");
  return match ? Number(match[1]) : null;
}

function workoutAttachment(row: ExerciseRow, watch: WatchRow | undefined): Attachment {
  return {
    kind: "workout",
    title: row.name,
    date: row.date,
    mapLine: null,
    hasPhoto: false,
    stats: {
      durationMin: orNull(row.durationMin),
      kcal: orNull(row.kcal),
      distanceM: orNull(watch?.distanceM),
      sportKind: watch?.sportKind ?? sportKindFromName(`${row.type ?? ""} ${row.name}`),
      avgHr: orNull(watch?.avgHr),
    },
  };
}

function routeAttachment(row: WatchRow, mapLine: string | null, zone: DayZone): Attachment {
  return {
    kind: "route",
    title: row.sportName,
    date: jakartaToday(new Date(row.start * 1000), zone),
    mapLine,
    hasPhoto: false,
    stats: {
      distanceM: orNull(row.distanceM),
      durationMin: orNull(row.movingSec / 60),
      sportKind: row.sportKind,
    },
  };
}

function foodAttachment(rows: FoodRow[], title: string, meal: string): StoredAttachment {
  const sum = (pick: (row: FoodRow) => number | null) => {
    const values = rows.map(pick).filter((v): v is number => v !== null);
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
  };
  const photoId = rows.find((row) => row.photoId)?.photoId ?? null;
  return {
    kind: "food",
    title,
    date: rows[0]?.date ?? null,
    mapLine: null,
    hasPhoto: photoId !== null,
    stats: {
      kcal: orNull(sum((row) => row.kcal)),
      protein: orNull(sum((row) => row.protein), round1),
      carbs: orNull(sum((row) => row.carbs), round1),
      fat: orNull(sum((row) => row.fat), round1),
      meal,
      items: rows.length,
    },
    ...(photoId ? { photoId } : {}),
  };
}

function weightAttachment(row: typeof weightLog.$inferSelect, deltaKg: number): Attachment {
  return {
    kind: "weight",
    title: "",
    date: row.date,
    mapLine: null,
    hasPhoto: false,
    stats: { weightKg: round1(row.weightKg), deltaKg },
  };
}

function recapAttachment(share: RecapShare): Attachment {
  return {
    kind: "recap",
    title: "",
    date: share.weekStart,
    mapLine: null,
    hasPhoto: false,
    stats: {
      weekStart: share.weekStart,
      weekEnd: share.weekEnd,
      avgKcal: round0(share.avgKcal),
      targetKcal: round0(share.targetKcal),
      daysOnTarget: share.daysOnTarget,
      loggedDays: share.loggedDays,
      streakDays: share.streakDays,
      exerciseMin: round0(share.exerciseMin),
      weightChangeKg: orNull(share.weightChangeKg, round1),
    },
  };
}

// --- Lookups (always scoped to the commenter) ---------------------------------------------------------------------

const exerciseShareable = (userId: string) =>
  and(eq(exerciseLog.userId, userId), ne(exerciseLog.source, "strava"), ne(exerciseLog.source, "rest"));

async function watchRowsFor(db: Database, userId: string, starts: number[]): Promise<Map<number, WatchRow>> {
  if (starts.length === 0) return new Map();
  const rows = await db
    .select()
    .from(watchWorkout)
    .where(and(eq(watchWorkout.userId, userId), isNull(watchWorkout.deletedAt), inArray(watchWorkout.start, starts)));
  return new Map(rows.map((row) => [row.start, row]));
}

async function profileFor(db: Database, userId: string) {
  const [row] = await db
    .select({
      shareMaps: profileTable.shareMaps,
      goal: profileTable.goal,
      goalStartKg: profileTable.goalStartKg,
      startWeightKg: profileTable.startWeightKg,
    })
    .from(profileTable)
    .where(eq(profileTable.userId, userId))
    .limit(1);
  return row ?? null;
}

type StickersReader = { get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> };
type PhotoStore = StickersReader & {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
};

/**
 * The meal's photo as the comment's own object: the diary original is private (and was stored as the phone sent it,
 * metadata included), so viewers get a metadata-free copy under `comments/<user>/`. Null when there is no photo or it
 * is not a JPEG/WebP that cleans; the attachment then goes without a photo.
 */
async function copyDiaryPhoto(bucket: PhotoStore | undefined, userId: string, diaryPhotoId: string): Promise<string | null> {
  if (!bucket) return null;
  try {
    const found = await bucket.get(photoKey(userId, diaryPhotoId));
    if (!found) return null;
    const bytes = new Uint8Array(await found.arrayBuffer());
    const mime = sniffImage(bytes) === "webp" ? "image/webp" : "image/jpeg";
    const clean = cleanImage(bytes, mime);
    if (!clean) return null;
    const id = crypto.randomUUID().replaceAll("-", "");
    await bucket.put(commentPhotoKey(userId, id), clean.bytes.buffer, { httpMetadata: { contentType: mime } });
    return id;
  } catch {
    return null;
  }
}

async function withOwnPhotoCopy(bucket: PhotoStore | undefined, userId: string, food: StoredAttachment): Promise<StoredAttachment> {
  const { photoId, ...rest } = food;
  const copy = photoId ? await copyDiaryPhoto(bucket, userId, photoId) : null;
  return copy ? { ...rest, hasPhoto: true, photoId: copy } : { ...rest, hasPhoto: false };
}

/** The privacy-trimmed route of a watch workout, read from its stored document. */
async function routeLineOf(bucket: StickersReader | undefined, userId: string, start: number): Promise<string | null> {
  if (!bucket) return null;
  try {
    const object = await bucket.get(watchBlobKey(userId, start));
    if (!object) return null;
    const doc = await readDoc(new Uint8Array(await object.arrayBuffer()));
    const gps = decodePoints(doc.points).flatMap((p) => (p.lat !== null && p.lon !== null ? [[p.lat, p.lon] as const] : []));
    return buildFeedMapLine(doc.analysis?.series?.track ?? gps);
  } catch {
    return null;
  }
}

/**
 * Snapshot of one of `userId`'s own items, or why it cannot be attached. Another user's id, a Strava workout (its data
 * is never shared), a deleted row and a route whose map switch is off all fail here, before anything is stored.
 */
export async function buildItemAttachment(
  db: Database,
  bucket: PhotoStore | undefined,
  userId: string,
  kind: ItemKind,
  refId: string,
  zone: DayZone,
): Promise<{ ok: true; attachment: StoredAttachment } | { ok: false; reason: AttachmentFailure }> {
  const missing = { ok: false, reason: "notFound" } as const;
  if (kind === "workout") {
    const [row] = await db
      .select()
      .from(exerciseLog)
      .where(and(eq(exerciseLog.id, refId), exerciseShareable(userId)))
      .limit(1);
    if (!row) return missing;
    const start = watchStartOf(row.externalId);
    const watch = start === null ? undefined : (await watchRowsFor(db, userId, [start])).get(start);
    return { ok: true, attachment: workoutAttachment(row, watch) };
  }
  if (kind === "food") {
    // A plate id (the whole meal) or a single food row.
    const [plateRow] = await db
      .select({ id: plate.id, name: plate.name, meal: plate.meal })
      .from(plate)
      .where(and(eq(plate.id, refId), eq(plate.userId, userId)))
      .limit(1);
    if (plateRow) {
      const rows = await db.select().from(foodLog).where(and(eq(foodLog.plateId, plateRow.id), eq(foodLog.userId, userId)));
      return rows.length > 0
        ? { ok: true, attachment: await withOwnPhotoCopy(bucket, userId, foodAttachment(rows, plateRow.name, plateRow.meal)) }
        : missing;
    }
    const [row] = await db
      .select()
      .from(foodLog)
      .where(and(eq(foodLog.id, refId), eq(foodLog.userId, userId)))
      .limit(1);
    return row ? { ok: true, attachment: await withOwnPhotoCopy(bucket, userId, foodAttachment([row], row.name, row.meal)) } : missing;
  }
  if (kind === "weight") {
    const [row] = await db
      .select()
      .from(weightLog)
      .where(and(eq(weightLog.id, refId), eq(weightLog.userId, userId)))
      .limit(1);
    const prof = await profileFor(db, userId);
    if (!row || !prof) return missing;
    return { ok: true, attachment: weightAttachment(row, weightDeltaKg(row.weightKg, prof)) };
  }
  if (kind === "recap") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(refId)) return missing;
    const loaded = await loadWeekRecap(db, userId, weekStartOf(refId), zone);
    const share = loaded ? recapShare(loaded.recap) : null;
    return share ? { ok: true, attachment: recapAttachment(share) } : missing;
  }
  // route
  if (!/^\d{9,12}$/.test(refId)) return missing;
  const start = Number(refId);
  const [row] = await db
    .select()
    .from(watchWorkout)
    .where(and(eq(watchWorkout.userId, userId), eq(watchWorkout.start, start), isNull(watchWorkout.deletedAt)))
    .limit(1);
  if (!row) return missing;
  const prof = await profileFor(db, userId);
  if (prof?.shareMaps === false) return { ok: false, reason: "mapOff" };
  const mapLine = row.hasGps ? await routeLineOf(bucket, userId, start) : null;
  return mapLine ? { ok: true, attachment: routeAttachment(row, mapLine, zone) } : { ok: false, reason: "noRoute" };
}

// --- "Dari aplikasi" picker -----------------------------------------------------------------------------------

export type Attachable = {
  kind: ItemKind;
  /** What `addComment` takes as `attachment.refId`. */
  refId: string;
  /** The owner's own diary photo id (served to the owner at /photo/{id}); null when there is none. */
  photoId: string | null;
  preview: Attachment;
};

const PICKER_LIMIT = 10;
/** This week and the three before it. */
const RECAP_PICKER_WEEKS = 4;

/** The caller's most recent items of one kind. `notice` explains an empty list the user can fix. */
export async function listAttachables(
  db: Database,
  userId: string,
  kind: ItemKind,
  zone: DayZone,
): Promise<{ items: Attachable[]; notice: "mapOff" | null }> {
  if (kind === "workout") {
    const rows = await db
      .select()
      .from(exerciseLog)
      .where(exerciseShareable(userId))
      .orderBy(desc(exerciseLog.date), desc(exerciseLog.createdAt))
      .limit(PICKER_LIMIT);
    const starts = rows.flatMap((row) => watchStartOf(row.externalId) ?? []);
    const watch = await watchRowsFor(db, userId, starts);
    return {
      notice: null,
      items: rows.map((row) => {
        const start = watchStartOf(row.externalId);
        return { kind, refId: row.id, photoId: null, preview: workoutAttachment(row, start === null ? undefined : watch.get(start)) };
      }),
    };
  }
  if (kind === "food") {
    const rows = await db
      .select()
      .from(foodLog)
      .where(eq(foodLog.userId, userId))
      .orderBy(desc(foodLog.createdAt))
      .limit(PICKER_LIMIT * 6);
    const groups = new Map<string, FoodRow[]>();
    for (const row of rows) {
      const key = row.plateId ?? row.id;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const plateIds = [...groups.keys()].slice(0, PICKER_LIMIT);
    const plates = await db
      .select({ id: plate.id, name: plate.name, meal: plate.meal })
      .from(plate)
      .where(and(eq(plate.userId, userId), inArray(plate.id, plateIds)));
    const plateById = new Map(plates.map((p) => [p.id, p]));
    return {
      notice: null,
      items: plateIds.map((refId) => {
        const group = groups.get(refId)!;
        const meta = plateById.get(refId);
        const preview = foodAttachment(group, meta?.name ?? group[0]!.name, meta?.meal ?? group[0]!.meal);
        const { photoId, ...publicPart } = preview;
        return { kind, refId, photoId: photoId ?? null, preview: publicPart };
      }),
    };
  }
  if (kind === "weight") {
    const [rows, prof] = await Promise.all([
      db.select().from(weightLog).where(eq(weightLog.userId, userId)).orderBy(desc(weightLog.date)).limit(PICKER_LIMIT),
      profileFor(db, userId),
    ]);
    if (!prof) return { items: [], notice: null };
    return {
      notice: null,
      items: rows.map((row) => ({
        kind,
        refId: row.id,
        photoId: null,
        preview: weightAttachment(row, weightDeltaKg(row.weightKg, prof)),
      })),
    };
  }
  if (kind === "recap") {
    const thisWeek = weekStartOf(jakartaToday(undefined, zone));
    const weeks = Array.from({ length: RECAP_PICKER_WEEKS }, (_, i) => shiftDate(thisWeek, -7 * i));
    const loaded = await Promise.all(weeks.map((week) => loadWeekRecap(db, userId, week, zone)));
    const items: Attachable[] = [];
    for (const entry of loaded) {
      const share = entry ? recapShare(entry.recap) : null;
      if (share) items.push({ kind, refId: share.weekStart, photoId: null, preview: recapAttachment(share) });
    }
    return { items, notice: null };
  }
  // route
  const prof = await profileFor(db, userId);
  if (prof?.shareMaps === false) return { items: [], notice: "mapOff" };
  const rows = await db
    .select()
    .from(watchWorkout)
    .where(and(eq(watchWorkout.userId, userId), isNull(watchWorkout.deletedAt), eq(watchWorkout.hasGps, true)))
    .orderBy(desc(watchWorkout.start))
    .limit(PICKER_LIMIT);
  return {
    notice: null,
    items: rows.map((row) => ({ kind, refId: String(row.start), photoId: null, preview: routeAttachment(row, null, zone) })),
  };
}

/** R2 keys of the photos attached to these comments (uploaded images, and the copies made of attached meals' photos). */
export function commentPhotoKeysOf(rows: readonly { userId: string; attachmentJson: string | null }[]): string[] {
  return rows.flatMap((row) => {
    const stored = parseStoredAttachment(row.attachmentJson);
    return stored?.photoId ? [commentPhotoKey(row.userId, stored.photoId)] : [];
  });
}
