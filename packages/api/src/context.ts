import type { AuthSession } from "@joyorogo/auth";
import type { Database } from "@joyorogo/db";
import type { Locale } from "@joyorogo/i18n";
import type { RateLimitBinding } from "./lib/group-preview";
import type { ImagesBinding, StickersBucket } from "./lib/sticker";
import type { ShadowEnv } from "./lib/shadow-scan";
import type { PaywallEnv } from "./lib/tiers";

/** Minimal Workers AI surface — keeps this package usable outside Workers. */
export type AiBinding = {
  run(model: string, input: unknown): Promise<unknown>;
};

/** Worker bindings the API layer may read. All optional: features degrade loudly. */
export type ApiEnv = PaywallEnv & ShadowEnv & {
  AI?: AiBinding;
  AI_VISION_MODEL?: string;
  /** Text model for ai.correctScan; unset = the vision model (Gemma 4, thinking off). */
  AI_CORRECT_MODEL?: string;
  /** Model for coach.chat; unset = AI_CORRECT_MODEL, else the vision model (thinking off). */
  AI_COACH_MODEL?: string;
  /** Model for the weekly reflection (stats.generateWeekReflection); unset = the vision model (Gemma 4, thinking off). */
  AI_RECAP_MODEL?: string;
  /** Coach chat messages per user per WIB day (default 20); "0" turns the chat off. See docs/coach.md. */
  COACH_DAILY_CAP?: string;
  /**
   * Comma-separated user ids whose scans are kept as an internal accuracy dataset
   * (R2 dataset/<userId>/<scanId>/, see lib/dataset.ts). Unset or empty = nobody.
   */
  DATASET_USER_IDS?: string;
  /**
   * Comma-separated user ids that get "Porsi kebiasaanmu" on photo scans: items start at
   * their usual weighed portion, the model's number one tap away (lib/portion-prior.ts).
   * Unset or empty = nobody, and scans are answered exactly as before.
   */
  PORTION_PRIOR_USER_IDS?: string;
  /**
   * Comma-separated user ids that get "Piring saya": registered plates and bowls whose sizes scale the
   * photo scan's portions (lib/dishware.ts, docs/dishware.md). Unset or empty = nobody, and scans are
   * answered exactly as before.
   */
  DISHWARE_USER_IDS?: string;
  /**
   * Comma-separated user ids that get the kitchen-scale readout on photo scans: a scale
   * display in the photo is read and its grams replace the model's estimate
   * (lib/scale-reading.ts). Unset or empty = nobody, and scans are answered exactly as before.
   */
  SCALE_READOUT_USER_IDS?: string;
  /** USDA FoodData Central key (api.data.gov): enables the USDA barcode source; unset = not asked. */
  USDA_FDC_API_KEY?: string;
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
  /** Expo Push Service (JoyoRogo native + JoyoFit): optional access token (only needed with enhanced push security) and a test endpoint override. */
  EXPO_ACCESS_TOKEN?: string;
  EXPO_PUSH_URL?: string;
  /** Sign in with Apple revocation on account deletion (.p8 key, PKCS8 PEM). */
  APPLE_TEAM_ID?: string;
  APPLE_SIWA_KEY_ID?: string;
  APPLE_SIWA_PRIVATE_KEY?: string;
  APPLE_BUNDLE_ID?: string;
  /** Workers Rate Limiting binding for the public invite preview; unset = no limit. */
  INVITE_PREVIEW_LIMITER?: RateLimitBinding;
  /** Public origin of the API (also the OAuth issuer origin); the MCP connector address is derived from it. */
  BETTER_AUTH_URL?: string;
};

export type Context = {
  auth: null;
  session: AuthSession;
  db: Database;
  env: ApiEnv;
  /** Caller IP (CF-Connecting-IP) for per-client limits; null when unknown. */
  clientIp: string | null;
  /**
   * Language the caller renders in (x-locale header, else `id`).
   * Use it for every user-facing string the request produces.
   */
  locale: Locale;
  /** Keeps background work (sticker cutouts) alive after the response. */
  waitUntil: (promise: Promise<unknown>) => void;
  /**
   * Date.now() when the worker began building this context. Handlers subtract
   * it from their own start to see how long auth and the body upload took
   * (scan timing breakdown); unset in tests.
   */
  requestStartedAt?: number;
};
