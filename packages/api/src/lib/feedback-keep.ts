// Opt-in photo keep on negative scan feedback. Only when the user rates a scan
// "kurang akurat" or "salah" AND ticks "Boleh simpan foto ini untuk bantu
// memperbaiki AI", the photo moves out of the expiring scan-src/ prefix:
//
//   feedback/<userId>/<photoId>/photo.jpg   the photo the model saw
//   feedback/<userId>/<photoId>/meta.json   AI items, saved items (filled in when
//                                           the user saves later), rating, reasons, note
//
// <photoId> is the scan session id, the same as scan_feedback.photo_id. Used
// only to test and improve the AI; deleted on request and with the account
// (deleteUserMedia). Bookkeeping: failures are logged, never thrown.
import type { CompactItem } from "./scan-outcome";
import { scanSrcKey } from "./sticker";
import type { StickersBucket } from "./sticker";

export const FEEDBACK_PREFIX = "feedback/";

export function feedbackPrefix(userId: string): string {
  return `${FEEDBACK_PREFIX}${userId}/`;
}

export function feedbackPhotoKey(userId: string, photoId: string): string {
  return `${feedbackPrefix(userId)}${photoId}/photo.jpg`;
}

export function feedbackMetaKey(userId: string, photoId: string): string {
  return `${feedbackPrefix(userId)}${photoId}/meta.json`;
}

export type FeedbackKeepMeta = {
  version: 1;
  photoId: string;
  userId: string;
  createdAt: string;
  source: "web" | "native";
  model?: string;
  rating: "kurang_akurat" | "salah";
  reasons: string[];
  note?: string;
  afterRetry: boolean;
  aiItems: CompactItem[];
  retryItems?: CompactItem[];
  savedItems?: CompactItem[];
  savedAt?: number;
};

const json = { httpMetadata: { contentType: "application/json" } };

/**
 * Copies the scan photo out of scan-src/ and writes its meta. Returns false
 * when the photo is already gone (expired); the consent is still recorded on
 * the feedback row, there is just nothing to keep.
 */
export async function keepFeedbackPhoto(
  bucket: StickersBucket,
  meta: FeedbackKeepMeta,
): Promise<boolean> {
  try {
    const photo = await bucket.get(scanSrcKey(meta.userId, meta.photoId));
    if (!photo) return false;
    await bucket.put(feedbackPhotoKey(meta.userId, meta.photoId), await photo.arrayBuffer(), {
      httpMetadata: { contentType: photo.httpMetadata?.contentType ?? "image/jpeg" },
    });
    await bucket.put(feedbackMetaKey(meta.userId, meta.photoId), JSON.stringify(meta), json);
    return true;
  } catch (error) {
    console.error("[feedback-keep] keep failed", error);
    return false;
  }
}

/** The diary save of a kept scan: add what the user finally saved to its meta. */
export async function recordKeptSaved(
  bucket: StickersBucket,
  userId: string,
  photoId: string,
  saved: { items: CompactItem[]; at: number },
): Promise<void> {
  try {
    const key = feedbackMetaKey(userId, photoId);
    const object = await bucket.get(key);
    if (!object) return;
    const meta = JSON.parse(new TextDecoder().decode(await object.arrayBuffer())) as FeedbackKeepMeta;
    meta.savedItems = saved.items;
    meta.savedAt = saved.at;
    await bucket.put(key, JSON.stringify(meta), json);
  } catch (error) {
    console.error("[feedback-keep] final failed", error);
  }
}
