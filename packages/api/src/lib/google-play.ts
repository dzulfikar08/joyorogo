import { z } from "zod";

import { nextFounderUntil } from "./tiers";
import type { FounderPlan } from "./tiers";

// Google Play Billing, server side: service-account auth, the Android
// Publisher API calls we need (purchases.subscriptionsv2.get, subscriptions
// acknowledge) and Pub/Sub push authentication. WebCrypto + fetch only, so it
// runs on Cloudflare Workers. The Play Console products are the subscription
// `pro` with base plans `monthly` and `yearly`.

export const DEFAULT_GOOGLE_PLAY_PACKAGE = "com.joyodigitama.joyorogo";
export const GOOGLE_PRO_PRODUCT_ID = "pro";
/** Base plan id -> Founder plan it sells. */
export const GOOGLE_BASE_PLANS: Record<string, FounderPlan> = {
  monthly: "monthly",
  yearly: "yearly",
};

const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const PUBLISHER_BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";
const PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const DAY_MS = 24 * 60 * 60 * 1000;

export type GooglePlayEnv = {
  /** Service account key JSON (Play Console API access). Unset = Play billing off. */
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?: string;
  /** Defaults to com.joyodigitama.joyorogo. */
  GOOGLE_PLAY_PACKAGE_NAME?: string;
  /** Emails (comma separated) whose Play test purchases credit full periods. */
  GOOGLE_PLAY_TEST_EMAILS?: string;
  /** Pub/Sub push service account email; enables Google-signed JWT auth on the RTDN endpoint. */
  GOOGLE_PLAY_RTDN_PUSH_EMAIL?: string;
  /** Shared token for the RTDN endpoint (`?token=`), the alternative to the JWT. */
  GOOGLE_PLAY_RTDN_TOKEN?: string;
};

export type GooglePlayConfig = {
  clientEmail: string;
  privateKeyPem: string;
  tokenUri: string;
  packageName: string;
  testEmails: string[];
  pushEmail: string | null;
  pushToken: string | null;
};

const serviceAccountSchema = z.object({
  client_email: z.string().min(1),
  private_key: z.string().min(1),
  token_uri: z.string().url().optional(),
});

