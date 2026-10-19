import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

import type { Context } from "../context";
import { jakartaToday, shiftDate } from "../lib/engine";
import { decodePolyline } from "../lib/feed-route";
import { commentPhotoKey } from "../lib/sticker";
import type { StickersBucket } from "../lib/sticker";
import { WATCH_WORKOUT_DOC_VERSION, encodePoints } from "../lib/watch-workout";
import type { WatchPoint, WatchWorkoutDoc } from "../lib/watch-workout";
import { putWorkout } from "../lib/watch-workout-store";
import { socialRouter } from "./social";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}

// own: author of the posts. ann/bob/cat commenters; mate shares a team with own. gone: no profile row use.
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier) VALUES
    ('own', 'Owner', 'own@test.id', 'free'),
    ('ann', 'Ann', 'ann@test.id', 'free'),
    ('bob', 'Bob', 'bob@test.id', 'free'),
    ('cat', 'Cat', 'cat@test.id', 'free'),
    ('nomap', 'No Map', 'nomap@test.id', 'free');
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level, handle, share_maps)
    VALUES
    ('own', 1990, 'male', 170, 80, 72, '2030-01-01', 'light', 'owner', 1),
    ('ann', 1990, 'female', 160, 70, 62, '2030-01-01', 'light', 'ann_k', 1),
    ('bob', 1990, 'male', 175, 90, 80, '2030-01-01', 'light', 'bob_b', 1),
    ('cat', 1990, 'female', 165, 65, 60, '2030-01-01', 'light', 'cat_c', 1),
    ('nomap', 1990, 'male', 170, 80, 72, '2030-01-01', 'light', 'nomap_x', 0);
  INSERT INTO post (id, user_id, kind, title, visibility) VALUES
    ('11111111-1111-1111-1111-111111111111', 'own', 'cerita', 'Halo', 'publik'),
    ('22222222-2222-2222-2222-222222222222', 'own', 'cerita', 'Halo lagi', 'publik');
