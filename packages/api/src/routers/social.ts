import { ORPCError } from "@orpc/server";
import {
  and, asc, count, desc, eq, gt, inArray, isNull, lt, ne, or, sql,
} from "drizzle-orm";
import { z } from "zod";

import { user } from "@joyorogo/db/schema/auth";
import type { Database } from "@joyorogo/db";
import type { TFunction } from "@joyorogo/i18n";
import {
  exerciseLog,
  foodLog,
  profile as profileTable,
  weightLog,
} from "@joyorogo/db/schema/fitness";
import { pushSubscription, workoutSession, workoutSet } from "@joyorogo/db/schema/plans";
import {
  post as postTable,
  postComment,
  postKudos,
  socialBlock,
  socialFollow,
  socialNotification,
  socialReport,
} from "@joyorogo/db/schema/social";

import { publicProcedure, protectedProcedure } from "../index";
import { jakartaToday } from "../lib/engine";
import { base64ToBytes } from "../lib/sticker";
import { serverT, userLocale } from "../lib/messages";
import { sendPush } from "../lib/webpush";

// --- Batasan -----------------------------------------------------------------

const STORY_MAX = 1000;
const STORY_PHOTOS_MAX = 4;
const COMMENT_MAX = 280;
const BIO_MAX = 160;
const NOTE_MAX = 200;
const MAX_POSTS_PER_DAY = 20;
const MAX_COMMENTS_PER_DAY = 30;
const MAX_REPORTS_PER_DAY = 10;
const MAX_FOLLOWING = 2000;
const PAGE_SIZE = 10;
const KUDOS_PUSH_WINDOW_MS = 60 * 60 * 1000;

// --- Skema input --------------------------------------------------------------

const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/);

const visibilitySchema = z.enum(["publik", "grup"]);

const cursorSchema = z.number().int().positive().optional();

// --- Helper visibility & blokir ------------------------------------------------

/** Rekan satu tim dengan `userId` (untuk postingan visibility 'grup'). */
const sameTeamSql = (userId: unknown) =>
  sql`EXISTS (SELECT 1 FROM team_member tm1 JOIN team_member tm2 ON tm1.team_id = tm2.team_id
    WHERE tm1.user_id = ${userId} AND tm2.user_id = ${postTable.userId})`;

/** `me` saling memblokir dengan penulis postingan. */
const blockedSql = (me: string) =>
  sql`NOT EXISTS (SELECT 1 FROM social_block b WHERE
    (b.blocker_id = ${me} AND b.blocked_id = ${postTable.userId}) OR
    (b.blocker_id = ${postTable.userId} AND b.blocked_id = ${me}))`;

const blockedBetweenSql = (me: string, other: unknown) =>
  sql`NOT EXISTS (SELECT 1 FROM social_block b WHERE
    (b.blocker_id = ${me} AND b.blocked_id = ${other}) OR
    (b.blocker_id = ${other} AND b.blocked_id = ${me}))`;

const followedSql = (me: string) =>
  sql`EXISTS (SELECT 1 FROM social_follow f WHERE f.follower_id = ${me} AND f.following_id = ${postTable.userId})`;

/** `me` berbagi tim dengan `other`. */
async function sharesTeam(db: Database, me: string, other: string): Promise<boolean> {
  const [row] = await db
    .select({ total: count() })
    .from(sql`team_member tm1`)
    .innerJoin(sql`team_member tm2`, sql`tm1.team_id = tm2.team_id`)
    .where(sql`tm1.user_id = ${me} AND tm2.user_id = ${other}`);
  return (row?.total ?? 0) > 0;
}

/** True kalau `viewer` (boleh null untuk anon) boleh melihat `row` postingan. */
async function canViewPost(
  db: Database,
  row: { userId: string; visibility: "publik" | "grup" },
  authorPublicProfile: boolean,
  viewerId: string | null,
): Promise<boolean> {
  if (viewerId === row.userId) return true;
  if (viewerId) {
    const blocked = await db
      .select({ total: count() })
      .from(socialBlock)
      .where(
        or(
          and(eq(socialBlock.blockerId, viewerId), eq(socialBlock.blockedId, row.userId)),
          and(eq(socialBlock.blockerId, row.userId), eq(socialBlock.blockedId, viewerId)),
        ),
      );
    if ((blocked[0]?.total ?? 0) > 0) return false;
  }
  if (row.visibility === "publik") return authorPublicProfile;
  if (!viewerId) return false;
  return sharesTeam(db, viewerId, row.userId);
}

/** Muat satu postingan + status publik penulis; lempar NOT_FOUND kalau tersembunyi. */
async function loadVisiblePost(
  db: Database,
  postId: string,
  viewerId: string | null,
  t: TFunction<"feed">,
) {
  const [row] = await db
    .select({
      id: postTable.id,
      userId: postTable.userId,
      kind: postTable.kind,
      title: postTable.title,
      kcal: postTable.kcal,
      durationMin: postTable.durationMin,
      photoId: postTable.photoId,
      scanId: postTable.scanId,
      macroJson: postTable.macroJson,
      photosJson: postTable.photosJson,
      statsJson: postTable.statsJson,
      caption: postTable.caption,
      visibility: postTable.visibility,
      createdAt: postTable.createdAt,
      authorName: user.name,
      authorImage: user.image,
      authorHandle: profileTable.handle,
      authorPublic: profileTable.publicProfile,
    })
    .from(postTable)
    .innerJoin(user, eq(user.id, postTable.userId))
    .leftJoin(profileTable, eq(profileTable.userId, postTable.userId))
    .where(eq(postTable.id, postId))
    .limit(1);
  if (!row) throw new ORPCError("NOT_FOUND", { message: t("server.error.postNotFound") });
  const visible = await canViewPost(db, row, row.authorPublic ?? true, viewerId);
  if (!visible) throw new ORPCError("NOT_FOUND", { message: t("server.error.postNotFound") });
  return row;
}

// --- Helper identitas -----------------------------------------------------------

async function handleTaken(db: Database, handle: string): Promise<boolean> {
  const [row] = await db
    .select({ total: count() })
    .from(profileTable)
    .where(eq(profileTable.handle, handle));
  return (row?.total ?? 0) > 0;
}

/**
 * Handle diisi otomatis saat pertama dibutuhkan (dari slug nama), dengan
 * angka/huruf acak sebagai pencegah tabrakan. Unik di level indeks.
 */
