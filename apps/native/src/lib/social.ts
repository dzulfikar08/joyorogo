// Social feed types, mirroring the JSON contract in
// packages/api/src/routers/social.ts (authoritative; the API package does not
// export named item types, so the native app names its own mirror here).

// Must stay named `ENV`: varlock's babel plugin only inlines `ENV.X` reads;
// anything else hits the runtime proxy, which throws in release builds.
import { ENV } from "../env";
import { i18n } from "@joyorogo/i18n";

export type Visibility = "publik" | "grup";
export type PostKind = "makan" | "latihan" | "berat" | "cerita";

export type FeedAuthor = {
  id: string;
  name: string;
  handle: string | null;
  image: string | null;
};

export type FeedItem = {
  id: string;
  kind: PostKind;
  title: string;
  kcal: number | null;
  durationMin: number | null;
  photoId: string | null;
  scanId: string | null;
  /** Jumlah foto yang bisa dirender: grid 'cerita', atau 1 utk foto makanan. */
  photoCount: number;
  macros?:
    | { protein: number | null; carbs: number | null; fat: number | null; fiber: number | null }
    | undefined;
  stats?: Record<string, number | string | null> | undefined;
  /** Encoded polyline (precision 5) of a JoyoFit workout's shared route; absent when no map is shown. */
  mapLine?: string | undefined;
  caption: string | null;
  visibility: Visibility;
  createdAt: Date;
  author: FeedAuthor;
  kudosCount: number;
  commentCount: number;
  kudosByMe?: boolean;
};

export type ProfileSummary = {
  handle: string | null;
  bio: string | null;
  publicProfile: boolean;
  defaultVisibility: Visibility;
  followerCount: number;
  followingCount: number;
  postCount: number;
};

export type NotificationItem = {
  id: string;
  kind: "kudos" | "comment" | "reply" | "follow";
  excerpt: string | null;
  createdAt: Date;
  readAt: Date | null;
  postId: string | null;
  postTitle: string | null;
  postKind: PostKind | null;
  actorId: string;
  actorName: string;
  actorImage: string | null;
  actorHandle: string | null;
};

/** Kinds of the commenter's own items a comment can carry, next to an uploaded photo. */
export type CommentItemKind = "workout" | "food" | "weight" | "recap" | "route";

/** What a comment carries besides text; contract: docs/social-comments.md. */
export type CommentAttachment = {
  kind: "image" | CommentItemKind;
  /** The item's own name; '' for image, weight and recap (the card titles itself). */
  title: string;
  /** WIB day of the item, 'YYYY-MM-DD'. */
  date: string | null;
  /** Encoded polyline of a route, already trimmed server-side. */
  mapLine: string | null;
  /** True when GET /comment-photo/{commentId} serves an image (the photo, or an attached meal's photo). */
  hasPhoto: boolean;
  stats: Record<string, number | string | null>;
};

/** One comment: top-level (`parentId` null) or a reply. A hidden one (`deleted`) is a placeholder. */
export type FeedComment = {
  id: string;
  body: string;
  createdAt: Date;
  author: FeedAuthor;
  deleted: boolean;
  parentId: string | null;
  /** Visible replies under a top-level comment; 0 for replies. */
  replyCount: number;
  /** Who a reply to a reply answers; shown as "@handle" before the text. */
  replyTo: { id: string; name: string; handle: string | null } | null;
  attachment: CommentAttachment | null;
};

/** One own item the "Dari aplikasi" picker offers. */
export type CommentAttachable = {
  kind: CommentItemKind;
  refId: string;
  /** The owner's own diary photo id; null when there is none. */
  photoId: string | null;
  preview: CommentAttachment;
};

export type PublicProfileResult = {
  userId: string;
  name: string;
  handle: string | null;
  image: string | null;
  bio: string | null;
  publicProfile: boolean;
  isSelf: boolean;
  isFollowing: boolean | null;
  blocked: boolean;
  stats: { postCount: number; followerCount: number; followingCount: number } | null;
  posts: { items: FeedItem[]; nextCursor: number | null };
};

export type PersonSummary = {
  id: string;
  name: string;
  image: string | null;
  handle: string | null;
};

/** Sticker scan URLs are public capability URLs. */
export function postStickerUrl(scanId: string): string {
  return `${ENV.EXPO_PUBLIC_SERVER_URL}/sticker/${scanId}`;
}

/**
 * Feed post photos are served per-post visibility, so the card always loads
 * through /post-photo/{postId} (never the private per-user /photo/{photoId}).
 * Photos of a 'cerita' post append /{index} (0-3).
 * The caller adds the session cookie on native.
 */
export function postPhotoUrl(postId: string, index?: number): string {
  const suffix = index === undefined ? "" : `/${index}`;
  return `${ENV.EXPO_PUBLIC_SERVER_URL}/post-photo/${postId}${suffix}`;
}

/** Photo of a comment attachment (an uploaded photo, or an attached meal's photo); the caller adds the session cookie. */
export function commentPhotoUrl(commentId: string): string {
  return `${ENV.EXPO_PUBLIC_SERVER_URL}/comment-photo/${commentId}`;
}

/** `label` is a getter so it follows the active language at read time. */
export const KIND_META: Record<
  PostKind,
  { icon: string; outline: string; label: string; tint: "makan" | "bakar" | "tidur" }
> = {
  makan: {
    icon: "restaurant",
    outline: "restaurant-outline",
    get label() {
      return i18n.t("feed:kind.makan");
    },
    tint: "makan",
  },
  latihan: {
    icon: "barbell",
    outline: "barbell-outline",
    get label() {
      return i18n.t("feed:kind.latihan");
    },
    tint: "bakar",
  },
  berat: {
    icon: "scale",
    outline: "scale-outline",
    get label() {
      return i18n.t("feed:kind.berat");
    },
    tint: "tidur",
  },
  cerita: {
    icon: "chatbubble-ellipses",
    outline: "chatbubble-ellipses-outline",
    get label() {
      return i18n.t("feed:kind.cerita");
    },
    tint: "makan",
  },
};

export const HANDLE_REGEX = /^[a-z0-9_]{3,20}$/;

/** Report reasons; labels are `feed:report.reason.<value>`. */
export const REPORT_REASONS = ["spam", "kasar", "salah_info", "lainnya"] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];
