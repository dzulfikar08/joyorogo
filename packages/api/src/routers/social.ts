import { ORPCError } from "@orpc/server";
import {
  and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, like, lt, ne, or, sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
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
import { workoutSession, workoutSet } from "@joyorogo/db/schema/plans";
import {
  post as postTable,
  postComment,
  postKudos,
  postWorkoutDetail,
  socialBlock,
  socialFollow,
  socialNotification,
  socialReport,
} from "@joyorogo/db/schema/social";
import type { DayZone } from "@joyorogo/i18n";

import { publicProcedure, protectedProcedure } from "../index";
import { jakartaToday } from "../lib/engine";
import { D1_MAX_PARAMS, chunk } from "../lib/d1";
import { dayBounds } from "../lib/tiers";
import { base64ToBytes, commentPhotoKey } from "../lib/sticker";
import {
  attachmentInputSchema,
  buildItemAttachment,
  ITEM_KINDS,
  listAttachables,
  parseStoredAttachment,
  toPublicAttachment,
  weightDeltaKg,
  commentPhotoKeysOf,
} from "../lib/comment-attachment";
import type { Attachment, StoredAttachment } from "../lib/comment-attachment";
import { cleanImage } from "../lib/image-clean";
import { serverT } from "../lib/messages";
import { pushComment, pushFollow, pushKudos, pushNewPost } from "../lib/social-push";
import type { PushContext } from "../lib/social-push";
import { publicBadges } from "./badge";
import { premiumUnlocked } from "../lib/readiness-food";
import { paywallConfig } from "../lib/tiers";
import { userZone } from "../lib/user-zone";
import {
  buildFeedMapLine,
  feedMapPoints,
  mapAllowed,
  sportKindFromName,
} from "../lib/feed-route";
import { parseStoredAnalysis, workoutAnalysisSchema } from "../lib/workout-analysis-schema";

// --- Batasan -----------------------------------------------------------------

const STORY_MAX = 1000;
const STORY_PHOTOS_MAX = 4;
const COMMENT_MAX = 280;
const COMMENT_REPLIES_PAGE = 10;
/** Raw upload ceiling of a comment photo (~3 MB binary; clients send ~1600px JPEG/WebP far below it). */
const COMMENT_PHOTO_BASE64_MAX = 4_000_000;
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

const hrSchema = z.number().int().min(20).max(250);

const cursorSchema = z.number().int().positive().optional();

/** JSON tersimpan -> nilai, atau null kalau rusak (detail pos tidak boleh jadi 500). */
function parseJsonOrNull<T>(json: string | null): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

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
      commentsOff: postTable.commentsOff,
      createdAt: postTable.createdAt,
      authorName: user.name,
      authorImage: user.image,
      authorHandle: profileTable.handle,
      authorPublic: profileTable.publicProfile,
      authorShareMaps: profileTable.shareMaps,
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

/**
 * Pembuka bersama createPost/createWatchPost: kuota harian, onboarding, dan
 * pagar profil publik. Mengembalikan profil + visibility yang berlaku.
 */
async function preparePost(
  db: Database,
  me: string,
  requested: "publik" | "grup" | undefined,
  t: TFunction<"feed">,
  zone: DayZone,
) {
  const todayCount = await countRow(
    db
      .select({ total: count() })
      .from(postTable)
      .where(and(eq(postTable.userId, me), gt(postTable.createdAt, new Date(dayStartIn(zone))))),
  );
  if (todayCount >= MAX_POSTS_PER_DAY) {
    throw new ORPCError("BAD_REQUEST", { message: t("server.error.postQuota") });
  }

  const [meProfile] = await db
    .select({
      publicProfile: profileTable.publicProfile,
      defaultVisibility: profileTable.defaultVisibility,
      startWeightKg: profileTable.startWeightKg,
      goal: profileTable.goal,
      goalStartKg: profileTable.goalStartKg,
    })
    .from(profileTable)
    .where(eq(profileTable.userId, me))
    .limit(1);
  if (!meProfile) {
    throw new ORPCError("FAILED_PRECONDITION", { message: t("server.error.onboardingRequired") });
  }
  const visibility = requested ?? meProfile.defaultVisibility;
  if (visibility === "publik" && !meProfile.publicProfile) {
    throw new ORPCError("BAD_REQUEST", {
      message: t("server.error.publicProfileRequired"),
    });
  }
  return { meProfile, visibility };
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

type NotifyContext = PushContext;

/**
 * Satu notifikasi per (aktor, postingan, jenis) untuk kudos: kudos ulang
 * menandai belum dibaca lagi tanpa menumpuk baris. Push hanya kalau kudos
 * sebelumnya dari aktor yang sama sudah lebih satu jam (anti spam toggle).
 */
async function notifyKudos(
  context: NotifyContext,
  postId: string,
  postTitle: string,
  statsJson: string | null,
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
    pushKudos(context, {
      postId,
      postTitle,
      statsJson,
      authorId,
      actorId,
      actorName,
      hourBucket: Math.floor(Date.now() / KUDOS_PUSH_WINDOW_MS),
    });
  }
}

/** Komentar baru di postingan (`comment`, ke penulis postingan) atau balasan atas komentar seseorang (`reply`). */
async function notifyComment(
  context: NotifyContext,
  postId: string,
  statsJson: string | null,
  commentId: string,
  recipientId: string,
  actorId: string,
  actorName: string,
  body: string,
  kind: "comment" | "reply" = "comment",
) {
  await context.db.insert(socialNotification).values({
    id: crypto.randomUUID(),
    userId: recipientId,
    actorId,
    kind,
    postId,
    excerpt: body.length > 0 ? body.slice(0, 120) : null,
  });
  pushComment(context, { kind, commentId, postId, statsJson, recipientId, actorName, body });
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

/**
 * `stats` and the route map of a feed item. The stored shared line (`mapLine`, already trimmed and simplified when
 * the post was made) leaves only when both the post's switch and the author's account switch allow it; it is never
 * part of `stats`. `hasMap` / `showMap` stay in `stats` so the author's menu can show the switch.
 */
function feedStats(statsJson: string | null, authorShareMaps: boolean | null | undefined) {
  const stats = parseJson(statsJson);
  if (!stats || !("mapLine" in stats)) {
    return { stats: stats as PostSnapshot["stats"] };
  }
  const { mapLine, ...rest } = stats;
  const line =
    typeof mapLine === "string" && mapLine.length > 0 && mapAllowed(stats.showMap, authorShareMaps) ? mapLine : null;
  return { stats: rest as PostSnapshot["stats"], ...(line ? { mapLine: line } : {}) };
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
  commentsOff: boolean;
  createdAt: Date;
  authorId: string;
  authorName: string;
  authorImage: string | null;
  authorHandle: string | null;
  authorShareMaps?: boolean | null;
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
    ...feedStats(row.statsJson, row.authorShareMaps),
    photoCount: parseStringArray(row.photosJson).length || (row.photoId ? 1 : 0),
    caption: row.caption,
    visibility: row.visibility,
    commentsOff: row.commentsOff,
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
const commentCountSql = sql<number>`(SELECT count(*) FROM post_comment c WHERE c.post_id = ${postTable.id} AND c.deleted_at IS NULL)`;

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
  commentsOff: postTable.commentsOff,
  createdAt: postTable.createdAt,
  authorName: user.name,
  authorImage: user.image,
  authorHandle: profileTable.handle,
  authorShareMaps: profileTable.shareMaps,
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

const dayStartIn = (zone: DayZone) => dayBounds(jakartaToday(undefined, zone), zone).startMs;

// --- Komentar bertingkat -----------------------------------------------------------

const replyUser = alias(user, "reply_user");
const replyProfile = alias(profileTable, "reply_profile");

/** Satu komentar sebagaimana dilihat klien. Kontrak: docs/social-comments.md. */
export type CommentOut = {
  id: string;
  body: string;
  createdAt: Date;
  author: { id: string; name: string; handle: string | null; image: string | null };
  deleted: boolean;
  parentId: string | null;
  replyCount: number;
  replyTo: { id: string; name: string; handle: string | null } | null;
  attachment: Attachment | null;
};

/** Balasan yang terlihat `me`: belum dihapus dan bukan dari pengguna yang saling blokir dengannya. */
function replyCountSql(me: string | null) {
  return sql<number>`(SELECT count(*) FROM post_comment r WHERE r.parent_id = ${postComment.id} AND r.deleted_at IS NULL${
    me ? sql` AND ${blockedBetweenSql(me, sql`r.user_id`)}` : sql``
  })`;
}

type CommentRow = {
  id: string;
  body: string;
  createdAt: Date;
  parentId: string | null;
  deletedAt: Date | null;
  attachmentJson: string | null;
  replyCount: number;
  authorId: string;
  authorName: string;
  authorImage: string | null;
  authorHandle: string | null;
  replyToId: string | null;
  replyToName: string | null;
  replyToHandle: string | null;
};

async function loadComments(db: Database, me: string | null, where: SQL | undefined, limit: number): Promise<CommentRow[]> {
  return db
    .select({
      id: postComment.id,
      body: postComment.body,
      createdAt: postComment.createdAt,
      parentId: postComment.parentId,
      deletedAt: postComment.deletedAt,
      attachmentJson: postComment.attachmentJson,
      replyCount: replyCountSql(me),
      authorId: user.id,
      authorName: user.name,
      authorImage: user.image,
      authorHandle: profileTable.handle,
      replyToId: replyUser.id,
      replyToName: replyUser.name,
      replyToHandle: replyProfile.handle,
    })
    .from(postComment)
    .innerJoin(user, eq(user.id, postComment.userId))
    .leftJoin(profileTable, eq(profileTable.userId, postComment.userId))
    .leftJoin(replyUser, eq(replyUser.id, postComment.replyToUserId))
    .leftJoin(replyProfile, eq(replyProfile.userId, postComment.replyToUserId))
    .where(where)
    .orderBy(asc(postComment.createdAt), asc(postComment.id))
    .limit(limit);
}

function shapeComment(row: CommentRow, t: TFunction<"feed">): CommentOut {
  const deleted = row.deletedAt !== null;
  const stored = deleted ? null : parseStoredAttachment(row.attachmentJson);
  return {
    id: row.id,
    // A hidden comment keeps a readable body so a client that does not know `deleted` still shows something.
    body: deleted ? t("server.comment.deleted") : row.body,
    createdAt: row.createdAt,
    author: deleted
      ? { id: "", name: "", handle: null, image: null }
      : { id: row.authorId, name: row.authorName, handle: row.authorHandle, image: row.authorImage },
    deleted,
    parentId: row.parentId,
    replyCount: row.replyCount,
    replyTo: !deleted && row.replyToId ? { id: row.replyToId, name: row.replyToName ?? "", handle: row.replyToHandle } : null,
    attachment: stored ? toPublicAttachment(stored) : null,
  };
}

/** `limit + 1` baris dibaca; baris ekstra hanya penanda masih ada halaman berikutnya. */
function commentPage(rows: CommentRow[], limit: number, t: TFunction<"feed">) {
  const page = rows.slice(0, limit);
  return {
    items: page.map((row) => shapeComment(row, t)),
    nextCursor: rows.length > limit ? (page[page.length - 1]?.createdAt.getTime() ?? null) : null,
  };
}

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
          shareMaps: profileTable.shareMaps,
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
      shareMaps: row?.shareMaps ?? true,
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
        shareMaps: z.boolean().optional(),
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
        shareMaps: boolean;
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
      if (input.shareMaps !== undefined) patch.shareMaps = input.shareMaps;
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

      const { meProfile, visibility } = await preparePost(db, me, input.visibility, t, await userZone(context));
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
            // Under a gain plan the check-in compares with where the gain began, so it reads "naik" (never "turun since the old start").
            deltaKg: weightDeltaKg(weight.weightKg, meProfile),
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
      pushNewPost(context as unknown as NotifyContext, {
        postId,
        authorId: me,
        authorName: context.session.user.name,
        title: snapshot.title || input.caption || "",
        visibility,
      });
      return { id: postId, visibility };
    }),

  /** Latihan dari JoyoFit (jam): ringkasan + detail HR/rute opsional di tabel terpisah. */
  createWatchPost: protectedProcedure
    .input(
      z.object({
        workout: z.object({
          sportName: z.string().trim().min(1).max(60),
          startedAt: z.number().int().positive(),
          durationMin: z.number().positive().max(1440),
          kcal: z.number().min(0).nullish(),
          distanceM: z.number().min(0).nullish(),
          avgHr: hrSchema.nullish(),
          maxHr: hrSchema.nullish(),
        }),
        detail: z
          .object({
            hr: z
              .object({
                intervalSec: z.number().int().min(1).max(600),
                bpm: z.array(hrSchema.nullable()).max(600),
              })
              .nullish(),
            route: z
              .array(z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]))
              .max(1000)
              .nullish(),
            analysis: workoutAnalysisSchema.nullish(),
          })
          .optional(),
        caption: z.string().trim().max(STORY_MAX).optional(),
        visibility: visibilitySchema.optional(),
        // "Tampilkan peta": default menyala untuk latihan ber-GPS. Garis yang dibagikan sudah dipotong 200 m.
        showMap: z.boolean().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const t = serverT(context.locale, "feed");
      const me = context.session.user.id;
      const db = context.db;
      const { workout } = input;
      const analysis = input.detail?.analysis ?? null;
      if (
        analysis &&
        (analysis.startedAt !== workout.startedAt ||
          Math.abs(analysis.elapsedSec - workout.durationMin * 60) > 60)
      ) {
        throw new ORPCError("BAD_REQUEST", { message: t("server.error.analysisMismatch") });
      }
      const { visibility } = await preparePost(db, me, input.visibility, t, await userZone(context));

      const hr = input.detail?.hr?.bpm.length ? input.detail.hr : null;
      const route = input.detail?.route?.length ? input.detail.route : null;
      // The only route other people ever get: trimmed, simplified, encoded (lib/feed-route). The author's own
      // full-resolution route stays in post_workout_detail.
      const mapLine = buildFeedMapLine(analysis?.series?.track ?? route);
      const postId = crypto.randomUUID();
      const statements = [
        db.insert(postTable).values({
          id: postId,
          userId: me,
          kind: "latihan",
          caption: input.caption?.length ? input.caption : null,
          visibility,
          title: workout.sportName,
          kcal: workout.kcal ?? null,
          durationMin: workout.durationMin,
          statsJson: JSON.stringify({
            source: "joyofit",
            distanceM: workout.distanceM ?? null,
            avgHr: workout.avgHr ?? null,
            maxHr: workout.maxHr ?? null,
            startedAt: workout.startedAt,
            hasDetail: hr || route || analysis ? 1 : 0,
            sportKind: analysis?.sport.kind ?? sportKindFromName(workout.sportName),
            movingSec: analysis ? Math.round(analysis.movingSec) : null,
            elevGainM: analysis?.elevation ? Math.round(analysis.elevation.gainM) : null,
            ...(mapLine ? { hasMap: 1, showMap: input.showMap === false ? 0 : 1, mapLine } : {}),
          }),
        }),
        ...(hr || route || analysis
          ? [
              db.insert(postWorkoutDetail).values({
                postId,
                hrJson: hr ? JSON.stringify(hr) : null,
                routeJson: route ? JSON.stringify(route) : null,
                analysisJson: analysis ? JSON.stringify(analysis) : null,
              }),
            ]
          : []),
      ];
      await db.batch(statements as [(typeof statements)[0], ...typeof statements]);
      pushNewPost(context as unknown as NotifyContext, {
        postId,
        authorId: me,
        authorName: context.session.user.name,
        title: workout.sportName,
        visibility,
      });
      return { id: postId, visibility };
    }),

  /**
   * Detail HR/rute/analisis pos jam. Penulis selalu boleh; penonton lain cuma kalau Pro,
   * selain itu `locked` (klien menampilkan upsell). JSON rusak jadi null, bukan 500.
   */
  workoutDetail: protectedProcedure
    .input(z.object({ postId: z.string() }))
    .handler(async ({ context, input }) => {
      const t = serverT(context.locale, "feed");
      const me = context.session.user.id;
      const db = context.db;
      const post = await loadVisiblePost(db, input.postId, me, t);
      const [detail] = await db
        .select({
          hrJson: postWorkoutDetail.hrJson,
          routeJson: postWorkoutDetail.routeJson,
          analysisJson: postWorkoutDetail.analysisJson,
        })
        .from(postWorkoutDetail)
        .where(eq(postWorkoutDetail.postId, post.id))
        .limit(1);
      if (!detail) throw new ORPCError("NOT_FOUND", { message: t("server.error.postNotFound") });
      let route = parseJsonOrNull<[number, number][]>(detail.routeJson);
      let analysis = parseStoredAnalysis(detail.analysisJson);
      if (post.userId !== me) {
        const [viewer] = await db
          .select({ tier: user.tier, founderUntil: user.founderUntil })
          .from(user)
          .where(eq(user.id, me))
          .limit(1);
        if (!premiumUnlocked(viewer, paywallConfig(context.env))) {
          return { locked: true, hr: null, route: null, analysis: null };
        }
        // Other people never get the full-resolution track: the route is the shared line (trimmed, simplified) and
        // only when the post and the author's account both allow a map; the analysis loses its per-sample track.
        const stats = parseJson(post.statsJson);
        route = mapAllowed(stats?.showMap, post.authorShareMaps)
          ? (feedMapPoints(typeof stats?.mapLine === "string" ? stats.mapLine : null) as [number, number][] | null)
          : null;
        if (analysis?.series?.track) analysis = { ...analysis, series: { ...analysis.series, track: null } };
      }
      return {
        locked: false,
        hr: parseJsonOrNull<{ intervalSec: number; bpm: (number | null)[] }>(detail.hrJson),
        route,
        analysis,
      };
    }),

  /** The author's per-post "Tampilkan peta" switch (the map itself stays computed at post time). */
  setPostMap: protectedProcedure
    .input(z.object({ postId: z.string(), show: z.boolean() }))
    .handler(async ({ context, input }) => {
      const t = serverT(context.locale, "feed");
      const me = context.session.user.id;
      const [row] = await context.db
        .select({ statsJson: postTable.statsJson })
        .from(postTable)
        .where(and(eq(postTable.id, input.postId), eq(postTable.userId, me), eq(postTable.kind, "latihan")))
        .limit(1);
      const stats = parseJson(row?.statsJson ?? null);
      if (!stats || stats.hasMap !== 1) {
        throw new ORPCError("NOT_FOUND", { message: t("server.error.postNotFound") });
      }
      await context.db
        .update(postTable)
        .set({ statsJson: JSON.stringify({ ...stats, showMap: input.show ? 1 : 0 }) })
        .where(and(eq(postTable.id, input.postId), eq(postTable.userId, me)));
      return { showMap: input.show ? 1 : 0 };
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
      // Foto lampiran komentar di postingan ini ikut hilang bersama baris komentarnya (cascade), jadi kuncinya dibaca dulu.
      const commentRows = row
        ? await context.db
            .select({ userId: postComment.userId, attachmentJson: postComment.attachmentJson })
            .from(postComment)
            .where(and(eq(postComment.postId, input.id), isNotNull(postComment.attachmentJson)))
        : [];
      await context.db
        .delete(postTable)
        .where(and(eq(postTable.id, input.id), eq(postTable.userId, me)));
      // Objek foto pos ikut dihapus; foto lama (photoId milik diary) dibiarkan
      // karena dipakai bersama catatan makanannya.
      const bucket = context.env.STICKERS;
      if (row && bucket) {
        const keys = [
          ...parseStringArray(row.photosJson).map((photoId) => `posts/${me}/${photoId}.jpg`),
          ...commentPhotoKeysOf(commentRows),
        ];
        context.waitUntil(Promise.all(keys.map((key) => bucket.delete(key).catch(() => {}))).then(() => {}));
      }
      return { ok: true };
    }),

  /**
   * Penulis menutup atau membuka komentar postingan sendiri. Idempoten. Komentar yang sudah ada tetap tampil dan
   * bisa dihapus; penulis sendiri masih boleh membalas supaya bisa menutup utas dengan kata terakhir.
   */
  setCommentsOff: protectedProcedure
    .input(z.object({ postId: z.string(), off: z.boolean() }))
    .handler(async ({ context, input }) => {
      const t = serverT(context.locale, "feed");
      const me = context.session.user.id;
      const [row] = await context.db
        .select({ userId: postTable.userId })
        .from(postTable)
        .where(eq(postTable.id, input.postId))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND", { message: t("server.error.postNotFound") });
      if (row.userId !== me) throw new ORPCError("FORBIDDEN", { message: t("server.error.notYourPost") });
      await context.db.update(postTable).set({ commentsOff: input.off }).where(eq(postTable.id, input.postId));
      return { ok: true, commentsOff: input.off };
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
          .where(and(eq(postComment.postId, row.id), isNull(postComment.deletedAt))),
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
          badges: [],
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
        badges: await publicBadges(db, context.env, row.userId),
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
        const fresh = await db
          .insert(socialFollow)
          .values({ followerId: me, followingId: input.userId })
          .onConflictDoNothing()
          .returning({ id: socialFollow.followerId });
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
        if (fresh.length > 0) {
          const [mine] = await db
            .select({ handle: profileTable.handle })
            .from(profileTable)
            .where(eq(profileTable.userId, me))
            .limit(1);
          pushFollow(context as unknown as NotifyContext, {
            recipientId: input.userId,
            actorId: me,
            actorName: context.session.user.name,
            actorHandle: mine?.handle ?? null,
            day: jakartaToday(undefined, await userZone(context)),
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
            row.statsJson,
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

  /** Komentar tingkat atas (urut lama ke baru). Balasan diambil per komentar lewat `commentReplies`. */
  comments: publicProcedure
    .input(
      z.object({
        postId: z.string(),
        cursor: cursorSchema,
        limit: z.number().int().min(1).max(50).default(30),
      }),
    )
    .handler(async ({ context, input }) => {
      const t = serverT(context.locale, "feed");
      const me = context.session?.user.id ?? null;
      await loadVisiblePost(context.db, input.postId, me, t);
      const rows = await loadComments(
        context.db,
        me,
        and(
          eq(postComment.postId, input.postId),
          isNull(postComment.parentId),
          me ? blockedBetweenSql(me, postComment.userId) : undefined,
          input.cursor ? gt(postComment.createdAt, new Date(input.cursor)) : undefined,
        ),
        input.limit + 1,
      );
      return commentPage(rows, input.limit, t);
    }),

  /** Balasan satu komentar tingkat atas, lama ke baru. Id sebuah balasan dipetakan ke komentar tingkat atasnya. */
  commentReplies: publicProcedure
    .input(
      z.object({
        parentId: z.string(),
        cursor: cursorSchema,
        limit: z.number().int().min(1).max(50).default(COMMENT_REPLIES_PAGE),
      }),
    )
    .handler(async ({ context, input }) => {
      const t = serverT(context.locale, "feed");
      const me = context.session?.user.id ?? null;
      const [target] = await context.db
        .select({ id: postComment.id, postId: postComment.postId, parentId: postComment.parentId })
        .from(postComment)
        .where(eq(postComment.id, input.parentId))
        .limit(1);
      if (!target) throw new ORPCError("NOT_FOUND", { message: t("server.error.commentNotFound") });
      await loadVisiblePost(context.db, target.postId, me, t);
      const rows = await loadComments(
        context.db,
        me,
        and(
          eq(postComment.parentId, target.parentId ?? target.id),
          me ? blockedBetweenSql(me, postComment.userId) : undefined,
          input.cursor ? gt(postComment.createdAt, new Date(input.cursor)) : undefined,
        ),
        input.limit + 1,
      );
      return commentPage(rows, input.limit, t);
    }),

  /**
   * Komentar baru atau balasan. `parentId` boleh id komentar mana pun di postingan itu: balasan atas balasan diratakan
   * ke komentar tingkat atasnya dan menyimpan siapa yang dibalas (`replyTo`). Lampiran: satu foto yang diunggah lewat
   * `uploadCommentPhoto`, atau satu item milik pengomentar sendiri (dicuplik saat ini juga).
   */
  addComment: protectedProcedure
    .input(
      z.object({
        postId: z.string(),
        body: z.string().trim().max(COMMENT_MAX).default(""),
        parentId: z.string().optional(),
        attachment: attachmentInputSchema.optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const t = serverT(context.locale, "feed");
      const me = context.session.user.id;
      const db = context.db;
      if (input.body.length === 0 && !input.attachment) {
        throw new ORPCError("BAD_REQUEST", { message: t("server.error.commentEmpty") });
      }
      const dayCount = await countRow(
        db
          .select({ total: count() })
          .from(postComment)
          .where(
            and(eq(postComment.userId, me), gt(postComment.createdAt, new Date(dayStartIn(await userZone(context))))),
          ),
      );
      if (dayCount >= MAX_COMMENTS_PER_DAY) {
        throw new ORPCError("BAD_REQUEST", { message: t("server.error.commentQuota") });
      }
      const row = await loadVisiblePost(db, input.postId, me, t);
      if (row.commentsOff && row.userId !== me) {
        throw new ORPCError("FORBIDDEN", { message: t("server.error.commentsOff") });
      }

      let topLevelId: string | null = null;
      let replyToUserId: string | null = null;
      let target: { userId: string } | null = null;
      if (input.parentId) {
        const [found] = await db
          .select({
            id: postComment.id,
            userId: postComment.userId,
            parentId: postComment.parentId,
            deletedAt: postComment.deletedAt,
          })
          .from(postComment)
          .where(and(eq(postComment.id, input.parentId), eq(postComment.postId, row.id)))
          .limit(1);
        const blocked = found
          ? await countRow(
              db
                .select({ total: count() })
                .from(socialBlock)
                .where(
                  or(
                    and(eq(socialBlock.blockerId, me), eq(socialBlock.blockedId, found.userId)),
                    and(eq(socialBlock.blockerId, found.userId), eq(socialBlock.blockedId, me)),
                  ),
                ),
            )
          : 0;
        if (!found || found.deletedAt || blocked > 0) {
          throw new ORPCError("NOT_FOUND", { message: t("server.error.commentNotFound") });
        }
        topLevelId = found.parentId ?? found.id;
        // Only a reply to a reply names someone; a reply to a top-level comment is already under it.
        replyToUserId = found.parentId && found.userId !== me ? found.userId : null;
        target = { userId: found.userId };
      }

      let stored: StoredAttachment | null = null;
      if (input.attachment?.kind === "image") {
        const bucket = context.env.STICKERS;
        if (!bucket) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", { message: t("server.error.photoStorageUnavailable") });
        }
        const photoId = input.attachment.photoId;
        const found = await bucket.get(commentPhotoKey(me, photoId));
        const used = await countRow(
          db
            .select({ total: count() })
            .from(postComment)
            .where(and(eq(postComment.userId, me), like(postComment.attachmentJson, `%${photoId}%`))),
        );
        if (!found || used > 0) {
          throw new ORPCError("BAD_REQUEST", { message: t("server.error.photoMissing") });
        }
        stored = { kind: "image", title: "", date: null, mapLine: null, hasPhoto: true, stats: {}, photoId };
      } else if (input.attachment) {
        const built = await buildItemAttachment(db, context.env.STICKERS, me, input.attachment.kind, input.attachment.refId, await userZone(context));
        if (!built.ok) {
          throw new ORPCError("NOT_FOUND", {
            message: t(
              built.reason === "mapOff"
                ? "server.error.attachmentMapOff"
                : built.reason === "noRoute"
                  ? "server.error.attachmentNoRoute"
                  : "server.error.attachmentNotFound",
            ),
          });
        }
        stored = built.attachment;
      }

      const commentId = crypto.randomUUID();
      await db.insert(postComment).values({
        id: commentId,
        postId: row.id,
        userId: me,
        body: input.body,
        parentId: topLevelId,
        replyToUserId,
        attachmentJson: stored ? JSON.stringify(stored) : null,
      });

      // Whoever was answered hears about the reply; the post's author hears about the comment unless that is the same person.
      const recipients: { userId: string; kind: "comment" | "reply" }[] = [];
      if (target && target.userId !== me) recipients.push({ userId: target.userId, kind: "reply" });
      if (row.userId !== me && row.userId !== target?.userId) recipients.push({ userId: row.userId, kind: "comment" });
      if (recipients.length > 0) {
        const [actor] = await db.select({ name: user.name }).from(user).where(eq(user.id, me)).limit(1);
        for (const recipient of recipients) {
          await notifyComment(
            context as unknown as NotifyContext,
            row.id,
            row.statsJson,
            commentId,
            recipient.userId,
            me,
            actor?.name ?? "Teman",
            input.body,
            recipient.kind,
          );
        }
      }

      const [created] = await loadComments(db, me, eq(postComment.id, commentId), 1);
      return { id: commentId, parentId: topLevelId, comment: shapeComment(created!, t) };
    }),

  /**
   * Satu foto untuk lampiran komentar. Klien memampatkan ke sisi ~1600px JPEG/WebP; server memeriksa isinya benar gambar
   * dan membuang semua metadata (EXIF/GPS, XMP, IPTC) sebelum menyimpan.
   */
  uploadCommentPhoto: protectedProcedure
    .input(
      z.object({
        imageBase64: z.base64().min(50).max(COMMENT_PHOTO_BASE64_MAX),
        mimeType: z.enum(["image/jpeg", "image/webp"]),
      }),
    )
    .handler(async ({ context, input }) => {
      const t = serverT(context.locale, "feed");
      const me = context.session.user.id;
      const bucket = context.env.STICKERS;
      if (!bucket) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: t("server.error.photoStorageUnavailable") });
      }
      const clean = cleanImage(new Uint8Array(base64ToBytes(input.imageBase64)), input.mimeType);
      if (!clean) throw new ORPCError("BAD_REQUEST", { message: t("server.error.photoInvalid") });
      const photoId = crypto.randomUUID().replaceAll("-", "");
      try {
        await bucket.put(commentPhotoKey(me, photoId), clean.bytes.buffer, {
          httpMetadata: { contentType: input.mimeType },
        });
      } catch {
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: t("server.error.photoSaveFailed") });
      }
      return { photoId };
    }),

  /** Isi menu "Dari aplikasi": item terbaru milik sendiri per jenis. */
  commentAttachables: protectedProcedure
    .input(z.object({ kind: z.enum(ITEM_KINDS) }))
    .handler(async ({ context, input }) => listAttachables(context.db, context.session.user.id, input.kind, await userZone(context))),

  /**
   * Pengomentar boleh hapus miliknya; penulis postingan boleh hapus semua. Komentar yang punya balasan hanya dikosongkan
   * (`hidden`, tampil "komentar dihapus"); selain itu baris dihapus (`removed`).
   */
  deleteComment: protectedProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ context, input }) => {
      const t = serverT(context.locale, "feed");
      const me = context.session.user.id;
      const db = context.db;
      const [comment] = await db
        .select({
          id: postComment.id,
          userId: postComment.userId,
          postId: postComment.postId,
          parentId: postComment.parentId,
          attachmentJson: postComment.attachmentJson,
          deletedAt: postComment.deletedAt,
        })
        .from(postComment)
        .where(eq(postComment.id, input.id))
        .limit(1);
      if (!comment || comment.deletedAt) return { ok: true, mode: "removed" as const };
      const [post] = await db
        .select({ userId: postTable.userId })
        .from(postTable)
        .where(eq(postTable.id, comment.postId))
        .limit(1);
      if (comment.userId !== me && post?.userId !== me) {
        throw new ORPCError("FORBIDDEN", { message: t("server.error.notYourComment") });
      }
      const replies = await countRow(
        db.select({ total: count() }).from(postComment).where(eq(postComment.parentId, comment.id)),
      );
      const mode = replies > 0 ? ("hidden" as const) : ("removed" as const);
      if (mode === "hidden") {
        await db
          .update(postComment)
          .set({ body: "", attachmentJson: null, replyToUserId: null, deletedAt: new Date() })
          .where(eq(postComment.id, comment.id));
      } else {
        await db.delete(postComment).where(eq(postComment.id, comment.id));
        // The last reply of an already-hidden comment takes the placeholder with it.
        if (comment.parentId) {
          const [parent] = await db
            .select({ deletedAt: postComment.deletedAt })
            .from(postComment)
            .where(eq(postComment.id, comment.parentId))
            .limit(1);
          const left = await countRow(
            db.select({ total: count() }).from(postComment).where(eq(postComment.parentId, comment.parentId)),
          );
          if (parent?.deletedAt && left === 0) {
            await db.delete(postComment).where(eq(postComment.id, comment.parentId));
          }
        }
      }
      const bucket = context.env.STICKERS;
      const keys = commentPhotoKeysOf([comment]);
      if (bucket && keys.length > 0) {
        context.waitUntil(Promise.all(keys.map((key) => bucket.delete(key).catch(() => {}))).then(() => {}));
      }
      return { ok: true, mode };
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
        /** A profile report (a member, not one of their posts). */
        userId: z.string().optional(),
        /** The app the report comes from; the admin Reports page tags it. */
        source: z.enum(["joyorogo", "joyofit"]).default("joyorogo"),
        reason: z.enum(["spam", "kasar", "salah_info", "lainnya"]),
        note: z.string().trim().max(NOTE_MAX).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const t = serverT(context.locale, "feed");
      if ([input.postId, input.commentId, input.userId].filter(Boolean).length !== 1) {
        throw new ORPCError("BAD_REQUEST", { message: t("server.error.reportOne") });
      }
      const me = context.session.user.id;
      if (input.userId === me) {
        throw new ORPCError("BAD_REQUEST", { message: t("server.error.reportSelf") });
      }
      const dayCount = await countRow(
        context.db
          .select({ total: count() })
          .from(socialReport)
          .where(and(eq(socialReport.reporterId, me), gt(socialReport.createdAt, new Date(dayStartIn(await userZone(context)))))),
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
      } else if (input.userId) {
        const [member] = await context.db
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, input.userId))
          .limit(1);
        if (!member) throw new ORPCError("NOT_FOUND", { message: t("server.error.profileNotFound") });
      }
      await context.db.insert(socialReport).values({
        id: crypto.randomUUID(),
        reporterId: me,
        postId: input.postId ?? null,
        commentId: input.commentId ?? null,
        userId: input.userId ?? null,
        source: input.source,
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
      const userId = context.session.user.id;
      const readAt = new Date();
      if (!input.ids?.length) {
        await context.db.update(socialNotification).set({ readAt }).where(eq(socialNotification.userId, userId));
        return { ok: true };
      }
      // `ids` is caller-sized: one UPDATE per slice (userId and readAt are bound too), all in one atomic batch.
      const [first, ...rest] = chunk(input.ids, D1_MAX_PARAMS - 2).map((ids) =>
        context.db
          .update(socialNotification)
          .set({ readAt })
          .where(and(eq(socialNotification.userId, userId), inArray(socialNotification.id, ids))),
      );
      await context.db.batch([first!, ...rest]);
      return { ok: true };
    }),
};