async function ensureHandle(db: Database, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ handle: profileTable.handle, name: user.name })
    .from(profileTable)
    .innerJoin(user, eq(user.id, profileTable.userId))
    .where(eq(profileTable.userId, userId))
    .limit(1);
  if (!row) return null;
  if (row.handle) return row.handle;
  const base =
    row.name
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 15) || "pengguna";
  for (let attempt = 0; attempt < 60; attempt++) {
    const candidate =
      attempt === 0
        ? base
        : attempt < 50
          ? `${base}${attempt + 1}`
          : `${base}_${Math.random().toString(36).slice(2, 6)}`;
    if (await handleTaken(db, candidate)) continue;
    try {
      await db.update(profileTable).set({ handle: candidate }).where(eq(profileTable.userId, userId));
      return candidate;
    } catch {
      // kalah race; coba kandidat lain
    }
  }
  return null;
}

// --- Push & notifikasi ------------------------------------------------------------

/** Fire-and-forget Web Push; endpoint mati (404/410) langsung dihapus. */
function pushFeed(
  context: {
    db: Database;
    env: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string };
    waitUntil: (promise: Promise<unknown>) => void;
  },
  toUserId: string,
  /** Written in the RECIPIENT's language, not the actor's. */
  payload: (t: TFunction<"feed">) => { title: string; body: string },
) {
  context.waitUntil(
    (async () => {
      const subs = await context.db
        .select()
        .from(pushSubscription)
        .where(eq(pushSubscription.userId, toUserId));
      if (subs.length === 0) return;
      const message = payload(serverT(await userLocale(context.db, toUserId), "feed"));
      await Promise.all(
        subs.map(async (sub) => {
          const result = await sendPush(context.env, sub, message);
          if (result.status === 404 || result.status === 410) {
            await context.db.delete(pushSubscription).where(eq(pushSubscription.id, sub.id));
          }
        }),
      );
    })().catch(() => {}),
  );
}

type NotifyContext = Parameters<typeof pushFeed>[0] & { db: Database };

/**
 * Satu notifikasi per (aktor, postingan, jenis) untuk kudos: kudos ulang
 * menandai belum dibaca lagi tanpa menumpuk baris. Push hanya kalau kudos
 * sebelumnya dari aktor yang sama sudah lebih satu jam (anti spam toggle).
 */
async function notifyKudos(
  context: NotifyContext,
  postId: string,
  postTitle: string,
  authorId: string,
  actorId: string,
  actorName: string,
) {
  const [existing] = await context.db
    .select({ id: socialNotification.id, createdAt: socialNotification.createdAt })
    .from(socialNotification)
    .where(
      and(
        eq(socialNotification.postId, postId),
        eq(socialNotification.actorId, actorId),
        eq(socialNotification.kind, "kudos"),
      ),
    )
    .limit(1);
  const shouldPush = !existing || Date.now() - existing.createdAt.getTime() >= KUDOS_PUSH_WINDOW_MS;
  if (existing) {
    await context.db
      .update(socialNotification)
      .set({ createdAt: new Date(), readAt: null })
      .where(eq(socialNotification.id, existing.id));
  } else {
    await context.db.insert(socialNotification).values({
      id: crypto.randomUUID(),
      userId: authorId,
      actorId,
      kind: "kudos",
      postId,
    });
  }
  if (shouldPush) {
    pushFeed(context, authorId, (t) => ({
      title: t("server.push.kudos", { name: actorName }),
      body: postTitle,
    }));
  }
}

async function notifyComment(
  context: NotifyContext,
  postId: string,
  authorId: string,
  actorId: string,
  actorName: string,
  body: string,
) {
  await context.db.insert(socialNotification).values({
    id: crypto.randomUUID(),
    userId: authorId,
    actorId,
    kind: "comment",
    postId,
    excerpt: body.slice(0, 120),
  });
  pushFeed(context, authorId, (t) => ({
    title: t("server.push.comment", { name: actorName }),
    body: body.slice(0, 120),
  }));
}

// --- Mapping baris → output --------------------------------------------------------

export type PostSnapshot = {
  macros?: { protein: number | null; carbs: number | null; fat: number | null; fiber: number | null };
  stats?: Record<string, number | string | null>;
};

/** JSON string array (foto pos 'cerita');[] kalau rusak/kosong. */
function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function parseJson(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function toFeedItem(row: {
  id: string;
  userId: string;
  kind: "makan" | "latihan" | "berat" | "cerita";
  title: string;
  kcal: number | null;
  durationMin: number | null;
  photoId: string | null;
  scanId: string | null;
  macroJson: string | null;
  photosJson: string | null;
  statsJson: string | null;
  caption: string | null;
  visibility: "publik" | "grup";
  createdAt: Date;
  authorId: string;
  authorName: string;
  authorImage: string | null;
  authorHandle: string | null;
  kudosCount: number;
  commentCount: number;
  kudosByMe?: boolean;
}) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    kcal: row.kcal,
    durationMin: row.durationMin,
    photoId: row.photoId,
    scanId: row.scanId,
    macros: parseJson(row.macroJson) as PostSnapshot["macros"],
    stats: parseJson(row.statsJson) as PostSnapshot["stats"],
    photoCount: parseStringArray(row.photosJson).length || (row.photoId ? 1 : 0),
    caption: row.caption,
    visibility: row.visibility,
    createdAt: row.createdAt,
    author: {
      id: row.authorId,
      name: row.authorName,
      handle: row.authorHandle,
      image: row.authorImage,
    },
    kudosCount: row.kudosCount,
    commentCount: row.commentCount,
    ...(row.kudosByMe !== undefined ? { kudosByMe: row.kudosByMe } : {}),
  };
}

const kudosCountSql = sql<number>`(SELECT count(*) FROM post_kudos k WHERE k.post_id = ${postTable.id})`;
const commentCountSql = sql<number>`(SELECT count(*) FROM post_comment c WHERE c.post_id = ${postTable.id})`;

const postColumns = {
  id: postTable.id,
  userId: postTable.userId,
  kind: postTable.kind,
  title: postTable.title,
  kcal: postTable.kcal,
  durationMin: postTable.durationMin,
  photoId: postTable.photoId,
  scanId: postTable.scanId,
  macroJson: postTable.macroJson,
  photosJson: postTable.photosJson,
  statsJson: postTable.statsJson,
  caption: postTable.caption,
  visibility: postTable.visibility,
  createdAt: postTable.createdAt,
  authorName: user.name,
  authorImage: user.image,
  authorHandle: profileTable.handle,
} as const;

/** Kudos milik `me` untuk halaman postingan; false untuk anon. */
async function myKudosSet(db: Database, me: string | null, postIds: string[]) {
  if (!me || postIds.length === 0) return new Set<string>();
  const rows = await db
    .select({ postId: postKudos.postId })
    .from(postKudos)
    .where(and(eq(postKudos.userId, me), inArray(postKudos.postId, postIds)));
  return new Set(rows.map((row) => row.postId));
}