`);

const POST = "11111111-1111-1111-1111-111111111111";
const POST2 = "22222222-2222-2222-2222-222222222222";

const db = drizzle(client) as unknown as Database;

function fakeBucket() {
  const objects = new Map<string, { bytes: ArrayBuffer; type: string | undefined }>();
  const bucket: StickersBucket = {
    async put(key, value, options) {
      objects.set(key, { bytes: value as ArrayBuffer, type: options?.httpMetadata?.contentType });
    },
    async get(key) {
      const found = objects.get(key);
      return found
        ? { body: new Blob([found.bytes]).stream(), size: found.bytes.byteLength, arrayBuffer: async () => found.bytes }
        : null;
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
    async list({ prefix }) {
      return { objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false };
    },
  };
  return { bucket, objects };
}

const { bucket, objects } = fakeBucket();
const waiting: Promise<unknown>[] = [];
const as = (userId: string) => ({
  context: {
    db,
    env: { STICKERS: bucket },
    locale: "id",
    waitUntil: (promise: Promise<unknown>) => waiting.push(promise),
    session: { user: { id: userId } },
  } as unknown as Context,
});
const anon = { context: { db, env: { STICKERS: bucket }, locale: "id", waitUntil: () => {} } as unknown as Context };
const settle = () => Promise.all(waiting.splice(0));

const add = (user: string, input: { postId?: string; body?: string; parentId?: string; attachment?: unknown }) =>
  call(socialRouter.addComment, { postId: POST, ...input } as never, as(user));
const top = (viewer: string | null, postId = POST) =>
  call(socialRouter.comments, { postId }, viewer ? as(viewer) : anon);
const replies = (viewer: string | null, parentId: string, extra: { cursor?: number; limit?: number } = {}) =>
  call(socialRouter.commentReplies, { parentId, ...extra }, viewer ? as(viewer) : anon);
const del = (user: string, id: string) => call(socialRouter.deleteComment, { id }, as(user));
const rejects = async (promise: Promise<unknown>, code: string) => {
  const error = (await promise.then(
    () => null,
    (e: unknown) => e,
  )) as { code?: string } | null;
  expect(error?.code).toBe(code);
};

async function count(table: string, where = "1=1") {
  const result = await client.execute(`SELECT count(*) AS n FROM ${table} WHERE ${where}`);
  return Number(result.rows[0]?.n);
}

describe("threading", () => {
  test("replies nest one level: a reply to a reply flattens under the top-level comment and names who was answered", async () => {
    const a = await add("ann", { body: "komentar pertama" });
    expect(a.parentId).toBeNull();
    const b = await add("bob", { body: "balasan bob", parentId: a.id });
    expect(b.parentId).toBe(a.id);
    expect(b.comment.replyTo).toBeNull();
    const c = await add("cat", { body: "balas bob", parentId: b.id });
    expect(c.parentId).toBe(a.id);
    expect(c.comment.replyTo).toEqual({ id: "bob", name: "Bob", handle: "bob_b" });
    const self = await add("cat", { body: "tambahan", parentId: c.id });
    expect(self.comment.replyTo).toBeNull();

    const list = await top("cat");
    const mine = list.items.find((item) => item.id === a.id)!;
    expect(mine.replyCount).toBe(3);
    expect(mine.parentId).toBeNull();
    expect(list.items.every((item) => item.parentId === null)).toBe(true);

    const thread = await replies("cat", a.id);
    expect(thread.items.map((item) => item.id)).toEqual([b.id, c.id, self.id]);
    expect(thread.items.every((item) => item.parentId === a.id)).toBe(true);
    // The id of a reply resolves to its thread.
    expect((await replies("cat", c.id)).items.map((item) => item.id)).toEqual([b.id, c.id, self.id]);
  });

  test("a comment id from another post, or a missing one, cannot be replied to", async () => {
    const a = await add("ann", { body: "di post satu" });
    await rejects(add("bob", { postId: POST2, body: "salah post", parentId: a.id }), "NOT_FOUND");
    await rejects(add("bob", { body: "hantu", parentId: "nope" }), "NOT_FOUND");
  });

  test("replies page through a cursor, oldest first", async () => {
    const a = await add("ann", { body: "banyak balasan" });
    const base = Date.now() + 10_000;
    for (let i = 0; i < 5; i++) {
      await client.execute({
        sql: "INSERT INTO post_comment (id, post_id, user_id, body, parent_id, created_at) VALUES (?, ?, 'bob', ?, ?, ?)",
        args: [`page-${a.id}-${i}`, POST, `r${i}`, a.id, base + i * 1000],
      });
    }
    const first = await replies("cat", a.id, { limit: 2 });
    expect(first.items.map((item) => item.body)).toEqual(["r0", "r1"]);
    expect(first.nextCursor).not.toBeNull();
    const second = await replies("cat", a.id, { limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((item) => item.body)).toEqual(["r2", "r3"]);
    const last = await replies("cat", a.id, { limit: 2, cursor: second.nextCursor! });
    expect(last.items.map((item) => item.body)).toEqual(["r4"]);
    expect(last.nextCursor).toBeNull();
  });

  test("a blocked user's replies are hidden from the count and from the thread", async () => {
    const a = await add("ann", { body: "blok test" });
    await add("bob", { body: "dari bob", parentId: a.id });
    await add("cat", { body: "dari cat", parentId: a.id });
    await client.execute("INSERT INTO social_block (blocker_id, blocked_id) VALUES ('ann', 'bob')");
    const seen = (await replies("ann", a.id)).items.map((item) => item.body);
    expect(seen).toEqual(["dari cat"]);
    expect((await top("ann")).items.find((item) => item.id === a.id)?.replyCount).toBe(1);
    await rejects(add("ann", { body: "balas bob", parentId: (await replies("cat", a.id)).items[0]!.id }), "NOT_FOUND");
    await client.execute("DELETE FROM social_block");
  });

  test("the daily quota counts replies too", async () => {
    await client.execute("DELETE FROM post_comment WHERE user_id = 'nomap'");
    const root = await add("ann", { body: "kuota" });
    for (let i = 0; i < 30; i++) await add("nomap", { body: `r${i}`, parentId: root.id });
    await rejects(add("nomap", { body: "ke-31", parentId: root.id }), "BAD_REQUEST");
    await client.execute("DELETE FROM post_comment WHERE user_id = 'nomap'");
  });
});

describe("deletion", () => {
  test("a comment with replies is hidden, not removed; its replies stay", async () => {
    const a = await add("ann", { body: "akan dihapus" });
    const b = await add("bob", { body: "balasan", parentId: a.id });
    expect(await del("ann", a.id)).toEqual({ ok: true, mode: "hidden" });

    const shown = (await top("cat")).items.find((item) => item.id === a.id)!;
    expect(shown.deleted).toBe(true);
    expect(shown.body).toBe("Komentar ini dihapus.");
    expect(shown.author).toEqual({ id: "", name: "", handle: null, image: null });
    expect(shown.attachment).toBeNull();
    expect(shown.replyCount).toBe(1);
    expect((await replies("cat", a.id)).items.map((item) => item.id)).toEqual([b.id]);
    // The original text is gone from the database, not just hidden.
    expect(await count("post_comment", `id = '${a.id}' AND body = '' AND deleted_at IS NOT NULL`)).toBe(1);
    await rejects(add("cat", { body: "balas yang dihapus", parentId: a.id }), "NOT_FOUND");
    // Deleting it again is a no-op.
    expect(await del("ann", a.id)).toEqual({ ok: true, mode: "removed" });

    // The last reply going away takes the placeholder with it.
    expect(await del("bob", b.id)).toEqual({ ok: true, mode: "removed" });
    expect(await count("post_comment", `id = '${a.id}'`)).toBe(0);
  });

  test("a comment without replies is removed; hiding does not count the feed's commentCount", async () => {
    const before = (await call(socialRouter.post, { id: POST } as never, as("cat")).catch(() => null)) as { commentCount: number } | null;
    const a = await add("ann", { body: "sebentar" });
    expect(await del("ann", a.id)).toEqual({ ok: true, mode: "removed" });
    expect(await count("post_comment", `id = '${a.id}'`)).toBe(0);
    if (before) {
      const after = (await call(socialRouter.post, { id: POST } as never, as("cat"))) as { commentCount: number };
      expect(after.commentCount).toBe(before.commentCount);
    }
  });

  test("only the author, or the post's owner, may delete", async () => {
    const a = await add("ann", { body: "milik ann" });
    await rejects(del("bob", a.id), "FORBIDDEN");
    expect((await del("own", a.id)).ok).toBe(true);
  });

  test("hidden comments leave the feed's comment count", async () => {
    await client.execute("DELETE FROM post_comment WHERE post_id = '" + POST2 + "'");
    const a = await add("ann", { postId: POST2, body: "satu" });
    await add("bob", { postId: POST2, body: "dua", parentId: a.id });
    const detail = async () => (await call(socialRouter.post, { id: POST2 } as never, as("cat"))) as { commentCount: number };
    expect((await detail()).commentCount).toBe(2);
    await del("ann", a.id);
    expect((await detail()).commentCount).toBe(1);
  });
});

describe("notifications", () => {
  test("the answered person gets a reply, the post owner a comment, and nobody twice", async () => {
    await client.execute("DELETE FROM social_notification");
    const a = await add("ann", { body: "notif" });
    expect(await count("social_notification", "user_id = 'own' AND kind = 'comment'")).toBe(1);

    await add("bob", { body: "balas ann", parentId: a.id });
    expect(await count("social_notification", "user_id = 'ann' AND kind = 'reply' AND actor_id = 'bob'")).toBe(1);
    expect(await count("social_notification", "user_id = 'own' AND kind = 'comment' AND actor_id = 'bob'")).toBe(1);

    // The post owner answering a comment gets no notification for themselves, the commenter gets a reply.
    await add("own", { body: "terima kasih", parentId: a.id });
    expect(await count("social_notification", "user_id = 'ann' AND kind = 'reply' AND actor_id = 'own'")).toBe(1);
    expect(await count("social_notification", "user_id = 'own' AND actor_id = 'own'")).toBe(0);

    // Answering the owner's own comment: one reply notification, not a reply plus a comment.
    const owned = await add("own", { body: "komentar owner" });
    await add("cat", { body: "balas owner", parentId: owned.id });
    expect(await count("social_notification", "user_id = 'own' AND actor_id = 'cat' AND kind = 'reply'")).toBe(1);
    expect(await count("social_notification", "user_id = 'own' AND actor_id = 'cat' AND kind = 'comment'")).toBe(0);

    const list = await call(socialRouter.notifications, { limit: 50 }, as("ann"));
    expect(list.items.some((item) => item.kind === "reply")).toBe(true);
  });
});

describe("compat with clients that only know text comments", () => {
  test("old call shape still works and the answer keeps every old field", async () => {
    const made = await call(socialRouter.addComment, { postId: POST, body: "  halo lama  " }, as("ann"));
    expect(typeof made.id).toBe("string");
    const item = (await top("cat")).items.find((it) => it.id === made.id)!;
    expect(item.body).toBe("halo lama");
    expect(Object.keys(item)).toEqual(expect.arrayContaining(["id", "body", "createdAt", "author"]));
    expect(item.author).toEqual({ id: "ann", name: "Ann", handle: "ann_k", image: null });
    expect(item.createdAt).toBeInstanceOf(Date);
  });

  test("an empty comment with nothing attached is refused", async () => {
    await rejects(add("ann", { body: "   " }), "BAD_REQUEST");
  });

  test("anonymous viewers read public posts; a team-only post stays closed to them", async () => {
    expect((await top(null)).items.length).toBeGreaterThan(0);
    await client.execute(
      "INSERT INTO post (id, user_id, kind, title, visibility) VALUES ('33333333-3333-3333-3333-333333333333', 'own', 'cerita', 'tertutup', 'grup')",
    );
    await rejects(top(null, "33333333-3333-3333-3333-333333333333"), "NOT_FOUND");
  });
});

// A tiny valid-looking JPEG whose EXIF block carries a GPS marker.
const exifJpeg = (() => {
  const seg = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
  const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
  return Uint8Array.from([
    0xff, 0xd8,
    ...seg(0xe0, ascii("JFIF\0\x01\x01")),
    ...seg(0xe1, ascii("Exif\0\0GPS-LAT-7.98-LON-112.63")),
    ...seg(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]),
    0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22, 0xff, 0xd9,
  ]);
})();
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

describe("photo attachments", () => {
  test("upload strips metadata, attach once, only the uploader can attach it, delete removes the object", async () => {
    const { photoId } = await call(socialRouter.uploadCommentPhoto, { imageBase64: b64(exifJpeg), mimeType: "image/jpeg" }, as("ann"));
    const stored = objects.get(commentPhotoKey("ann", photoId))!;
    expect(stored.type).toBe("image/jpeg");
    const text = Buffer.from(stored.bytes).toString("latin1");
    expect(text).not.toContain("GPS-LAT");
    expect(text).toContain("JFIF");

    await rejects(add("bob", { body: "curi foto", attachment: { kind: "image", photoId } }), "BAD_REQUEST");
    const made = await add("ann", { body: "foto", attachment: { kind: "image", photoId } });
    expect(made.comment.attachment).toEqual({ kind: "image", title: "", date: null, mapLine: null, hasPhoto: true, stats: {} });
    expect(JSON.stringify(made.comment)).not.toContain(photoId);
    await rejects(add("ann", { body: "lagi", attachment: { kind: "image", photoId } }), "BAD_REQUEST");

    const photoOnly = await add("ann", { attachment: { kind: "image", photoId: "0".repeat(32) } }).catch((e: { code?: string }) => e.code);
    expect(photoOnly).toBe("BAD_REQUEST");

    await del("ann", made.id);
    await settle();
    expect(objects.has(commentPhotoKey("ann", photoId))).toBe(false);
  });

  test("bytes that are not the declared image are refused and nothing is stored", async () => {
    const before = objects.size;
    await rejects(
      call(socialRouter.uploadCommentPhoto, { imageBase64: b64(new TextEncoder().encode("<html>not an image at all, long enough to pass</html>")), mimeType: "image/jpeg" }, as("ann")),
      "BAD_REQUEST",
    );
    await rejects(call(socialRouter.uploadCommentPhoto, { imageBase64: b64(exifJpeg), mimeType: "image/webp" }, as("ann")), "BAD_REQUEST");
    expect(objects.size).toBe(before);
  });

  test("deleting a post removes the photos on its comments", async () => {
    await client.execute("INSERT INTO post (id, user_id, kind, title, visibility) VALUES ('44444444-4444-4444-4444-444444444444', 'own', 'cerita', 'x', 'publik')");
    const { photoId } = await call(socialRouter.uploadCommentPhoto, { imageBase64: b64(exifJpeg), mimeType: "image/jpeg" }, as("bob"));
    await add("bob", { postId: "44444444-4444-4444-4444-444444444444", attachment: { kind: "image", photoId } });
    expect(objects.has(commentPhotoKey("bob", photoId))).toBe(true);
    await call(socialRouter.deletePost, { id: "44444444-4444-4444-4444-444444444444" }, as("own"));
    await settle();
    expect(objects.has(commentPhotoKey("bob", photoId))).toBe(false);
  });
});

const today = jakartaToday();
const START = Math.floor(Date.now() / 1000) - 86_400;

function track(): WatchPoint[] {
  return Array.from({ length: 400 }, (_, i) => ({
    ts: START + i * 5,
    lat: -7.98 + i * 0.00009,
    lon: 112.63 + i * 0.00004,
    alt: 450,
    hr: 140,
    speed: 2.5,
    cadence: 160,
    stride: 1,
    power: null,
  }));
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("app item attachments", () => {
  test("seed", async () => {
    await client.executeMultiple(`
      INSERT INTO exercise_log (id, user_id, date, type, name, duration_min, kcal, source) VALUES
        ('ex-ann', 'ann', '${today}', 'running', 'Lari pagi', 32, 310, 'manual'),
        ('ex-strava', 'ann', '${today}', 'running', 'Dari Strava', 40, 400, 'strava'),
        ('ex-bob', 'bob', '${today}', 'running', 'Lari bob', 20, 200, 'manual');
      INSERT INTO weight_log (id, user_id, date, weight_kg) VALUES ('w-ann', 'ann', '${today}', 68.4), ('w-bob', 'bob', '${today}', 88);
      INSERT INTO plate (id, user_id, date, meal, name, place, lat, lng) VALUES ('pl-ann', 'ann', '${today}', 'makan_siang', 'Nasi pecel', 'Warung Bu Tini', -7.984, 112.63);
      INSERT INTO food_log (id, user_id, date, meal, name, kcal, protein, carbs, fat, plate_id, photo_id) VALUES
        ('food-1', 'ann', '${today}', 'makan_siang', 'Nasi', 200, 4, 44, 1, 'pl-ann', 'abcdef'),
        ('food-2', 'ann', '${today}', 'makan_siang', 'Tempe', 150, 12, 8, 7, 'pl-ann', 'abcdef'),
        ('food-3', 'bob', '${today}', 'sarapan', 'Roti', 120, 3, 20, 2, NULL, NULL);
      INSERT INTO food_log (id, user_id, date, meal, name, kcal, protein) VALUES
        ('yesterday-ann', 'ann', '${shiftDate(today, -1)}', 'sarapan', 'Bubur', 1800, 70);
    `);
    const gz = await gzip(
      JSON.stringify({
        v: WATCH_WORKOUT_DOC_VERSION,
        engineRev: 2,
        workout: {
          workoutNumber: 1, start: START, end: START + 2000, sportType: 1, sportName: "Lari", duration: 1990, distance: 4200,
          calories: 300, avgHr: 140, maxHr: 160, steps: 5000, complete: true, imported: false, summaryJson: "{}",
        },
        points: encodePoints(track()),
        analysis: null,
      } satisfies Omit<WatchWorkoutDoc, "analysis"> & { analysis: null }),
    );
    // The diary original of ann's plate, as the phone sent it: EXIF with a GPS marker, and bytes after the picture.
    await bucket.put("photos/ann/abcdef.jpg", Uint8Array.from([...exifJpeg, ...new TextEncoder().encode("TRAILING-PAYLOAD")]).buffer, {
      httpMetadata: { contentType: "image/jpeg" },
    });
    await putWorkout(db, bucket, "ann", START, gz);
    await putWorkout(db, bucket, "nomap", START, gz);
  });

  const attach = (user: string, kind: string, refId: string) => add(user, { attachment: { kind, refId } });

  test("only the commenter's own items can be attached; Strava and someone else's rows are refused", async () => {
    await rejects(attach("ann", "workout", "ex-bob"), "NOT_FOUND");
    await rejects(attach("ann", "workout", "ex-strava"), "NOT_FOUND");
    await rejects(attach("ann", "weight", "w-bob"), "NOT_FOUND");
    await rejects(attach("ann", "food", "food-3"), "NOT_FOUND");
    await rejects(attach("ann", "food", "nope"), "NOT_FOUND");
    await rejects(attach("bob", "route", String(START)), "NOT_FOUND");
    await rejects(attach("ann", "recap", "bukan-tanggal"), "NOT_FOUND");
  });

  test("workout, weight and meal previews carry numbers, not source ids or places", async () => {
    const workout = await attach("ann", "workout", "ex-ann");
    expect(workout.comment.attachment).toMatchObject({
      kind: "workout",
      title: "Lari pagi",
      date: today,
      hasPhoto: false,
      stats: { durationMin: 32, kcal: 310, sportKind: "run" },
    });

    const weight = await attach("ann", "weight", "w-ann");
    expect(weight.comment.attachment?.stats).toEqual({ weightKg: 68.4, deltaKg: -1.6 });

    const plate = await attach("ann", "food", "pl-ann");
    expect(plate.comment.attachment).toMatchObject({
      kind: "food",
      title: "Nasi pecel",
      hasPhoto: true,
      stats: { kcal: 350, protein: 16, carbs: 52, fat: 8, meal: "makan_siang", items: 2 },
    });
    const single = await attach("ann", "food", "food-1");
    expect(single.comment.attachment?.stats).toMatchObject({ kcal: 200, items: 1 });

    for (const made of [workout, weight, plate, single]) {
      const json = JSON.stringify(made.comment);
      for (const secret of ["ex-ann", "w-ann", "pl-ann", "food-1", "abcdef", "Warung Bu Tini", "-7.984", "112.63"]) {
        expect(json).not.toContain(secret);
      }
    }
    // What viewers read back is the same snapshot, and it survives the source row changing.
    await client.execute("UPDATE weight_log SET weight_kg = 60 WHERE id = 'w-ann'");
    const read = (await top("cat")).items.find((item) => item.id === weight.id)!;
    expect(read.attachment?.stats).toEqual({ weightKg: 68.4, deltaKg: -1.6 });
  });

  test("an attached meal's photo is a metadata-free copy; the private diary original is never referenced or served", async () => {
    const made = await attach("ann", "food", "pl-ann");
    expect(made.comment.attachment?.hasPhoto).toBe(true);
    const row = await client.execute({ sql: "SELECT attachment_json FROM post_comment WHERE id = ?", args: [made.id] });
    const stored = JSON.parse(String(row.rows[0]!.attachment_json)) as { photoId: string };
    expect(stored.photoId).not.toBe("abcdef");
    const copy = objects.get(commentPhotoKey("ann", stored.photoId))!;
    const text = Buffer.from(copy.bytes).toString("latin1");
    expect(text).not.toContain("GPS-LAT");
    expect(text).not.toContain("TRAILING-PAYLOAD");
    expect(text).toContain("JFIF");
    // Removing the comment removes the copy, not the diary photo.
    await del("ann", made.id);
    await settle();
    expect(objects.has(commentPhotoKey("ann", stored.photoId))).toBe(false);
    expect(objects.has("photos/ann/abcdef.jpg")).toBe(true);
  });

  test("a meal whose photo cannot be cleaned is attached without it", async () => {
    await client.executeMultiple(`
      INSERT INTO plate (id, user_id, date, meal, name) VALUES ('pl-png', 'ann', '${today}', 'sarapan', 'Bubur');
      INSERT INTO food_log (id, user_id, date, meal, name, kcal, plate_id, photo_id) VALUES ('food-png', 'ann', '${today}', 'sarapan', 'Bubur', 300, 'pl-png', 'pngpng');
    `);
    await bucket.put("photos/ann/pngpng.jpg", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]).buffer);
    const made = await attach("ann", "food", "pl-png");
    expect(made.comment.attachment?.hasPhoto).toBe(false);
    expect(made.comment.attachment?.stats.kcal).toBe(300);
  });

  test("a recap needs a logged week", async () => {
    const week = (d: string) => {
      const weekday = new Date(`${d}T00:00:00Z`).getUTCDay();
      return shiftDate(d, -((weekday + 6) % 7));
    };
    const made = await attach("ann", "recap", shiftDate(today, -1));
    expect(made.comment.attachment?.kind).toBe("recap");
    expect(made.comment.attachment?.stats).toMatchObject({ weekStart: week(shiftDate(today, -1)) });
    expect(made.comment.attachment?.stats.avgKcal).not.toBeNull();
    await rejects(attach("cat", "recap", today), "NOT_FOUND");
  });

  test("a route shares only the trimmed map line, and only when the account's map switch is on", async () => {
    const made = await attach("ann", "route", String(START));
    const attachment = made.comment.attachment!;
    expect(attachment.kind).toBe("route");
    expect(attachment.title).toBe("Lari");
    const line = decodePolyline(attachment.mapLine!);
    expect(line.length).toBeGreaterThanOrEqual(2);
    // The first and last 200 m of the 400-point track are cut off.
    expect(line[0]![0]).toBeGreaterThan(-7.98 + 0.00009 * 3);
    expect(JSON.stringify(made.comment)).not.toContain(String(START));
    await rejects(attach("nomap", "route", String(START)), "NOT_FOUND");
    const picker = await call(socialRouter.commentAttachables, { kind: "route" }, as("nomap"));
    expect(picker).toEqual({ items: [], notice: "mapOff" });
  });

  test("the picker lists only the caller's own items, newest first, with a refId addComment accepts", async () => {
    const workouts = await call(socialRouter.commentAttachables, { kind: "workout" }, as("ann"));
    expect(workouts.items.map((item) => item.refId)).toEqual(["ex-ann"]);
    const food = await call(socialRouter.commentAttachables, { kind: "food" }, as("ann"));
    expect(food.items.map((item) => item.refId)).toContain("pl-ann");
    expect(food.items.find((item) => item.refId === "pl-ann")?.photoId).toBe("abcdef");
    expect(JSON.stringify(food.items)).not.toContain("Roti");
    const weights = await call(socialRouter.commentAttachables, { kind: "weight" }, as("ann"));
    expect(weights.items.map((item) => item.refId)).toEqual(["w-ann"]);
    const routes = await call(socialRouter.commentAttachables, { kind: "route" }, as("ann"));
    expect(routes.items.map((item) => item.refId)).toEqual([String(START)]);
    const recaps = await call(socialRouter.commentAttachables, { kind: "recap" }, as("ann"));
    expect(recaps.items.length).toBeGreaterThan(0);
    for (const kind of ["workout", "food", "weight", "route", "recap"] as const) {
      for (const item of (await call(socialRouter.commentAttachables, { kind }, as("ann"))).items) {
        await add("ann", { attachment: { kind: item.kind, refId: item.refId } });
      }
    }
    expect((await call(socialRouter.commentAttachables, { kind: "workout" }, as("cat"))).items).toEqual([]);
  });

  test("an attachment alone is a valid comment and its reply notification has no text excerpt", async () => {
    await client.execute("DELETE FROM social_notification");
    const a = await add("bob", { body: "tanya" });
    await add("ann", { parentId: a.id, attachment: { kind: "workout", refId: "ex-ann" } });
    const note = (await call(socialRouter.notifications, { limit: 5 }, as("bob"))).items.find((item) => item.kind === "reply");
    expect(note?.excerpt).toBeNull();
  });
});
