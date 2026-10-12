import type { AuthSession } from "@joyorogo/auth";
import type { Database } from "@joyorogo/db";
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
};

export type Context = {
  auth: null;
  session: AuthSession;
  db: Database;
  env: ApiEnv;
};