async function countRow(query: Promise<{ total: number }[]>) {
  const [row] = await query;
  return row?.total ?? 0;
}

const dayStartWib = () => new Date(`${jakartaToday()}T00:00:00+07:00`).getTime();

// --- Router -------------------------------------------------------------------------

export const socialRouter = {
  /** Profil feed milik sendiri; handle diisi otomatis kalau belum ada. */
  myProfile: protectedProcedure.handler(async ({ context }) => {
    const me = context.session.user.id;
    const handle = await ensureHandle(context.db, me);
    const [[row], [followers], [following], [posts]] = await Promise.all([
      context.db
        .select({
          handle: profileTable.handle,
          bio: profileTable.bio,
          publicProfile: profileTable.publicProfile,
          defaultVisibility: profileTable.defaultVisibility,
        })
        .from(profileTable)
        .where(eq(profileTable.userId, me))
        .limit(1),
      context.db
        .select({ total: count() })
        .from(socialFollow)
        .where(eq(socialFollow.followingId, me)),
      context.db
        .select({ total: count() })
        .from(socialFollow)
        .where(eq(socialFollow.followerId, me)),
      context.db.select({ total: count() }).from(postTable).where(eq(postTable.userId, me)),
    ]);
    return {
      handle: row?.handle ?? handle,
      handleIsPlaceholder: /^jr-[0-9a-f]{8}$/.test(row?.handle ?? handle ?? ""),
      bio: row?.bio ?? null,
      publicProfile: row?.publicProfile ?? true,
      defaultVisibility: row?.defaultVisibility ?? "grup",
      followerCount: followers?.total ?? 0,
      followingCount: following?.total ?? 0,
      postCount: posts?.total ?? 0,
    };
  }),

  updateProfile: protectedProcedure
    .input(
      z.object({
        handle: z.string().max(40).optional(),
        bio: z.string().trim().max(BIO_MAX).optional(),
        publicProfile: z.boolean().optional(),
        defaultVisibility: visibilitySchema.optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const t = serverT(context.locale, "feed");
      const me = context.session.user.id;
      const patch: Partial<{
        handle: string;
        bio: string | null;
        publicProfile: boolean;
        defaultVisibility: "publik" | "grup";
      }> = {};
      if (input.handle !== undefined) {
        const parsed = handleSchema.safeParse(input.handle);
        if (!parsed.success) {
          throw new ORPCError("BAD_REQUEST", { message: t("server.error.handleFormat") });
        }
        patch.handle = parsed.data;
      }
      if (input.bio !== undefined) patch.bio = input.bio.length > 0 ? input.bio : null;
      if (input.publicProfile !== undefined) {
        patch.publicProfile = input.publicProfile;
        // Profil diprivatkan: postingan yang sudah 'publik' tetap 'publik' di
        // data, tapi tidak lagi tampil di Jelajah/profil publik (filter
        // publicProfile diterapkan saat membaca) dan fotonya ikut terkunci.
      }
      if (input.defaultVisibility !== undefined) patch.defaultVisibility = input.defaultVisibility;
      if (Object.keys(patch).length === 0) return { ok: true };
      if (patch.handle !== undefined) {
        const [current] = await context.db
          .select({ handle: profileTable.handle })
          .from(profileTable)
          .where(eq(profileTable.userId, me))
          .limit(1);
        if (current?.handle === patch.handle) delete patch.handle;
        else if (await handleTaken(context.db, patch.handle)) {
          throw new ORPCError("BAD_REQUEST", { message: t("server.error.handleTaken") });
        }
      }
      try {
        await context.db.update(profileTable).set(patch).where(eq(profileTable.userId, me));
      } catch {
        throw new ORPCError("BAD_REQUEST", { message: t("server.error.handleTaken") });
      }
      return { ok: true };
    }),

  /** Cek live: format valid, milik sendiri, sudah dipakai, atau bebas. */
  handleCheck: protectedProcedure
    .input(z.object({ handle: z.string().max(40) }))
    .handler(async ({ context, input }) => {
      const t = serverT(context.locale, "feed");
      const parsed = handleSchema.safeParse(input.handle);
      if (!parsed.success) {
        return {
          status: "invalid" as const,
          message: t("server.error.handleFormat"),
        };
      }
      const [current] = await context.db
        .select({ handle: profileTable.handle })
        .from(profileTable)
        .where(eq(profileTable.userId, context.session.user.id))
        .limit(1);
      if (current?.handle === parsed.data) return { status: "own" as const, message: null };
      if (await handleTaken(context.db, parsed.data)) {
        return { status: "taken" as const, message: t("server.error.handleTakenShort") };
      }
      return { status: "free" as const, message: null };
    }),

  /** Saran handle yang masih bebas, diturunkan dari nama akun. */
  handleSuggestions: protectedProcedure.handler(async ({ context }) => {
    const [row] = await context.db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, context.session.user.id))
      .limit(1);
    const words = (row?.name ?? "")
      .toLowerCase()
      .split(/\s+/)
      .map((word) => word.replace(/[^a-z0-9]+/g, ""))
      .filter((word) => word.length > 0);
    const first = (words[0] ?? "pengguna").slice(0, 14);
    const last = words.length > 1 ? (words.at(-1) ?? "").slice(0, 10) : "";
    const digits = () => String(Math.floor(10 + Math.random() * 90));
    const candidates = [
      last ? `${first}_${last}` : first,
      first,
      last ? `${first}${last.slice(0, 1)}` : `${first}_fit`,
      `${first}${digits()}`,
      `${first}_${digits()}`,
      `${first}${digits()}${digits()}`,
    ]
      .map((candidate) => candidate.slice(0, 20))
      .filter((candidate, index, all) => /^[a-z0-9_]{3,20}$/.test(candidate) && all.indexOf(candidate) === index);
    const free: string[] = [];
    for (const candidate of candidates) {
      if (free.length >= 4) break;
      if (!(await handleTaken(context.db, candidate))) free.push(candidate);
    }
    return { suggestions: free };
  }),

  createPost: protectedProcedure
    .input(
      z.object({
        kind: z.enum(["makan", "latihan", "berat", "cerita"]),
        refId: z.string().min(1).optional(),
        caption: z.string().trim().max(STORY_MAX).optional(),
        // Pos 'cerita': id foto dari social.uploadPostPhoto (maks 4).
        photoIds: z.array(z.string().regex(/^[a-f0-9]{32}$/)).max(STORY_PHOTOS_MAX).optional(),
        visibility: visibilitySchema.optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const t = serverT(context.locale, "feed");
      const me = context.session.user.id;
      const db = context.db;

      const todayCount = await countRow(
        db
          .select({ total: count() })
          .from(postTable)
          .where(and(eq(postTable.userId, me), gt(postTable.createdAt, new Date(dayStartWib())))),
      );
      if (todayCount >= MAX_POSTS_PER_DAY) {
        throw new ORPCError("BAD_REQUEST", { message: t("server.error.postQuota") });
      }

      const [meProfile] = await db
        .select({
          publicProfile: profileTable.publicProfile,
          defaultVisibility: profileTable.defaultVisibility,
          startWeightKg: profileTable.startWeightKg,
        })
        .from(profileTable)
        .where(eq(profileTable.userId, me))
        .limit(1);
      if (!meProfile) {
        throw new ORPCError("FAILED_PRECONDITION", { message: t("server.error.onboardingRequired") });
      }
      const visibility = input.visibility ?? meProfile.defaultVisibility;
      if (visibility === "publik" && !meProfile.publicProfile) {
        throw new ORPCError("BAD_REQUEST", {
          message: t("server.error.publicProfileRequired"),
        });
      }

      let snapshot: {
        title: string;
        kcal: number | null;
        durationMin: number | null;
        photoId: string | null;
        scanId: string | null;
        macroJson: string | null;
        photosJson: string | null;
        statsJson: string | null;
        foodLogId: string | null;
        exerciseLogId: string | null;
        workoutSessionId: string | null;
        weightLogId: string | null;
      };

      if (input.kind === "cerita") {
        // Post bebas: minimal teks atau satu foto; foto harus milik sendiri.
        const caption = input.caption ?? "";
        const photoIds = input.photoIds ?? [];
        if (caption.length === 0 && photoIds.length === 0) {
          throw new ORPCError("BAD_REQUEST", {
            message: t("server.error.storyEmpty"),
          });
        }
        const bucket = context.env.STICKERS;
        if (bucket && photoIds.length > 0) {
          for (const photoId of photoIds) {
            // get() dipakai sebagai head: bucket minimal ini tidak punya head().
            const found = await bucket.get(`posts/${me}/${photoId}.jpg`);
            if (!found) {
              throw new ORPCError("BAD_REQUEST", {
                message: t("server.error.photoMissing"),
              });
            }
          }
        }
        snapshot = {
          title: caption.slice(0, 80),
          kcal: null,
          durationMin: null,
          photoId: null,
          scanId: null,
          macroJson: null,
          photosJson: photoIds.length > 0 ? JSON.stringify(photoIds) : null,
          statsJson: null,
          foodLogId: null,
          exerciseLogId: null,
          workoutSessionId: null,
          weightLogId: null,
        };
      } else if (input.kind === "makan") {
        if (!input.refId) {
          throw new ORPCError("BAD_REQUEST", { message: t("server.error.pickFood") });
        }
        const [food] = await db
          .select()
          .from(foodLog)
          .where(and(eq(foodLog.id, input.refId), eq(foodLog.userId, me)))
          .limit(1);
        if (!food) throw new ORPCError("NOT_FOUND", { message: t("server.error.foodNotFound") });
        snapshot = {
          title: food.name,
          kcal: food.kcal,
          durationMin: null,
          photoId: food.photoId,
          scanId: food.scanId,
          macroJson: JSON.stringify({
            protein: food.protein,
            carbs: food.carbs,
            fat: food.fat,
            fiber: food.fiber,
          }),
          photosJson: null,
          statsJson: null,
          foodLogId: food.id,
          exerciseLogId: null,
          workoutSessionId: null,
          weightLogId: null,
        };
      } else if (input.kind === "berat") {
        if (!input.refId) {
          throw new ORPCError("BAD_REQUEST", { message: t("server.error.pickWeight") });
        }
        const [weight] = await db
          .select()
          .from(weightLog)
          .where(and(eq(weightLog.id, input.refId), eq(weightLog.userId, me)))
          .limit(1);
        if (!weight) throw new ORPCError("NOT_FOUND", { message: t("server.error.weightNotFound") });
        snapshot = {
          title: "Check-in berat badan",
          kcal: null,
          durationMin: null,
          photoId: null,
          scanId: null,
          macroJson: null,
          photosJson: null,
          statsJson: JSON.stringify({
            weightKg: weight.weightKg,
            deltaKg: Number((weight.weightKg - meProfile.startWeightKg).toFixed(1)),
          }),
          foodLogId: null,
          exerciseLogId: null,
          workoutSessionId: null,
          weightLogId: weight.id,
        };
      } else {
        // Latihan: sesi beban (workout_session) atau kardio (exercise_log).
        if (!input.refId) {
          throw new ORPCError("BAD_REQUEST", { message: t("server.error.pickWorkout") });
        }
        const [session] = await db
          .select()
          .from(workoutSession)
          .where(and(eq(workoutSession.id, input.refId), eq(workoutSession.userId, me)))
          .limit(1);
        if (session) {
          const [sets, [log]] = await Promise.all([
            db.select().from(workoutSet).where(eq(workoutSet.sessionId, session.id)),
            session.exerciseLogId
              ? db
                  .select({ kcal: exerciseLog.kcal })
                  .from(exerciseLog)
                  .where(eq(exerciseLog.id, session.exerciseLogId))
                  .limit(1)
              : Promise.resolve([undefined as { kcal: number } | undefined]),
          ]);
          const counted = sets.filter((set) => set.setType !== "warmup");
          const volumeKg = counted.reduce(
            (total, set) => total + (set.weightKg ?? 0) * (set.reps ?? 0),
            0,
          );
          const reps = counted.reduce((total, set) => total + (set.reps ?? 0), 0);
          snapshot = {
            title: session.name,
            kcal: log?.kcal ?? null,
            durationMin: session.durationMin,
            photoId: null,
            scanId: null,
            macroJson: null,
            photosJson: null,
            statsJson: JSON.stringify({
              sets: counted.length,
              reps,
              volumeKg: Math.round(volumeKg),
            }),
            foodLogId: null,
            exerciseLogId: session.exerciseLogId,
            workoutSessionId: session.id,
            weightLogId: null,
          };
        } else {
          const [cardio] = await db
            .select()
            .from(exerciseLog)
            .where(
              and(
                eq(exerciseLog.id, input.refId),
                eq(exerciseLog.userId, me),
                // Strava API policy: Strava data is never shared to others.
                ne(exerciseLog.source, "strava"),
              ),
            )
            .limit(1);
          if (!cardio) {
            throw new ORPCError("NOT_FOUND", { message: t("server.error.workoutNotFound") });
          }
          snapshot = {
            title: cardio.name,
            kcal: cardio.kcal,
            durationMin: cardio.durationMin,
            photoId: null,
            scanId: null,
            macroJson: null,
            photosJson: null,
            statsJson: JSON.stringify({ type: cardio.type }),
            foodLogId: null,
            exerciseLogId: cardio.id,
            workoutSessionId: null,
            weightLogId: null,
          };
        }
      }

      const postId = crypto.randomUUID();
      await db.insert(postTable).values({
        id: postId,
        userId: me,
        kind: input.kind,
        caption: input.caption?.length ? input.caption : null,
        visibility,
        ...snapshot,
      });
      return { id: postId, visibility };
    }),

  /**
   * Unggah satu foto untuk pos 'cerita' (maks 4 per pos, dipagari klien).
   * Klien memampatkan ke sisi ~1600px JPEG/WebP sebelum mengunggah; pagar
   * input hanya untuk unggahan mentah (~5 MB biner, base64 +4/3).
   */
  uploadPostPhoto: protectedProcedure
    .input(
      z.object({
        imageBase64: z.base64().min(50).max(6_990_000),
        mimeType: z.enum(["image/jpeg", "image/webp"]),
      }),
    )
    .handler(async ({ context, input }) => {
      const t = serverT(context.locale, "feed");
      const userId = context.session.user.id;
      const bucket = context.env.STICKERS;
      if (!bucket) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: t("server.error.photoStorageUnavailable") });
      }
      const id = crypto.randomUUID().replaceAll("-", "");
      try {
        await bucket.put(`posts/${userId}/${id}.jpg`, base64ToBytes(input.imageBase64), {
          // Kunci selalu .jpg; tipe konten asli tetap dibawa metadata sehingga
          // /post-photo menyajikan WebP dengan header yang benar.
          httpMetadata: { contentType: input.mimeType },
        });
      } catch {
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: t("server.error.photoSaveFailed") });
      }
      return { photoId: id };
    }),

  deletePost: protectedProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ context, input }) => {
      const me = context.session.user.id;
      const [row] = await context.db
        .select({ photosJson: postTable.photosJson })
        .from(postTable)
        .where(and(eq(postTable.id, input.id), eq(postTable.userId, me)))
        .limit(1);
      await context.db
        .delete(postTable)
        .where(and(eq(postTable.id, input.id), eq(postTable.userId, me)));
      // Objek foto pos ikut dihapus; foto lama (photoId milik diary) dibiarkan
      // karena dipakai bersama catatan makanannya.
      const bucket = context.env.STICKERS;
      if (row && bucket) {
        context.waitUntil(
          Promise.all(
            parseStringArray(row.photosJson).map((photoId) =>
              bucket.delete(`posts/${me}/${photoId}.jpg`).catch(() => {}),
            ),
          ).then(() => {}),
        );
      }
      return { ok: true };
    }),

  myPosts: protectedProcedure
    .input(z.object({ cursor: cursorSchema, limit: z.number().int().min(1).max(25).default(PAGE_SIZE) }))
    .handler(async ({ context, input }) => {
      const me = context.session.user.id;
      const rows = await context.db
        .select({ ...postColumns, kudosCount: kudosCountSql, commentCount: commentCountSql })
        .from(postTable)
        .innerJoin(user, eq(user.id, postTable.userId))
        .leftJoin(profileTable, eq(profileTable.userId, postTable.userId))
        .where(
          and(
            eq(postTable.userId, me),
            input.cursor ? lt(postTable.createdAt, new Date(input.cursor)) : undefined,
          ),
        )
        .orderBy(desc(postTable.createdAt))
        .limit(input.limit + 1);
      const page = rows.slice(0, input.limit);
      const kudosMine = await myKudosSet(context.db, me, page.map((row) => row.id));
      return {
        items: page.map((row) => toFeedItem({ ...row, authorId: row.userId, kudosByMe: kudosMine.has(row.id) })),
        nextCursor:
          rows.length > input.limit ? page[page.length - 1]?.createdAt.getTime() ?? null : null,
      };
    }),

  feed: protectedProcedure
    .input(
      z.object({
        tab: z.enum(["mengikuti", "jelajah"]).default("mengikuti"),
        cursor: cursorSchema,
        limit: z.number().int().min(1).max(25).default(PAGE_SIZE),
      }),
    )
    .handler(async ({ context, input }) => {
      const me = context.session.user.id;
      const db = context.db;
      const visibilityFilter =
        input.tab === "jelajah"
          ? and(eq(postTable.visibility, "publik"), eq(profileTable.publicProfile, true))
          : or(
              eq(postTable.userId, me),
              followedSql(me),
              and(eq(postTable.visibility, "grup"), sameTeamSql(me)),
            );
      const rows = await db
        .select({ ...postColumns, kudosCount: kudosCountSql, commentCount: commentCountSql })
        .from(postTable)
        .innerJoin(user, eq(user.id, postTable.userId))
        .leftJoin(profileTable, eq(profileTable.userId, postTable.userId))
        .where(
          and(
            blockedSql(me),
            visibilityFilter,
            input.cursor ? lt(postTable.createdAt, new Date(input.cursor)) : undefined,
          ),
        )
        .orderBy(desc(postTable.createdAt))
        .limit(input.limit + 1);
      const page = rows.slice(0, input.limit);
      const kudosMine = await myKudosSet(db, me, page.map((row) => row.id));
      return {
        items: page.map((row) => toFeedItem({ ...row, authorId: row.userId, kudosByMe: kudosMine.has(row.id) })),
        nextCursor:
          rows.length > input.limit ? page[page.length - 1]?.createdAt.getTime() ?? null : null,
      };
    }),

  /** Satu postingan; publik boleh tanpa sesi, 'grup' butuh rekan tim. */
  post: publicProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ context, input }) => {
      const t = serverT(context.locale, "feed");
      const me = context.session?.user.id ?? null;
      const row = await loadVisiblePost(context.db, input.id, me, t);
      const kudosCount = await countRow(
        context.db.select({ total: count() }).from(postKudos).where(eq(postKudos.postId, row.id)),
      );
      const commentCount = await countRow(
        context.db
          .select({ total: count() })
          .from(postComment)
          .where(eq(postComment.postId, row.id)),
      );
      const kudosByMe = me
        ? (
            await context.db
              .select({ postId: postKudos.postId })
              .from(postKudos)
              .where(and(eq(postKudos.postId, row.id), eq(postKudos.userId, me)))
              .limit(1)
          ).length > 0
        : false;
      return toFeedItem({ ...row, authorId: row.userId, kudosCount, commentCount, kudosByMe });
    }),

  /** Halaman publik /u/<handle>; non-publik cuma balikin nama. */
  publicProfile: publicProcedure
    .input(
      z.object({
        handle: z.string().trim().toLowerCase(),
        cursor: cursorSchema,
        limit: z.number().int().min(1).max(25).default(PAGE_SIZE),
      }),
    )
    .handler(async ({ context, input }) => {
      const t = serverT(context.locale, "feed");
      const db = context.db;
      const me = context.session?.user.id ?? null;
      const [row] = await db
        .select({
          userId: user.id,
          name: user.name,
          image: user.image,
          handle: profileTable.handle,
          bio: profileTable.bio,
          publicProfile: profileTable.publicProfile,
        })
        .from(profileTable)
        .innerJoin(user, eq(user.id, profileTable.userId))
        .where(eq(profileTable.handle, input.handle))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND", { message: t("server.error.profileNotFound") });
      const isSelf = me === row.userId;
      if (!row.publicProfile && !isSelf) {
        return {
          userId: row.userId,
          name: row.name,
          handle: row.handle,
          image: null,
          bio: null,
          publicProfile: false,
          isSelf: false,
          isFollowing: null,
          blocked: false,
          stats: null,
          posts: { items: [], nextCursor: null },
        };
      }
      if (!isSelf && me) {
        const blocked = await countRow(
          db
            .select({ total: count() })
            .from(socialBlock)
            .where(
              or(
                and(eq(socialBlock.blockerId, me), eq(socialBlock.blockedId, row.userId)),
                and(eq(socialBlock.blockerId, row.userId), eq(socialBlock.blockedId, me)),
              ),
            ),
        );
        if (blocked > 0) {
          throw new ORPCError("NOT_FOUND", { message: t("server.error.profileNotFound") });
        }
      }
      const [[postCount], [followers], [following], [isFollowingRow], posts] = await Promise.all([
        db
          .select({ total: count() })
          .from(postTable)
          .where(and(eq(postTable.userId, row.userId), eq(postTable.visibility, "publik"))),
        db
          .select({ total: count() })
          .from(socialFollow)
          .where(eq(socialFollow.followingId, row.userId)),
        db
          .select({ total: count() })
          .from(socialFollow)
          .where(eq(socialFollow.followerId, row.userId)),
        me
          ? db
              .select({ followerId: socialFollow.followerId })
              .from(socialFollow)
              .where(
                and(
                  eq(socialFollow.followerId, me),
                  eq(socialFollow.followingId, row.userId),
                ),
              )
              .limit(1)
          : Promise.resolve([] as { followerId: string }[]),
        db
          .select({ ...postColumns, kudosCount: kudosCountSql, commentCount: commentCountSql })
          .from(postTable)
          .innerJoin(user, eq(user.id, postTable.userId))
          .leftJoin(profileTable, eq(profileTable.userId, postTable.userId))
          .where(
            and(
              eq(postTable.userId, row.userId),
              eq(postTable.visibility, "publik"),
              input.cursor ? lt(postTable.createdAt, new Date(input.cursor)) : undefined,
            ),
          )
          .orderBy(desc(postTable.createdAt))
          .limit(input.limit + 1),
      ]);
      const page = posts.slice(0, input.limit);
      const kudosMine = await myKudosSet(db, me, page.map((p) => p.id));
      return {
        userId: row.userId,
        name: row.name,
        handle: row.handle,
        image: row.image,
        bio: row.bio,
        publicProfile: true,
        isSelf,
        isFollowing: me && !isSelf ? isFollowingRow !== undefined : null,
        blocked: false,
        stats: {
          postCount: postCount?.total ?? 0,
          followerCount: followers?.total ?? 0,
          followingCount: following?.total ?? 0,
        },
        posts: {
          items: page.map((p) => toFeedItem({ ...p, authorId: p.userId, kudosByMe: kudosMine.has(p.id) })),
          nextCursor:
            posts.length > input.limit
              ? page[page.length - 1]?.createdAt.getTime() ?? null
              : null,
        },
      };
    }),

  setFollow: protectedProcedure
    .input(z.object({ userId: z.string(), follow: z.boolean() }))
    .handler(async ({ context, input }) => {
      const t = serverT(context.locale, "feed");
      const me = context.session.user.id;
      const db = context.db;
      if (input.userId === me) {
        throw new ORPCError("BAD_REQUEST", { message: t("server.error.followSelf") });
      }
      if (input.follow) {
        const blocked = await countRow(
          db
            .select({ total: count() })
            .from(socialBlock)
            .where(
              or(
                and(eq(socialBlock.blockerId, me), eq(socialBlock.blockedId, input.userId)),
                and(eq(socialBlock.blockerId, input.userId), eq(socialBlock.blockedId, me)),
              ),
            ),
        );
        if (blocked > 0) {
          throw new ORPCError("NOT_FOUND", { message: t("server.error.followUnavailable") });
        }
        const followingCount = await countRow(
          db.select({ total: count() }).from(socialFollow).where(eq(socialFollow.followerId, me)),
        );
        if (followingCount >= MAX_FOLLOWING) {
          throw new ORPCError("BAD_REQUEST", { message: t("server.error.followLimit") });
        }
        await db
          .insert(socialFollow)
          .values({ followerId: me, followingId: input.userId })
          .onConflictDoNothing();
        // Notifikasi follow: satu baris per pasangan, dikunjungi ulang saat
        // unfollow-refollow supaya kotak notifikasi tidak menumpuk.
        const [existing] = await db
          .select({ id: socialNotification.id })
          .from(socialNotification)
          .where(
            and(
              eq(socialNotification.userId, input.userId),
              eq(socialNotification.actorId, me),
              eq(socialNotification.kind, "follow"),
              isNull(socialNotification.postId),
            ),
          )
          .limit(1);
        if (existing) {
          await db
            .update(socialNotification)
            .set({ createdAt: new Date(), readAt: null })
            .where(eq(socialNotification.id, existing.id));
        } else {
          await db.insert(socialNotification).values({
            id: crypto.randomUUID(),
            userId: input.userId,
            actorId: me,
            kind: "follow",
          });
        }
      } else {
        await db
          .delete(socialFollow)
          .where(
            and(eq(socialFollow.followerId, me), eq(socialFollow.followingId, input.userId)),
          );
      }
      return { ok: true };
    }),

  followers: publicProcedure
    .input(z.object({ handle: z.string().trim().toLowerCase() }))
    .handler(async ({ context, input }) => {
      const t = serverT(context.locale, "feed");
      const [row] = await context.db
        .select({ userId: profileTable.userId, publicProfile: profileTable.publicProfile })
        .from(profileTable)
        .where(eq(profileTable.handle, input.handle))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND", { message: t("server.error.profileNotFound") });
      const me = context.session?.user.id ?? null;
      if (!row.publicProfile && me !== row.userId) {
        throw new ORPCError("NOT_FOUND", { message: t("server.error.profileNotFound") });
      }
      const rows = await context.db
        .select({
          id: user.id,
          name: user.name,
          image: user.image,
          handle: profileTable.handle,
        })
        .from(socialFollow)
        .innerJoin(user, eq(user.id, socialFollow.followerId))
        .leftJoin(profileTable, eq(profileTable.userId, socialFollow.followerId))
        .where(
          and(
            eq(socialFollow.followingId, row.userId),
            me ? blockedBetweenSql(me, socialFollow.followerId) : undefined,
          ),
        )
        .orderBy(desc(socialFollow.createdAt))
        .limit(200);
      return rows;
    }),

  following: publicProcedure
    .input(z.object({ handle: z.string().trim().toLowerCase() }))
    .handler(async ({ context, input }) => {
      const t = serverT(context.locale, "feed");
      const [row] = await context.db
        .select({ userId: profileTable.userId, publicProfile: profileTable.publicProfile })
        .from(profileTable)
        .where(eq(profileTable.handle, input.handle))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND", { message: t("server.error.profileNotFound") });
      const me = context.session?.user.id ?? null;
      if (!row.publicProfile && me !== row.userId) {
        throw new ORPCError("NOT_FOUND", { message: t("server.error.profileNotFound") });
      }
      const rows = await context.db
        .select({
          id: user.id,
          name: user.name,
          image: user.image,
          handle: profileTable.handle,
        })
        .from(socialFollow)
        .innerJoin(user, eq(user.id, socialFollow.followingId))
        .leftJoin(profileTable, eq(profileTable.userId, socialFollow.followingId))
        .where(
          and(
            eq(socialFollow.followerId, row.userId),
            me ? blockedBetweenSql(me, socialFollow.followingId) : undefined,
          ),
        )
        .orderBy(desc(socialFollow.createdAt))
        .limit(200);
      return rows;
    }),

  kudos: protectedProcedure
    .input(z.object({ postId: z.string() }))
    .handler(async ({ context, input }) => {
      const t = serverT(context.locale, "feed");
      const me = context.session.user.id;
      const db = context.db;
      const row = await loadVisiblePost(db, input.postId, me, t);
      const [existing] = await db
        .select({ postId: postKudos.postId })
        .from(postKudos)
        .where(and(eq(postKudos.postId, row.id), eq(postKudos.userId, me)))
        .limit(1);
      if (existing) {
        await db
          .delete(postKudos)
          .where(and(eq(postKudos.postId, row.id), eq(postKudos.userId, me)));
      } else {
        await db.insert(postKudos).values({ postId: row.id, userId: me });
        if (row.userId !== me) {
          const [actor] = await db
            .select({ name: user.name })
            .from(user)
            .where(eq(user.id, me))
            .limit(1);
          await notifyKudos(
            context as unknown as NotifyContext,
            row.id,
            row.title,
            row.userId,
            me,
            actor?.name ?? "Teman",
          );
        }
      }
      const kudosCount = await countRow(
        db.select({ total: count() }).from(postKudos).where(eq(postKudos.postId, row.id)),
      );
      return { kudos: !existing, kudosCount };
    }),

  kudosList: publicProcedure
    .input(z.object({ postId: z.string(), limit: z.number().int().min(1).max(200).default(100) }))
    .handler(async ({ context, input }) => {
      const me = context.session?.user.id ?? null;
      // Detail postingan sudah memvalidasi akses; daftar ini hanya pelengkap.
      const rows = await context.db
        .select({
          id: user.id,
          name: user.name,
          image: user.image,
          handle: profileTable.handle,
          createdAt: postKudos.createdAt,
        })
        .from(postKudos)
        .innerJoin(user, eq(user.id, postKudos.userId))
        .leftJoin(profileTable, eq(profileTable.userId, postKudos.userId))
        .where(
          and(
            eq(postKudos.postId, input.postId),
            me ? blockedBetweenSql(me, postKudos.userId) : undefined,
          ),
        )
        .orderBy(desc(postKudos.createdAt))
        .limit(input.limit);
      return rows;
    }),

  comments: publicProcedure
    .input(
      z.object({
        postId: z.string(),
        cursor: cursorSchema,
        limit: z.number().int().min(1).max(50).default(30),
      }),
    )
    .handler(async ({ context, input }) => {
      const me = context.session?.user.id ?? null;
      const rows = await context.db
        .select({
          id: postComment.id,
          body: postComment.body,
          createdAt: postComment.createdAt,
          authorId: user.id,
          authorName: user.name,
          authorImage: user.image,
          authorHandle: profileTable.handle,
        })
        .from(postComment)
        .innerJoin(user, eq(user.id, postComment.userId))
        .leftJoin(profileTable, eq(profileTable.userId, postComment.userId))
        .where(
          and(
            eq(postComment.postId, input.postId),
            me ? blockedBetweenSql(me, postComment.userId) : undefined,
            input.cursor ? gt(postComment.createdAt, new Date(input.cursor)) : undefined,
          ),
        )
        .orderBy(asc(postComment.createdAt))
        .limit(input.limit + 1);
      const page = rows.slice(0, input.limit);
      return {
        items: page.map((row) => ({
          id: row.id,
          body: row.body,
          createdAt: row.createdAt,
          author: {
            id: row.authorId,
            name: row.authorName,
            handle: row.authorHandle,
            image: row.authorImage,
          },
        })),
        nextCursor:
          rows.length > input.limit ? page[page.length - 1]?.createdAt.getTime() ?? null : null,
      };
    }),

  addComment: protectedProcedure
    .input(z.object({ postId: z.string(), body: z.string().trim().min(1).max(COMMENT_MAX) }))
    .handler(async ({ context, input }) => {
      const t = serverT(context.locale, "feed");
      const me = context.session.user.id;
      const db = context.db;
      const dayCount = await countRow(
        db
          .select({ total: count() })
          .from(postComment)
          .where(
            and(eq(postComment.userId, me), gt(postComment.createdAt, new Date(dayStartWib()))),
          ),
      );
      if (dayCount >= MAX_COMMENTS_PER_DAY) {
        throw new ORPCError("BAD_REQUEST", { message: t("server.error.commentQuota") });
      }
      const row = await loadVisiblePost(db, input.postId, me, t);
      const commentId = crypto.randomUUID();
      await db.insert(postComment).values({
        id: commentId,
        postId: row.id,
        userId: me,
        body: input.body,
      });
      if (row.userId !== me) {
        const [actor] = await db
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, me))
          .limit(1);
        await notifyComment(
          context as unknown as NotifyContext,
          row.id,
          row.userId,
          me,
          actor?.name ?? "Teman",
          input.body,
        );
      }
      return { id: commentId };
    }),

  /** Pengomentar boleh hapus miliknya; penulis postingan boleh hapus semua. */
  deleteComment: protectedProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ context, input }) => {
      const t = serverT(context.locale, "feed");
      const me = context.session.user.id;
      const [comment] = await context.db
        .select({ id: postComment.id, userId: postComment.userId, postId: postComment.postId })
        .from(postComment)
        .where(eq(postComment.id, input.id))
        .limit(1);
      if (!comment) return { ok: true };
      const [post] = await context.db
        .select({ userId: postTable.userId })
        .from(postTable)
        .where(eq(postTable.id, comment.postId))
        .limit(1);
      if (comment.userId !== me && post?.userId !== me) {
        throw new ORPCError("FORBIDDEN", { message: t("server.error.notYourComment") });
      }
      await context.db.delete(postComment).where(eq(postComment.id, comment.id));
      return { ok: true };
    }),

  block: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .handler(async ({ context, input }) => {
      const t = serverT(context.locale, "feed");
      const me = context.session.user.id;
      if (input.userId === me) {
        throw new ORPCError("BAD_REQUEST", { message: t("server.error.blockSelf") });
      }
      await context.db
        .insert(socialBlock)
        .values({ blockerId: me, blockedId: input.userId })
        .onConflictDoNothing();
      // Blokir memutus hubungan dua arah.
      await context.db
        .delete(socialFollow)
        .where(
          or(
            and(eq(socialFollow.followerId, me), eq(socialFollow.followingId, input.userId)),
            and(eq(socialFollow.followerId, input.userId), eq(socialFollow.followingId, me)),
          ),
        );
      return { ok: true };
    }),

  unblock: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .handler(async ({ context, input }) => {
      await context.db
        .delete(socialBlock)
        .where(
          and(
            eq(socialBlock.blockerId, context.session.user.id),
            eq(socialBlock.blockedId, input.userId),
          ),
        );
      return { ok: true };
    }),

  blockList: protectedProcedure.handler(async ({ context }) => {
    return context.db
      .select({
        id: user.id,
        name: user.name,
        image: user.image,
        handle: profileTable.handle,
      })
      .from(socialBlock)
      .innerJoin(user, eq(user.id, socialBlock.blockedId))
      .leftJoin(profileTable, eq(profileTable.userId, socialBlock.blockedId))
      .where(eq(socialBlock.blockerId, context.session.user.id))
      .orderBy(desc(socialBlock.createdAt))
      .limit(200);
  }),

  report: protectedProcedure
    .input(
      z.object({
        postId: z.string().optional(),
        commentId: z.string().optional(),
        reason: z.enum(["spam", "kasar", "salah_info", "lainnya"]),
        note: z.string().trim().max(NOTE_MAX).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const t = serverT(context.locale, "feed");
      if (Boolean(input.postId) === Boolean(input.commentId)) {
        throw new ORPCError("BAD_REQUEST", { message: t("server.error.reportOne") });
      }
      const me = context.session.user.id;
      const dayCount = await countRow(
        context.db
          .select({ total: count() })
          .from(socialReport)
          .where(and(eq(socialReport.reporterId, me), gt(socialReport.createdAt, new Date(dayStartWib())))),
      );
      if (dayCount >= MAX_REPORTS_PER_DAY) {
        throw new ORPCError("BAD_REQUEST", { message: t("server.error.reportQuota") });
      }
      if (input.postId) {
        const [post] = await context.db
          .select({ id: postTable.id })
          .from(postTable)
          .where(eq(postTable.id, input.postId))
          .limit(1);
        if (!post) throw new ORPCError("NOT_FOUND", { message: t("server.error.postNotFound") });
      } else if (input.commentId) {
        const [comment] = await context.db
          .select({ id: postComment.id })
          .from(postComment)
          .where(eq(postComment.id, input.commentId))
          .limit(1);
        if (!comment) throw new ORPCError("NOT_FOUND", { message: t("server.error.commentNotFound") });
      }
      await context.db.insert(socialReport).values({
        id: crypto.randomUUID(),
        reporterId: me,
        postId: input.postId ?? null,
        commentId: input.commentId ?? null,
        reason: input.reason,
        note: input.note?.length ? input.note : null,
      });
      return { ok: true };
    }),

  // Notifikasi feed terpisah dari kotak masuk grup; dirender di halaman Feed.
  notifications: protectedProcedure
    .input(z.object({ cursor: cursorSchema, limit: z.number().int().min(1).max(50).default(30) }))
    .handler(async ({ context, input }) => {
      const rows = await context.db
        .select({
          id: socialNotification.id,
          kind: socialNotification.kind,
          excerpt: socialNotification.excerpt,
          createdAt: socialNotification.createdAt,
          readAt: socialNotification.readAt,
          postId: socialNotification.postId,
          postTitle: postTable.title,
          postKind: postTable.kind,
          actorId: user.id,
          actorName: user.name,
          actorImage: user.image,
          actorHandle: profileTable.handle,
        })
        .from(socialNotification)
        .innerJoin(user, eq(user.id, socialNotification.actorId))
        .leftJoin(profileTable, eq(profileTable.userId, socialNotification.actorId))
        .leftJoin(postTable, eq(postTable.id, socialNotification.postId))
        .where(
          and(
            eq(socialNotification.userId, context.session.user.id),
            input.cursor
              ? lt(socialNotification.createdAt, new Date(input.cursor))
              : undefined,
          ),
        )
        .orderBy(desc(socialNotification.createdAt))
        .limit(input.limit + 1);
      const page = rows.slice(0, input.limit);
      return {
        items: page,
        nextCursor:
          rows.length > input.limit ? page[page.length - 1]?.createdAt.getTime() ?? null : null,
      };
    }),

  notificationsUnreadCount: protectedProcedure.handler(async ({ context }) => {
    const [row] = await context.db
      .select({ total: count() })
      .from(socialNotification)
      .where(
        and(
          eq(socialNotification.userId, context.session.user.id),
          isNull(socialNotification.readAt),
        ),
      );
    return { count: row?.total ?? 0 };
  }),

  notificationsMarkRead: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).optional() }))
    .handler(async ({ context, input }) => {
      const filters = input.ids?.length
        ? and(
            eq(socialNotification.userId, context.session.user.id),
            inArray(socialNotification.id, input.ids),
          )
        : eq(socialNotification.userId, context.session.user.id);
      await context.db.update(socialNotification).set({ readAt: new Date() }).where(filters);
      return { ok: true };
    }),
};
