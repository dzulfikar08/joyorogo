// Badges and the weekly consistency leaderboard, pure part (docs/badges.md). Nothing here reads a database or the clock.
//
// Hard rule: no badge and no rank is ever derived from body weight, kg lost, waist or calories against a target. Weigh-ins
// are not logged days. A person is ranked on how consistently they log, move and hit protein, never on how their body changed.
import { dayZoneOffsetMs } from "@joyorogo/i18n";
import type { DayZone } from "@joyorogo/i18n";

import { daysBetween, shiftDate, streakFromDates } from "./engine";
import { IMPORT_SOURCE } from "./history-import";

// --- Flag -------------------------------------------------------------------------------------------------------------

export type BadgesEnv = { BADGES_USER_IDS?: string };

/**
 * Whether badges and the leaderboard exist for this user: the `BADGES_USER_IDS` allowlist (comma-separated user ids, or `*`
 * for everyone; empty or unset = nobody). One flag for both features, owner-only until the rollout is decided.
 */
export function badgesEnabled(env: BadgesEnv, userId: string): boolean {
  return (env.BADGES_USER_IDS ?? "").split(",").some((id) => id.trim() === "*" || (id.trim() !== "" && id.trim() === userId));
}

/** True when the allowlist is `*`: the cron then works on whoever was active, not on a fixed list. */
export function badgesForEveryone(env: BadgesEnv): boolean {
  return (env.BADGES_USER_IDS ?? "").split(",").some((id) => id.trim() === "*");
}

/** The explicit user ids of the allowlist (no `*`). */
export function badgesAllowlist(env: BadgesEnv): string[] {
  return (env.BADGES_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "" && id !== "*");
}

// --- Logged day -------------------------------------------------------------------------------------------------------

/** A meal is backdated at most this many days; older entries are history, not a habit. */
export const BACKDATE_DAYS = 2;

export type FoodRowFacts = { date: string; kcal: number; source: string; createdAtMs: number };

/**
 * One `food_log` row makes its day a logged day when it carries energy (kcal > 0), is not imported history, and was written
 * on the day it names or at most 2 days later in the person's zone, never before it (no future days, no bulk backdating).
 * `db` side: lib/badge-store.ts `LOGGED_DAY_SQL`, which a test pins to this function.
 */
export function isLoggedFood(row: FoodRowFacts, zone: DayZone): boolean {
  if (!(row.kcal > 0) || row.source === IMPORT_SOURCE) return false;
  const writtenOn = new Date(row.createdAtMs + dayZoneOffsetMs(zone)).toISOString().slice(0, 10);
  const lag = daysBetween(row.date, writtenOn);
  return lag >= 0 && lag <= BACKDATE_DAYS;
}

/** Longest run of consecutive days in `dates`. */
export function longestRun(dates: Iterable<string>): number {
  const days = [...new Set(dates)].sort();
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of days) {
    run = previous !== null && shiftDate(previous, 1) === day ? run + 1 : 1;
    if (run > best) best = run;
    previous = day;
  }
  return best;
}

/** Monday (ISO week start) of the week `date` falls in. */
export function weekStartOf(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 Sunday
  return shiftDate(date, -((weekday + 6) % 7));
}

/** ISO weeks (Monday to Sunday) in which all 7 days are logged days. */
export function perfectWeeks(dates: Iterable<string>): number {
  const perWeek = new Map<string, Set<string>>();
  for (const date of dates) {
    const week = weekStartOf(date);
    (perWeek.get(week) ?? perWeek.set(week, new Set()).get(week)!).add(date);
  }
  let perfect = 0;
  for (const days of perWeek.values()) if (days.size === 7) perfect += 1;
  return perfect;
}

// --- Ramadan ----------------------------------------------------------------------------------------------------------

export type RamadanWindow = { hijri: number; start: string; end: string };

