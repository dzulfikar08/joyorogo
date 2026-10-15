import type { AuthSession } from "@joyorogo/auth";
import type { Database } from "@joyorogo/db";
import type { RateLimitBinding } from "./lib/group-preview";
import type { ImagesBinding, StickersBucket } from "./lib/sticker";
import type { PaywallEnv } from "./lib/tiers";

/** Minimal Workers AI surface — keeps this package usable outside Workers. */
export type AiBinding = {
  run(model: string, input: unknown): Promise<unknown>;
};

/** Worker bindings the API layer may read. All optional: features degrade loudly. */
export type ApiEnv = PaywallEnv & {
  AI?: AiBinding;
  AI_VISION_MODEL?: string;
  STRAVA_CLIENT_ID?: string;
  STRAVA_CLIENT_SECRET?: string;
  /** Images binding for dish sticker cutouts (BiRefNet segmentation). */
  IMAGES?: ImagesBinding;
  /** R2 bucket storing the generated cutout PNGs. */
  STICKERS?: StickersBucket;
  /**
   * "0" keeps only the quick sticker (a crop of the whole-photo cutout) and skips
   * the per-box refinement, which saves one segmentation per item. Default: refine.
   */
  STICKER_REFINE?: string;
  /** Web Push (puasa intermiten): reminders stay off until all three are set. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  /** Workers Rate Limiting binding for the public invite preview; unset = no limit. */
  INVITE_PREVIEW_LIMITER?: RateLimitBinding;
};

export type Context = {
  auth: null;
  session: AuthSession;
  db: Database;
  env: ApiEnv;
  /** Caller IP (CF-Connecting-IP) for per-client limits; null when unknown. */
  clientIp: string | null;
  /** Keeps background work (sticker cutouts) alive after the response. */
  waitUntil: (promise: Promise<unknown>) => void;
};
