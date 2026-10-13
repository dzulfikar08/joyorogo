import type { ServerEnv } from "@joyorogo/infra/alchemy.run";
import type { ImagesBinding, R2Bucket, SendEmail } from "@cloudflare/workers-types";

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
      // Optional Cloudflare Email Service binding; unset = email off.
      EMAIL?: SendEmail;
      // Wrangler-deployed vars/secrets (see .env.schema); unset = feature off.
      APP_URL?: string;
      FREE_DAILY_SCANS?: string;
      FOUNDER_DAILY_CAP?: string;
      ANON_SCANS?: string;
      FOUNDER_PRICE_IDR?: string;
      FOUNDER_YEARLY_PRICE_IDR?: string;
      FOUNDER_PRICE_LADDER?: string;
      ADMIN_EMAILS?: string;
      EMAIL_FROM?: string;
      EMAIL_FROM_NAME?: string;
      EMAIL_REPLY_TO?: string;
      BILLING_PROVIDER?: string;
      DOKU_CLIENT_ID?: string;
      DOKU_SECRET_KEY?: string;
      DOKU_BASE_URL?: string;
      PAKASIR_SLUG?: string;
      PAKASIR_API_KEY?: string;
      PAKASIR_WEBHOOK_SECRET?: string;
      PAKASIR_SANDBOX?: string;
      APPLE_BUNDLE_ID?: string;
      APPLE_FOUNDER_PRODUCT_ID?: string;
      APPLE_SANDBOX_EMAILS?: string;
      VAPID_PUBLIC_KEY?: string;
      VAPID_PRIVATE_KEY?: string;
      VAPID_SUBJECT?: string;
    }
  }
}