/**
 * Ramadan windows as WIB calendar days, inclusive. [INFERENCE] 1448 H: the Umm al-Qura calendar (what the app's `auto`
 * mode uses, engine `isRamadanDate`) gives 2027-02-08..2027-03-08; the end is kept at 2027-03-09 because Sidang Isbat
 * Kemenag may set 30 days (docs/marketing/marketing-plan.md: expected around 8 to 9 Feb 2027). 1449 H is the Umm al-Qura
 * range plus the same one-day margin. Add the next year here; the app launched in late 2026, so 1447 is not listed.
 */
export const RAMADAN_WINDOWS: readonly RamadanWindow[] = [
  { hijri: 1448, start: "2027-02-08", end: "2027-03-09" },
  { hijri: 1449, start: "2028-01-28", end: "2028-02-26" },
];

/** Logged days inside a Ramadan window that count for the badge. */
export const RAMADAN_MIN_DAYS = 20;

export function ramadanDaysIn(dates: Iterable<string>, window: RamadanWindow): number {
  let n = 0;
  for (const date of new Set(dates)) if (date >= window.start && date <= window.end) n += 1;
  return n;
}

/** Windows whose last day is before `today`: a badge for them is decided once, after the window has closed. */
export function closedRamadanWindows(today: string): RamadanWindow[] {
  return RAMADAN_WINDOWS.filter((w) => w.end < today);
}

// --- Catalogue --------------------------------------------------------------------------------------------------------

/** What a badge counts. Each metric is a number in `BadgeFacts`. */
export type BadgeMetric =
  | "loggedDays"
  | "longestStreak"
  | "perfectWeeks"
  | "scans"
  | "corrections"
  | "proteinDays"
  | "waterDays"
  | "workoutDays"
  | "challenges"
  | "teamDays"
  | "ramadanDays";

export type BadgeDef = {
  /** Stable id; the image is /badge/<id>.webp (web) and assets/badge/<id>.webp (native). Copy lives in the `badges` namespace. */
  id: string;
  /** Threshold of each tier, ascending. A one-time badge has one tier. */
  tiers: readonly number[];
  metric: BadgeMetric;
  /** Awarded by the nightly job (cron) rather than at the write that earns it. */
  cron: boolean;
};

export const BADGES: readonly BadgeDef[] = [
  { id: "catatan-pertama", tiers: [1], metric: "loggedDays", cron: false },
  { id: "konsisten", tiers: [7, 30, 100], metric: "longestStreak", cron: true },
  { id: "minggu-sempurna", tiers: [1], metric: "perfectWeeks", cron: true },
  { id: "pemindai-pertama", tiers: [1], metric: "scans", cron: false },
  { id: "perbaikan-pertama", tiers: [1], metric: "corrections", cron: false },
  { id: "protein-target", tiers: [10, 30, 60], metric: "proteinDays", cron: true },
  { id: "air-putih", tiers: [7, 30], metric: "waterDays", cron: true },
  { id: "latihan-pertama", tiers: [1], metric: "workoutDays", cron: false },
  { id: "latihan-10", tiers: [10, 50], metric: "workoutDays", cron: true },
  { id: "tantangan-selesai", tiers: [1], metric: "challenges", cron: true },
  { id: "jejak-tim", tiers: [7], metric: "teamDays", cron: true },
  { id: "ramadan-konsisten", tiers: [RAMADAN_MIN_DAYS], metric: "ramadanDays", cron: true },
];

export const BADGE_IDS: readonly string[] = BADGES.map((b) => b.id);

export function badgeDef(id: string): BadgeDef | undefined {
  return BADGES.find((b) => b.id === id);
}

/** Glasses of water that make a day count for the water badge (the app's default goal; maternal goals differ, the badge does not). */
export const WATER_GLASSES_TARGET = 8;

/** Numbers behind the badges of one person. A metric that is absent counts as 0. */
export type BadgeFacts = Partial<Record<BadgeMetric, number>>;

export type Award = { badgeId: string; tier: number };

