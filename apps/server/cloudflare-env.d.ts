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
      // Per-user budget of MCP tool calls per minute; unset = no per-minute limit.
      MCP_LIMITER?: RateLimitBinding;
      // Per-IP budget of dynamic OAuth client registrations; unset = no limit.
      OAUTH_REGISTER_LIMITER?: RateLimitBinding;
      // Optional Cloudflare Email Service binding; unset = email off.
      EMAIL?: SendEmail;
      // Wrangler-deployed vars/secrets (see .env.schema); unset = feature off.
      APP_URL?: string;
      // Origin of the landing/marketing site; unset = APP_URL (single-host deploys).
      SITE_URL?: string;
      // Origin of the JoyoFit cloud API the web app's /api/fit/* routes forward to (default https://api.fit.joyorogo.com).
      JOYOFIT_API_URL?: string;
      FREE_DAILY_SCANS?: string;
      COACH_DAILY_CAP?: string;
      AI_COACH_MODEL?: string;
      JOYO_AI_DAILY_CAP?: string;
      AI_JOYO_MODEL?: string;
      AI_RECAP_MODEL?: string;
      FOUNDER_DAILY_CAP?: string;
      ANON_SCANS?: string;
      FOUNDER_PRICE_IDR?: string;
      FOUNDER_YEARLY_PRICE_IDR?: string;
      FOUNDER_PRICE_LADDER?: string;
      ADMIN_EMAILS?: string;
      DATASET_USER_IDS?: string;
      DISHWARE_USER_IDS?: string;
      CORRECTION_MEMORY_USER_IDS?: string;
      SCALE_READOUT_USER_IDS?: string;
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
      POLAR_ACCESS_TOKEN?: string;
      POLAR_WEBHOOK_SECRET?: string;
      POLAR_SERVER?: string;
      POLAR_PRODUCT_MONTHLY_ID?: string;
      POLAR_PRODUCT_YEARLY_ID?: string;
      POLAR_PRICE_MONTHLY_USD_CENTS?: string;
      POLAR_PRICE_YEARLY_USD_CENTS?: string;
      POLAR_PRICE_MONTHLY_MYR_SEN?: string;
      POLAR_PRICE_YEARLY_MYR_SEN?: string;
      POLAR_PRICE_MONTHLY_SGD_CENTS?: string;
      POLAR_PRICE_YEARLY_SGD_CENTS?: string;
      APPLE_BUNDLE_ID?: string;
      APPLE_TEAM_ID?: string;
      APPLE_SIWA_KEY_ID?: string;
      APPLE_SIWA_PRIVATE_KEY?: string;
      APPLE_SANDBOX_EMAILS?: string;
      TESTFLIGHT_PURCHASE_EMAIL?: string;
      // MCP tool calls per account per rolling 24 hours; empty = 1000.
      MCP_DAILY_CAP?: string;
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