/** null when the service account is unset or unusable: Play billing reports unavailable. */
export function googlePlayConfig(env: GooglePlayEnv): GooglePlayConfig | null {
  const raw = env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const account = serviceAccountSchema.safeParse(json);
  if (!account.success) return null;
  const tokenUri = account.data.token_uri ?? DEFAULT_TOKEN_URI;
  if (!tokenUri.startsWith("https://")) return null;
  return {
    clientEmail: account.data.client_email,
    privateKeyPem: account.data.private_key,
    tokenUri,
    packageName: env.GOOGLE_PLAY_PACKAGE_NAME?.trim() || DEFAULT_GOOGLE_PLAY_PACKAGE,
    testEmails: (env.GOOGLE_PLAY_TEST_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
    pushEmail: env.GOOGLE_PLAY_RTDN_PUSH_EMAIL?.trim() || null,
    pushToken: env.GOOGLE_PLAY_RTDN_TOKEN?.trim() || null,
  };
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): Uint8Array {
  const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function pemToDer(pem: string): Uint8Array {
  // Secrets are sometimes stored with literal "\n" sequences.
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

/** RS256 JWT bearer assertion for the service account's OAuth token request. */
export async function buildServiceAccountAssertion(
  config: Pick<GooglePlayConfig, "clientEmail" | "privateKeyPem" | "tokenUri">,
  nowMs: number,
): Promise<string> {
  const enc = new TextEncoder();
  const iat = Math.floor(nowMs / 1000);
  const claims = {
    iss: config.clientEmail,
    scope: PUBLISHER_SCOPE,
    aud: config.tokenUri,
    iat,
    exp: iat + 3600,
  };
  const signingInput = `${b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })))}.${b64url(
    enc.encode(JSON.stringify(claims)),
  )}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(config.privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(signingInput)),
  );
  return `${signingInput}.${b64url(signature)}`;
}

export type GoogleSubscriptionState =
  | "pending"
  | "active"
  | "canceled"
  | "grace"
  | "hold"
  | "paused"
  | "expired"
  | "pending_canceled"
  | "unspecified";

const STATE_BY_API: Record<string, GoogleSubscriptionState> = {
  SUBSCRIPTION_STATE_PENDING: "pending",
  SUBSCRIPTION_STATE_ACTIVE: "active",
  SUBSCRIPTION_STATE_CANCELED: "canceled",
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD: "grace",
  SUBSCRIPTION_STATE_ON_HOLD: "hold",
  SUBSCRIPTION_STATE_PAUSED: "paused",
  SUBSCRIPTION_STATE_EXPIRED: "expired",
  SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED: "pending_canceled",
};

/** Fields of SubscriptionPurchaseV2 that the credit decision reads, normalized. */
export type GoogleSubscription = {
  state: GoogleSubscriptionState;
  /** Play wants an acknowledge within 3 days or it refunds the purchase. */
  acknowledged: boolean;
  /** License-tester purchase (not charged). */
  test: boolean;
  /** obfuscatedAccountId the app passed at purchase time, when present. */
  accountId: string | null;
  productId: string;
  basePlanId: string | null;
  expiresAt: Date | null;
  /** Latest order that was actually charged (renewals get a `..N` suffix). */
  orderId: string | null;
  /** Recurring price when Play bills in IDR; null for other currencies. */
  priceIdr: number | null;
};

const moneySchema = z.object({
  currencyCode: z.string(),
  units: z.string().optional(),
  nanos: z.number().optional(),
});

const subscriptionSchema = z.object({
  subscriptionState: z.string().optional(),
  latestOrderId: z.string().optional(),
  acknowledgementState: z.string().optional(),
  testPurchase: z.object({}).passthrough().optional(),
  externalAccountIdentifiers: z
    .object({ obfuscatedExternalAccountId: z.string().optional() })
    .passthrough()
    .optional(),
  lineItems: z
    .array(
      z.object({
        productId: z.string(),
        expiryTime: z.string().optional(),
        latestSuccessfulOrderId: z.string().optional(),
        autoRenewingPlan: z
          .object({ recurringPrice: moneySchema.optional() })
          .passthrough()
          .optional(),
        offerDetails: z.object({ basePlanId: z.string().optional() }).passthrough().optional(),
      }),
    )
    .default([]),
});

function parseSubscription(json: unknown): GoogleSubscription | null {
  const parsed = subscriptionSchema.safeParse(json);
  if (!parsed.success) return null;
  const data = parsed.data;
  const item =
    data.lineItems.find((line) => line.productId === GOOGLE_PRO_PRODUCT_ID) ?? data.lineItems[0];
  if (!item) return null;
  const price = item.autoRenewingPlan?.recurringPrice;
  const priceIdr =
    price?.currencyCode === "IDR"
      ? Math.round(Number(price.units ?? 0) + (price.nanos ?? 0) / 1e9)
      : null;
  const expiry = item.expiryTime ? new Date(item.expiryTime) : null;
  return {
    state: STATE_BY_API[data.subscriptionState ?? ""] ?? "unspecified",
    acknowledged: data.acknowledgementState !== "ACKNOWLEDGEMENT_STATE_PENDING",
    test: data.testPurchase !== undefined,
    accountId: data.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null,
    productId: item.productId,
    basePlanId: item.offerDetails?.basePlanId ?? null,
    expiresAt: expiry && Number.isFinite(expiry.getTime()) ? expiry : null,
    orderId: item.latestSuccessfulOrderId ?? data.latestOrderId ?? null,
    priceIdr: priceIdr !== null && Number.isFinite(priceIdr) && priceIdr > 0 ? priceIdr : null,
  };
}

/** The two Android Publisher calls the credit flow needs. Tests substitute a fake. */
export type GooglePlayClient = {
  /** null = Play does not know this token (bad, foreign-app, or long-expired). Throws on outages. */
  getSubscription(purchaseToken: string): Promise<GoogleSubscription | null>;
  acknowledge(productId: string, purchaseToken: string): Promise<void>;
};

/**
 * Android Publisher client for one service account. Keeps the OAuth access
 * token in memory until a minute before it expires.
 */
export function createGooglePlayClient(
  config: Pick<GooglePlayConfig, "clientEmail" | "privateKeyPem" | "tokenUri" | "packageName">,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): GooglePlayClient {
  let cached: { token: string; expiresAt: number } | null = null;

  const accessToken = async (): Promise<string> => {
    if (cached && cached.expiresAt > now() + 60_000) return cached.token;
    const assertion = await buildServiceAccountAssertion(config, now());
    const res = await fetchImpl(config.tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    });
    const body = (await res.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
    } | null;
    if (!res.ok || !body?.access_token) {
      throw new Error(`google oauth ${res.status}`);
    }
    cached = { token: body.access_token, expiresAt: now() + (body.expires_in ?? 3600) * 1000 };
    return cached.token;
  };

  const call = async (path: string, init: RequestInit = {}): Promise<Response> =>
    fetchImpl(`${PUBLISHER_BASE}/${encodeURIComponent(config.packageName)}/${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${await accessToken()}`,
      },
    });

  return {
    async getSubscription(purchaseToken) {
      const res = await call(
        `purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
      );
      // 400 = malformed or other-app token, 404 = unknown, 410 = purchase gone.
      if (res.status === 400 || res.status === 404 || res.status === 410) return null;
      if (!res.ok) throw new Error(`google subscriptionsv2.get ${res.status}`);
      return parseSubscription(await res.json().catch(() => null));
    },
    async acknowledge(productId, purchaseToken) {
      const res = await call(
        `purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      if (!res.ok) throw new Error(`google subscriptions.acknowledge ${res.status}`);
    },
  };
}

/**
 * Founder time one charged Play order grants. A license-tester purchase from
 * an account that is not on the allowlist gets a 24h trial at zero revenue (so
 * testers can see the flow without minting free months). Everything else
 * stacks the plan's months on the current period.
 */
export function googleFounderGrant(input: {
  test: boolean;
  buyerEmail: string;
  testEmails: string[];
  months: number;
  priceIdr: number;
  current: Date | null;
  now: Date;
}): { until: Date; amountIdr: number } {
  if (input.test && !input.testEmails.includes(input.buyerEmail.toLowerCase())) {
    const base =
      input.current && input.current.getTime() > input.now.getTime() ? input.current : input.now;
    return { until: new Date(base.getTime() + DAY_MS), amountIdr: 0 };
  }
  return {
    until: nextFounderUntil(input.current, input.now, input.months),
    amountIdr: input.priceIdr,
  };
}

/** Real-time developer notification (decoded Pub/Sub message data). */
export type GoogleNotification = {
  packageName: string;
  subscription?: { notificationType: number; purchaseToken: string; subscriptionId: string };
  voided?: { purchaseToken: string; orderId: string; productType: number };
  test: boolean;
};

const notificationSchema = z.object({
  packageName: z.string(),
  subscriptionNotification: z
    .object({
      notificationType: z.number(),
      purchaseToken: z.string(),
      subscriptionId: z.string(),
    })
    .optional(),
  voidedPurchaseNotification: z
    .object({
      purchaseToken: z.string(),
      orderId: z.string(),
      productType: z.number(),
    })
    .optional(),
  testNotification: z.object({}).passthrough().optional(),
});

/** Subscription notification type for SUBSCRIPTION_REVOKED. */
export const NOTIFICATION_SUBSCRIPTION_REVOKED = 12;
/** voidedPurchaseNotification.productType for subscriptions. */
export const VOIDED_PRODUCT_TYPE_SUBSCRIPTION = 1;

/** Decodes a Pub/Sub push body; null when it is not a Play developer notification. */
export function parsePushNotification(body: unknown): GoogleNotification | null {
  const data = (body as { message?: { data?: unknown } } | null)?.message?.data;
  if (typeof data !== "string") return null;
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(b64urlDecode(data)));
  } catch {
    return null;
  }
  const parsed = notificationSchema.safeParse(json);
  if (!parsed.success) return null;
  return {
    packageName: parsed.data.packageName,
    subscription: parsed.data.subscriptionNotification,
    voided: parsed.data.voidedPurchaseNotification,
    test: parsed.data.testNotification !== undefined,
  };
}

/** Constant-time string compare for the shared RTDN token. */
export function tokenMatches(given: string, expected: string): boolean {
  if (!expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  }
  return diff === 0;
}

type Jwk = JsonWebKey & { kid?: string };

/** Google's public signing keys, cached for an hour. */
export function createGoogleKeySource(
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): (kid: string) => Promise<Jwk | null> {
  let cached: { keys: Jwk[]; fetchedAt: number } | null = null;
  const load = async (): Promise<Jwk[]> => {
    const res = await fetchImpl(GOOGLE_CERTS_URL);
    if (!res.ok) throw new Error(`google certs ${res.status}`);
    const body = (await res.json()) as { keys?: Jwk[] };
    cached = { keys: body.keys ?? [], fetchedAt: now() };
    return cached.keys;
  };
  return async (kid) => {
    const fresh = cached && now() - cached.fetchedAt < 60 * 60 * 1000;
    let key = (fresh ? cached!.keys : await load()).find((k) => k.kid === kid);
    // A rotated key id: refresh once before rejecting.
    if (!key && fresh) key = (await load()).find((k) => k.kid === kid);
    return key ?? null;
  };
}

/**
 * Verifies the Google-signed OIDC token a Pub/Sub push subscription attaches
 * (`Authorization: Bearer <jwt>`): RS256 signature against Google's keys,
 * Google issuer, our endpoint as audience, exp, and the push service account.
 */
export type PushJwtOptions = {
  audience: string;
  email: string;
  key: (kid: string) => Promise<Jwk | null>;
  nowMs?: number;
};

export async function verifyPushJwt(jwt: string, options: PushJwtOptions): Promise<boolean> {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return false;
    const [headB64, payloadB64, sigB64] = parts as [string, string, string];
    const header = JSON.parse(new TextDecoder().decode(b64urlDecode(headB64))) as {
      alg?: string;
      kid?: string;
    };
    if (header.alg !== "RS256" || !header.kid) return false;
    const jwk = await options.key(header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signed = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlDecode(sigB64),
      new TextEncoder().encode(`${headB64}.${payloadB64}`),
    );
    if (!signed) return false;
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64))) as {
      iss?: string;
      aud?: string;
      exp?: number;
      email?: string;
      email_verified?: boolean;
    };
    const nowSec = Math.floor((options.nowMs ?? Date.now()) / 1000);
    return (
      typeof claims.iss === "string" &&
      GOOGLE_ISSUERS.includes(claims.iss) &&
      claims.aud === options.audience &&
      typeof claims.exp === "number" &&
      claims.exp > nowSec &&
      claims.email_verified === true &&
      claims.email?.toLowerCase() === options.email.toLowerCase()
    );
  } catch {
    return false;
  }
}