/** Every tier whose threshold the facts reach. Pure: the caller inserts what is not yet stored (INSERT OR IGNORE). */
export function evaluate(facts: BadgeFacts, only?: (def: BadgeDef) => boolean): Award[] {
  const awards: Award[] = [];
  for (const def of BADGES) {
    if (only && !only(def)) continue;
    const value = facts[def.metric] ?? 0;
    def.tiers.forEach((threshold, index) => {
      if (value >= threshold) awards.push({ badgeId: def.id, tier: index + 1 });
    });
  }
  return awards;
}

// --- Weekly score -----------------------------------------------------------------------------------------------------

export type WeekScore = {
  daysLogged: number;
  proteinHitDays: number;
  workoutDays: number;
  streakEnd: number;
  /** Bit 0 = Monday ... bit 6 = Sunday: which days of the week are logged days. */
  daysMask: number;
};

/** Days of history the streak at the end of a week is followed back through. */
export const LEADERBOARD_STREAK_DAYS = 365;

/**
 * Score of one week from the logged days (`loggedDays`), the logged days that reached the protein goal (`proteinDays`, a
 * subset) and the verified workout days. `asOf` is the last day that counts: the week's Sunday, or today while it runs.
 */
export function weekScore(args: {
  weekStart: string;
  asOf: string;
  loggedDays: Iterable<string>;
  proteinDays: Iterable<string>;
  workoutDays: Iterable<string>;
}): WeekScore {
  const end = shiftDate(args.weekStart, 6);
  const last = args.asOf < end ? args.asOf : end;
  const inWeek = (date: string) => date >= args.weekStart && date <= last;
  const logged = new Set(args.loggedDays);
  const inLogged = new Set([...logged].filter(inWeek));
  return {
    daysLogged: inLogged.size,
    proteinHitDays: new Set([...args.proteinDays].filter((d) => inWeek(d) && inLogged.has(d))).size,
    workoutDays: new Set([...args.workoutDays].filter(inWeek)).size,
    streakEnd: streakFromDates([...logged].filter((d) => d <= last), last),
    daysMask: [...inLogged].reduce((mask, date) => mask | (1 << daysBetween(args.weekStart, date)), 0),
  };
}

export type RankInput = WeekScore & { userId: string; /** Stable final tiebreak: the alias, else "" (then the user id). */ alias: string };

/**
 * Order of the board: days logged, then workout days, then protein days, then streak (all descending), then alias ascending,
 * then user id. Weight, kg and calories are not inputs.
 */
export function compareScores(a: RankInput, b: RankInput): number {
  return (
    b.daysLogged - a.daysLogged ||
    b.workoutDays - a.workoutDays ||
    b.proteinHitDays - a.proteinHitDays ||
    b.streakEnd - a.streakEnd ||
    a.alias.localeCompare(b.alias) ||
    (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0)
  );
}

/** Rows sorted by `compareScores`, each with its rank (1-based, a total order: equal scores are split by the alias tiebreak). */
export function rankWeek<T extends RankInput>(rows: readonly T[]): Array<T & { rank: number }> {
  return [...rows].sort(compareScores).map((row, index) => ({ ...row, rank: index + 1 }));
}

// --- Alias ------------------------------------------------------------------------------------------------------------

export const ALIAS_MIN = 3;
export const ALIAS_MAX = 20;
const ALIAS_RE = /^[a-z0-9_.-]+$/;

/** An alias is 3-20 characters of a-z, 0-9, `_`, `.` or `-` (lower case). Returns the cleaned alias or null when it is not valid. */
export function normalizeAlias(raw: string): string | null {
  const alias = raw.trim().toLowerCase();
  return alias.length >= ALIAS_MIN && alias.length <= ALIAS_MAX && ALIAS_RE.test(alias) ? alias : null;
}

/** Leaderboard name of a row: the public handle in `username` mode, else the alias, else "Anonim #<rank>" (rendered by the client from `anonymous`). */
export function boardName(args: { displayMode: "username" | "anonim"; handle: string | null; alias: string | null }): { name: string | null; anonymous: boolean } {
  if (args.displayMode === "username" && args.handle) return { name: args.handle, anonymous: false };
  if (args.alias) return { name: args.alias, anonymous: false };
  return { name: null, anonymous: true };
}
