// Threads mention bot settings read from the worker env (docs/threads-bot.md). One parse, one place for the defaults.

export type BotMode = "off" | "review" | "auto";

export const DEFAULT_USER_DAILY_CAP = 3;
export const DEFAULT_GLOBAL_DAILY_CAP = 200;
/** No per-scan error band exists in the app (lib/calibration.ts is a per-person energy shift), so the reply uses this. */
export const DEFAULT_KCAL_BAND = 0.2;
const MIN_KCAL_BAND = 0.05;
const MAX_KCAL_BAND = 0.5;
const MAX_CAP = 100_000;

/** The env keys the bot reads; all optional, an unset one turns its part off. */
export type BotEnv = {
  /** Kill switch: off | review | auto. Unset or anything else = off. */
  THREADS_BOT_MODE?: string;
  /** Scans per Threads user per WIB day; unset or garbage = 3, "0" = nobody is answered. */
  THREADS_BOT_USER_DAILY_CAP?: string;
  /** Scans per WIB day over everyone; unset or garbage = 200, "0" = nobody is answered. */
  THREADS_BOT_DAILY_CAP?: string;
  /** Half-width of the kcal range as a fraction ("0.2" = ±20%); unset or garbage = 0.2, clamped to 0.05 to 0.5. */
  THREADS_BOT_KCAL_BAND?: string;
  THREADS_APP_ID?: string;
  THREADS_APP_SECRET?: string;
  THREADS_WEBHOOK_VERIFY_TOKEN?: string;
  /** Optional second key webhook signatures and signed_requests are also checked against: the Meta app secret (Settings > Basic), if Meta signs with that instead of the Threads app secret. */
  THREADS_WEBHOOK_SECRET?: string;
  /** Seed for a long-lived token; the D1 row (admin Connect, refreshes) wins once it exists. */
  THREADS_ACCESS_TOKEN?: string;
  /** API origin the OAuth redirect lives on (BETTER_AUTH_URL). */
  BETTER_AUTH_URL?: string;
  /** Marketing site origin, shown to Meta as the data-deletion status page. */
  SITE_URL?: string;
};

export type BotConfig = {
  mode: BotMode;
  userCap: number;
  globalCap: number;
  band: number;
  appId?: string;
  appSecret?: string;
  verifyToken?: string;
  /** Every key Meta's signatures may come from: the Threads app secret, then THREADS_WEBHOOK_SECRET. */
  signingSecrets: string[];
  seedToken?: string;
  /** https://api.joyorogo.com/api/threads/callback: the redirect registered in the Meta app. */
  redirectUri: string;
  siteUrl: string;
};

const clean = (value: string | undefined) => value?.trim() || undefined;

export function parseMode(raw: string | undefined): BotMode {
  const value = raw?.trim().toLowerCase();
  return value === "review" || value === "auto" ? value : "off";
}

function parseCap(raw: string | undefined, fallback: number): number {
  const value = raw?.trim();
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return fallback;
  return Math.min(n, MAX_CAP);
}

export function parseBand(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) return DEFAULT_KCAL_BAND;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_KCAL_BAND;
  return Math.min(MAX_KCAL_BAND, Math.max(MIN_KCAL_BAND, n));
}

export function botConfig(env: BotEnv): BotConfig {
  const api = (clean(env.BETTER_AUTH_URL) ?? "https://api.joyorogo.com").replace(/\/+$/, "");
  return {
    mode: parseMode(env.THREADS_BOT_MODE),
    userCap: parseCap(env.THREADS_BOT_USER_DAILY_CAP, DEFAULT_USER_DAILY_CAP),
    globalCap: parseCap(env.THREADS_BOT_DAILY_CAP, DEFAULT_GLOBAL_DAILY_CAP),
    band: parseBand(env.THREADS_BOT_KCAL_BAND),
    appId: clean(env.THREADS_APP_ID),
    appSecret: clean(env.THREADS_APP_SECRET),
    verifyToken: clean(env.THREADS_WEBHOOK_VERIFY_TOKEN),
    signingSecrets: [clean(env.THREADS_APP_SECRET), clean(env.THREADS_WEBHOOK_SECRET)].filter((secret): secret is string => secret !== undefined),
    seedToken: clean(env.THREADS_ACCESS_TOKEN),
    redirectUri: `${api}/api/threads/callback`,
    siteUrl: (clean(env.SITE_URL) ?? "https://joyorogo.com").replace(/\/+$/, ""),
  };
}
