// Social feed types, mirroring the JSON contract in
// packages/api/src/routers/social.ts (authoritative; the API package does not
// export named item types, so the native app names its own mirror here).

// Must stay named `ENV`: varlock's babel plugin only inlines `ENV.X` reads;
// anything else hits the runtime proxy, which throws in release builds.
import { ENV } from "../env";

export type Visibility = "publik" | "grup";
export type PostKind = "makan" | "latihan" | "berat";

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
  macros?:
    | { protein: number | null; carbs: number | null; fat: number | null; fiber: number | null }
    | undefined;
  stats?: Record<string, number | string | null> | undefined;
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
  kind: "kudos" | "comment" | "follow";
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

export type FeedComment = {
  id: string;
  body: string;
  createdAt: Date;
  author: FeedAuthor;
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
 * The caller adds the session cookie on native.
 */
export function postPhotoUrl(postId: string): string {
  return `${ENV.EXPO_PUBLIC_SERVER_URL}/post-photo/${postId}`;
}

export const KIND_META: Record<
  PostKind,
  { icon: string; outline: string; label: string; tint: "makan" | "bakar" | "tidur" }
> = {
  makan: { icon: "restaurant", outline: "restaurant-outline", label: "Makan", tint: "makan" },
  latihan: { icon: "barbell", outline: "barbell-outline", label: "Latihan", tint: "bakar" },
  berat: { icon: "scale", outline: "scale-outline", label: "Berat", tint: "tidur" },
};

export const HANDLE_REGEX = /^[a-z0-9_]{3,20}$/;

/** Human labels for the report reasons. */
export const REPORT_REASONS = [
  { value: "spam", label: "Spam" },
  { value: "kasar", label: "Bahasa kasar" },
  { value: "salah_info", label: "Informasi menyesatkan" },
  { value: "lainnya", label: "Lainnya" },
] as const;
