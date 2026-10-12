import type { ServerEnv } from "@joyorogo/infra/alchemy.run";
import type { R2Bucket } from "@cloudflare/workers-types";
import type { ImagesBinding } from "@cloudflare/workers-types";

// This file infers types for the cloudflare:workers environment from your Alchemy Worker.
// @see https://alchemy.run/cloudflare/compute/workers

export type CloudflareEnv = ServerEnv;

declare global {
  type Env = CloudflareEnv;
}

declare module "cloudflare:workers" {
  namespace Cloudflare {
    export interface Env extends CloudflareEnv {
      DOWNLOADS: R2Bucket;
      STICKERS: R2Bucket;
      IMAGES: ImagesBinding;
      // Wrangler-deployed vars/secrets (see .env.schema); unset = feature off.
      APP_URL?: string;
      FREE_DAILY_SCANS?: string;
      FOUNDER_DAILY_CAP?: string;
      ANON_SCANS?: string;
      FOUNDER_PRICE_IDR?: string;
      DOKU_CLIENT_ID?: string;
      DOKU_SECRET_KEY?: string;
      DOKU_BASE_URL?: string;
    }
  }
}
