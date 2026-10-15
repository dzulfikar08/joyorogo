import type { ServerEnv } from "@joyorogo/infra/alchemy.run";
import type { ImagesBinding, R2Bucket, SendEmail } from "@cloudflare/workers-types";
import type { RateLimitBinding } from "@joyorogo/api/lib/group-preview";

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
      // Per-IP budget for the public invite preview; unset = no limit.
      INVITE_PREVIEW_LIMITER?: RateLimitBinding;
      // Per-IP budget for review-login password guesses; unset = no limit.
      REVIEW_LOGIN_LIMITER?: RateLimitBinding;
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
      REVIEW_LOGIN_EMAILS?: string;
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
      APPLE_TEAM_ID?: string;
      APPLE_SIWA_KEY_ID?: string;
      APPLE_SIWA_PRIVATE_KEY?: string;
      APPLE_FOUNDER_PRODUCT_ID?: string;
      APPLE_FOUNDER_YEARLY_PRODUCT_ID?: string;
      APPLE_SANDBOX_EMAILS?: string;
      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?: string;
      GOOGLE_PLAY_PACKAGE_NAME?: string;
      GOOGLE_PLAY_TEST_EMAILS?: string;
      GOOGLE_PLAY_RTDN_PUSH_EMAIL?: string;
      GOOGLE_PLAY_RTDN_TOKEN?: string;
      VAPID_PUBLIC_KEY?: string;
      VAPID_PRIVATE_KEY?: string;
      VAPID_SUBJECT?: string;
    }
  }
}
