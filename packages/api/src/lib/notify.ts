import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { profile } from "@joyorogo/db/schema/fitness";
import { pushSubscription } from "@joyorogo/db/schema/plans";
import { pushDevice, pushOutbox, pushPrefs } from "@joyorogo/db/schema/push";
import type { PushOutboxRow } from "@joyorogo/db/schema/push";
import { DEFAULT_DAY_ZONE, DEFAULT_LOCALE, DEFAULT_REGION, dayBoundsIn, getT, isLocale, resolveDayZone } from "@joyorogo/i18n";
import type { DayZone, Locale } from "@joyorogo/i18n";

import { D1_MAX_PARAMS, chunk, insertChunked } from "./d1";
import { fetchReceipts, sendExpo } from "./expo-push";
import type { ExpoMessage, ExpoPushEnv } from "./expo-push";
import { minutesUntil, parseHHMM, wibDateKey, wibMinutes } from "./fasting";
import { pushData } from "./push-link";
import type { PushApp, PushLink } from "./push-link";
import { sendPush, vapidConfigured } from "./webpush";
import type { VapidEnv } from "./webpush";
import { ZONE_GROUPS, profileInZone } from "./zone-sql";

// The one pipeline every push goes through (web push, JoyoRogo native, JoyoFit). Contract and the event table: docs/push.md.
//
//   notify(userId, event)
//     -> category switch off or nobody to send to: nothing is stored
//     -> same dedupe key already seen: nothing happens
//     -> an outbox row is written, then delivered at once, unless
//          quiet hours (default 21:30 - 06:30 local) -> row waits for the end of the quiet time
//          the category's daily cap is used up           -> social / group fold into the evening digest, the rest is dropped
//     -> fan out: web subscriptions + JoyoRogo devices, or the JoyoFit devices (see `targets`)
//     -> transient failure (network, 429, 5xx, Expo rate limit): retried by the five-minute cron, 4 attempts
//     -> dead token (404/410, DeviceNotRegistered): deleted

export const PUSH_CATEGORIES = ["social", "group", "meal", "weigh", "recap"] as const;
export type PushCategory = (typeof PUSH_CATEGORIES)[number];

/** Most pushes of one category a person gets per local day before the rest goes to the digest (or is dropped). */
export const CATEGORY_CAP: Record<PushCategory, number> = { social: 10, group: 8, meal: 2, weigh: 1, recap: 2 };

/** Categories whose overflow is worth a digest line; reminders over the cap are simply dropped. */
const DIGEST_CATEGORIES: readonly PushCategory[] = ["social", "group"];

/** Minute of the local day from which the digest of the day's overflow goes out. */
export const DIGEST_MINUTE = 19 * 60;

export const MAX_ATTEMPTS = 4;
/** Delivery batch of one cron round, and how many rounds one tick runs. */
const FLUSH_BATCH = 100;
const FLUSH_ROUNDS = 4;
/** Ids per `IN (...)`: D1_MAX_PARAMS minus headroom for the few other values those statements bind (at most 2). */
const ID_CHUNK = D1_MAX_PARAMS - 20;
const RECEIPT_AFTER_MS = 15 * 60_000;
const RECEIPT_MAX_AGE_MS = 24 * 3_600_000;
const KEEP_OUTBOX_MS = 14 * 86_400_000;

// --- Message and event types ------------------------------------------------------------

/** A text of the recipient's language: a key of the `push` namespace with params, or already-written text (a note, a post title). */
export type Msg = { key: string; params?: Record<string, string | number> } | { text: string };

export type PushEvent = {
  category: PushCategory;
  /** Machine name of the event ('kudos', 'poke', 'meal_noon'...); also the Expo / SW `data.kind`. */
  kind: string;
  title: Msg;
  body?: Msg;
  link: PushLink;
  /** 'joyofit': written for the JoyoFit app (the person's watch workouts); it goes there when the app is registered. */
  app?: PushApp;
  /** One row per (user, dedupeKey), ever. */
  dedupeKey?: string;
  /** A waiting row is replaced by a newer one of the same user and key. */
  collapseKey?: string;
  /** Earliest send time (quiet hours may delay it further). */
  sendAfter?: Date;
  /** Dropped when it has waited longer than this (a lunch reminder that is two hours late is noise). */
  staleMs?: number;
  /** Test button: no quiet hours, no cap, no category switch. */
  bypass?: boolean;
};

type Payload = Pick<PushEvent, "title" | "body" | "link" | "app" | "staleMs" | "bypass">;

export type NotifyEnv = VapidEnv & ExpoPushEnv;
export type NotifyDeps = { db: Database; env: NotifyEnv; now?: () => Date };

export type NotifyStatus =
  /** Delivered to at least one device. */
  | "sent"
  /** Waiting: quiet hours or a retry. */
  | "queued"
  /** Over the daily cap; goes into the evening digest. */
  | "digest"
  /** Nothing stored: switched off, or no device and no browser. */
  | "skipped"
  | "duplicate"
  | "dropped"
  | "failed";

// --- Preferences ------------------------------------------------------------------------

export type QuietHours = { enabled: boolean; start: string; end: string };

export type PushPrefsValue = Record<PushCategory, boolean> & { quiet: QuietHours };

export const DEFAULT_QUIET: QuietHours = { enabled: true, start: "21:30", end: "06:30" };

export const DEFAULT_PUSH_PREFS: PushPrefsValue = {
  social: true,
  group: true,
  meal: true,
  weigh: true,
  recap: true,
  quiet: DEFAULT_QUIET,
};

type PrefsRow = typeof pushPrefs.$inferSelect;

export function prefsFromRow(row: PrefsRow | undefined): PushPrefsValue {
  if (!row) return DEFAULT_PUSH_PREFS;
  return {
    social: row.social,
    group: row.group,
    meal: row.meal,
    weigh: row.weigh,
    recap: row.recap,
    quiet: { enabled: row.quietEnabled, start: row.quietStart, end: row.quietEnd },
  };
}

/** Whether the local clock reads inside the quiet window; a start after the end wraps midnight, start == end is no window. */
export function inQuietHours(quiet: QuietHours, nowMin: number): boolean {
  if (!quiet.enabled) return false;
  const start = parseHHMM(quiet.start) ?? parseHHMM(DEFAULT_QUIET.start)!;
  const end = parseHHMM(quiet.end) ?? parseHHMM(DEFAULT_QUIET.end)!;
  if (start === end) return false;
  return start < end ? nowMin >= start && nowMin < end : nowMin >= start || nowMin < end;
}

/** The next moment the clock of `zone` reads the end of the quiet window. */
export function quietEndsAt(quiet: QuietHours, now: Date, zone: DayZone): Date {
  const end = parseHHMM(quiet.end) ?? parseHHMM(DEFAULT_QUIET.end)!;
  const minute = Math.floor(now.getTime() / 60_000) * 60_000;
  return new Date(minute + minutesUntil(end, wibMinutes(now, zone)) * 60_000);
}

/** Midnight of the day `now` falls in, in `zone`. */
export function wibDayStart(now: Date, zone: DayZone): Date {
  return new Date(dayBoundsIn(wibDateKey(now, zone), zone).startMs);
}

// --- Audience (who a user can be reached on) --------------------------------------------

type SubRow = typeof pushSubscription.$inferSelect;
type DeviceRow = typeof pushDevice.$inferSelect;
export type Audience = { prefs: PushPrefsValue; subs: SubRow[]; devices: DeviceRow[]; locale: Locale; zone: DayZone };

/** Prefs, browsers, phones and language of every user in `userIds`; one round trip per 80 users. */
export async function loadAudience(db: Database, userIds: string[]): Promise<Map<string, Audience>> {
  const out = new Map<string, Audience>();
  for (const ids of chunk([...new Set(userIds)], ID_CHUNK)) {
    const [prefs, subs, devices, locales] = await db.batch([
      db.select().from(pushPrefs).where(inArray(pushPrefs.userId, ids)),
      db.select().from(pushSubscription).where(inArray(pushSubscription.userId, ids)),
      db.select().from(pushDevice).where(inArray(pushDevice.userId, ids)),
      db.select({ userId: profile.userId, locale: profile.locale, timezone: profile.timezone }).from(profile).where(inArray(profile.userId, ids)),
    ]);
    for (const id of ids) {
      const userDevices = devices.filter((d) => d.userId === id);
      const saved = locales.find((l) => l.userId === id);
      const fromDevice = userDevices.find((d) => isLocale(d.locale))?.locale;
      out.set(id, {
        prefs: prefsFromRow(prefs.find((p) => p.userId === id)),
        subs: subs.filter((s) => s.userId === id),
        devices: userDevices,
        locale: isLocale(saved?.locale) ? saved.locale : isLocale(fromDevice) ? fromDevice : DEFAULT_LOCALE,
        zone: saved ? resolveDayZone({ stored: saved.timezone, hasProfile: true, region: DEFAULT_REGION }) : DEFAULT_DAY_ZONE,
      });
    }
  }
  return out;
}

/** Link types JoyoFit can open (its social screens); everything else only makes sense in JoyoRogo. */
const FIT_LINKS: readonly PushLink["t"][] = ["post", "profile", "feed", "group"];

/**
 * Where one event goes. JoyoFit-written events (`app: 'joyofit'`) go to the JoyoFit phones when any is registered, else to
 * JoyoRogo. Everything else goes to the browsers and JoyoRogo phones; a person who only has JoyoFit gets the social
 * events there, which it can open.
 */
export function targets(
  audience: Pick<Audience, "subs" | "devices">,
  event: Pick<Payload, "app" | "link">,
  webReady: boolean,
): { subs: SubRow[]; devices: DeviceRow[] } {
  const fit = audience.devices.filter((d) => d.app === "joyofit");
  const rogo = audience.devices.filter((d) => d.app === "joyorogo");
  const subs = webReady ? audience.subs : [];
  if (event.app === "joyofit" && fit.length > 0) return { subs: [], devices: fit };
  if (rogo.length > 0 || subs.length > 0) return { subs, devices: rogo };
  if (fit.length > 0 && FIT_LINKS.includes(event.link.t)) return { subs: [], devices: fit };
  return { subs: [], devices: [] };
}

// --- Text -------------------------------------------------------------------------------

function resolve(t: (key: string, options?: object) => string, msg: Msg | undefined): string {
  if (!msg) return "";
  return "text" in msg ? msg.text : t(msg.key, msg.params);
}

function translator(locale: Locale): (key: string, options?: object) => string {
  return getT(locale, "push") as unknown as (key: string, options?: object) => string;
}

// --- Delivery ---------------------------------------------------------------------------

type Update = Partial<typeof pushOutbox.$inferInsert>;

/** An Expo ticket and the device it was sent to; the receipt names only the ticket. */
type Ticket = { t: string; d: string };

function parsePayload(row: PushOutboxRow): Payload | null {
  try {
    const raw = JSON.parse(row.payloadJson) as Payload;
    return raw && raw.title && raw.link ? raw : null;
  } catch {
    return null;
  }
}

function retryDelayMs(attempts: number): number {
  return 5 * 60_000 * 2 ** (attempts - 1);
}

function webTransient(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}

/**
 * Decides and sends `rows` (all already stored). Quiet hours, the cap, the category switch and the missing audience
 * are decided here, so a retry or a late flush meets the person's current settings. Returns the final status per id.
 */
export async function deliverRows(
  deps: NotifyDeps,
  rows: PushOutboxRow[],
  preloaded?: Map<string, Audience>,
): Promise<Map<string, NotifyStatus>> {
  const { db, env } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const result = new Map<string, NotifyStatus>();
  if (rows.length === 0) return result;

  const audiences = preloaded ?? (await loadAudience(db, rows.map((r) => r.userId)));
  const zoneOf = (userId: string): DayZone => audiences.get(userId)?.zone ?? DEFAULT_DAY_ZONE;
  const dayStartOf = new Map<DayZone, Date>();
  const minuteOf = new Map<DayZone, number>();
  for (const row of rows) {
    const zone = zoneOf(row.userId);
    if (dayStartOf.has(zone)) continue;
    dayStartOf.set(zone, wibDayStart(now, zone));
    minuteOf.set(zone, wibMinutes(now, zone));
  }
  const webReady = vapidConfigured(env);

  // Pushes already delivered today (the person's day) per user and category (the digest line itself never counts).
  const sentToday = new Map<string, number>();
  for (const [zone, dayStart] of dayStartOf) {
    const ofZone = [...new Set(rows.map((r) => r.userId))].filter((id) => zoneOf(id) === zone);
    for (const ids of chunk(ofZone, ID_CHUNK)) {
      const counted = await db
        .select({ userId: pushOutbox.userId, category: pushOutbox.category, total: sql<number>`count(*)` })
        .from(pushOutbox)
        .where(
          and(
            inArray(pushOutbox.userId, ids),
            eq(pushOutbox.status, "sent"),
            sql`${pushOutbox.sentAt} >= ${dayStart.getTime()}`,
            sql`${pushOutbox.kind} != 'digest'`,
          ),
        )
        .groupBy(pushOutbox.userId, pushOutbox.category);
      for (const c of counted) sentToday.set(`${c.userId}:${c.category}`, c.total);
    }
  }

  const updates = new Map<string, Update>();
  const close = (row: PushOutboxRow, status: NotifyStatus, patch: Update = {}) => {
    result.set(row.id, status);
    updates.set(row.id, { status: status as PushOutboxRow["status"], ...patch });
  };

  type Pending = {
    row: PushOutboxRow;
    web: SubRow[];
    expoStart: number;
    expoCount: number;
    // fixed after the sends
  };
  const pending: Pending[] = [];
  const expoMessages: ExpoMessage[] = [];
  const expoDevice: DeviceRow[] = [];
  const webJobs: { pending: Pending; sub: SubRow; message: Parameters<typeof sendPush>[2] }[] = [];

  for (const row of rows) {
    const payload = parsePayload(row);
    const audience = audiences.get(row.userId);
    if (!payload || !audience) {
      close(row, "dropped", { lastError: "payload" });
      continue;
    }
    const bypass = payload.bypass === true;
    if (!bypass && payload.staleMs !== undefined && now.getTime() - row.sendAfter.getTime() > payload.staleMs) {
      close(row, "dropped", { lastError: "stale" });
      continue;
    }
    if (!bypass && !audience.prefs[row.category]) {
      close(row, "dropped", { lastError: "muted" });
      continue;
    }
    if (!bypass && inQuietHours(audience.prefs.quiet, minuteOf.get(audience.zone)!)) {
      const until = quietEndsAt(audience.prefs.quiet, now, audience.zone);
      updates.set(row.id, { status: "queued", sendAfter: until });
      result.set(row.id, "queued");
      continue;
    }
    if (!bypass && row.kind !== "digest") {
      const key = `${row.userId}:${row.category}`;
      if ((sentToday.get(key) ?? 0) >= CATEGORY_CAP[row.category]) {
        close(row, DIGEST_CATEGORIES.includes(row.category) ? "digest" : "dropped", { lastError: "cap" });
        continue;
      }
    }
    const to = targets(audience, payload, webReady);
    if (to.subs.length === 0 && to.devices.length === 0) {
      close(row, "dropped", { lastError: "no-target" });
      continue;
    }

    const t = translator(audience.locale);
    const title = resolve(t, payload.title);
    const body = resolve(t, payload.body);
    const entry: Pending = { row, web: to.subs, expoStart: expoMessages.length, expoCount: to.devices.length };
    for (const device of to.devices) {
      const app: PushApp = device.app;
      expoMessages.push({
        to: device.expoToken,
        title,
        body,
        data: pushData(row.kind, payload.link, app),
        channelId: app === "joyofit" ? "social" : row.category,
        priority: "high",
        ttl: 86_400,
      });
      expoDevice.push(device);
    }
    for (const sub of to.subs) {
      const data = pushData(row.kind, payload.link, "joyorogo");
      webJobs.push({
        pending: entry,
        sub,
        message: { title, body, url: data.url, tag: row.collapseKey ?? row.kind, data },
      });
    }
    pending.push(entry);
    const key = `${row.userId}:${row.category}`;
    if (row.kind !== "digest") sentToday.set(key, (sentToday.get(key) ?? 0) + 1);
  }

  // One Expo call for the whole round, web pushes in parallel.
  const [expoResults, webResults] = await Promise.all([
    sendExpo(env, expoMessages),
    Promise.all(webJobs.map((job) => sendPush(env, job.sub, job.message))),
  ]);

  const deadDevices = new Set<string>();
  const deadSubs = new Set<string>();
  const tally = new Map<string, { delivered: number; transient: number; tickets: Ticket[]; error: string | null }>();
  const entryOf = (p: Pending) => {
    let t = tally.get(p.row.id);
    if (!t) tally.set(p.row.id, (t = { delivered: 0, transient: 0, tickets: [], error: null }));
    return t;
  };
  for (const p of pending) entryOf(p);
  for (const p of pending) {
    for (let i = p.expoStart; i < p.expoStart + p.expoCount; i++) {
      const r = expoResults[i]!;
      const t = entryOf(p);
      if (r.ok) {
        t.delivered += 1;
        t.tickets.push({ t: r.ticketId, d: expoDevice[i]!.id });
      } else {
        if (r.dead) deadDevices.add(expoDevice[i]!.id);
        else if (r.transient) t.transient += 1;
        t.error ??= r.error;
      }
    }
  }
  webJobs.forEach((job, i) => {
    const r = webResults[i]!;
    const t = entryOf(job.pending);
    if (r.ok) t.delivered += 1;
    else if (r.status === 404 || r.status === 410) deadSubs.add(job.sub.id);
    else {
      if (webTransient(r.status)) t.transient += 1;
      t.error ??= `web-${r.status}`;
    }
  });

  for (const p of pending) {
    const t = tally.get(p.row.id)!;
    if (t.delivered > 0) {
      close(p.row, "sent", {
        sentAt: now,
        attempts: p.row.attempts + 1,
        ticketsJson: t.tickets.length > 0 ? JSON.stringify(t.tickets) : null,
        lastError: null,
      });
    } else if (t.transient > 0 && p.row.attempts + 1 < MAX_ATTEMPTS) {
      const attempts = p.row.attempts + 1;
      updates.set(p.row.id, {
        status: "queued",
        attempts,
        sendAfter: new Date(now.getTime() + retryDelayMs(attempts)),
        lastError: t.error,
      });
      result.set(p.row.id, "queued");
    } else if (t.transient > 0) {
      close(p.row, "failed", { attempts: p.row.attempts + 1, lastError: t.error });
    } else {
      close(p.row, "dropped", { attempts: p.row.attempts + 1, lastError: t.error ?? "undelivered" });
    }
  }

  // Closing writes and dead-token cleanup, as few round trips as the chunking allows.
  const statements: unknown[] = [...updates.entries()].map(([id, patch]) =>
    db.update(pushOutbox).set(patch).where(eq(pushOutbox.id, id)),
  );
  for (const ids of chunk([...deadDevices], ID_CHUNK)) {
    statements.push(db.delete(pushDevice).where(inArray(pushDevice.id, ids)));
  }
  for (const ids of chunk([...deadSubs], ID_CHUNK)) {
    statements.push(db.delete(pushSubscription).where(inArray(pushSubscription.id, ids)));
  }
  for (const group of chunk(statements, 50)) {
    await db.batch(group as unknown as Parameters<Database["batch"]>[0]);
  }
  return result;
}

// --- Writing rows -----------------------------------------------------------------------

function toRow(userId: string, event: PushEvent, now: Date): typeof pushOutbox.$inferInsert {
  const payload: Payload = {
    title: event.title,
    link: event.link,
    ...(event.body ? { body: event.body } : {}),
    ...(event.app ? { app: event.app } : {}),
    ...(event.staleMs !== undefined ? { staleMs: event.staleMs } : {}),
    ...(event.bypass ? { bypass: true } : {}),
  };
  return {
    id: crypto.randomUUID(),
    userId,
    category: event.category,
    kind: event.kind,
    payloadJson: JSON.stringify(payload),
    dedupeKey: event.dedupeKey ?? null,
    collapseKey: event.collapseKey ?? null,
    status: "queued",
    sendAfter: event.sendAfter && event.sendAfter > now ? event.sendAfter : now,
    createdAt: now,
  };
}

/**
 * Stores the event for `userId` and delivers it now (quiet hours and the cap permitting). Safe to call for anybody:
 * a person with the category off, or without a phone or browser, costs two reads and stores nothing.
 */
export async function notify(deps: NotifyDeps, userId: string, event: PushEvent): Promise<{ status: NotifyStatus; id?: string }> {
  const now = (deps.now ?? (() => new Date()))();
  const audiences = await loadAudience(deps.db, [userId]);
  const audience = audiences.get(userId)!;
  if (!event.bypass && !audience.prefs[event.category]) return { status: "skipped" };
  const reach = targets(audience, { app: event.app, link: event.link }, vapidConfigured(deps.env));
  if (reach.subs.length === 0 && reach.devices.length === 0) return { status: "skipped" };

  const values = toRow(userId, event, now);
  const [inserted] = await deps.db
    .insert(pushOutbox)
    .values(values)
    .onConflictDoNothing()
    .returning();
  if (!inserted) return { status: "duplicate" };
  if (inserted.sendAfter.getTime() > now.getTime()) return { status: "queued", id: inserted.id };
  const outcome = await deliverRows(deps, [inserted], audiences);
  return { status: outcome.get(inserted.id) ?? "dropped", id: inserted.id };
}

/** `notify` as background work: never throws into the request that caused the event. */
export function notifyInBackground(
  context: { db: Database; env: NotifyEnv; waitUntil: (promise: Promise<unknown>) => void },
  userId: string,
  event: PushEvent,
): void {
  context.waitUntil(
    notify({ db: context.db, env: context.env }, userId, event).catch((error: unknown) => {
      console.error("[push] notify failed", error);
    }),
  );
}

/**
 * Stores one event per user for later delivery by the cron, no checks beyond the dedupe key (the caller already picked
 * recipients who can be reached). Used for fan-outs, where delivering inline would cost hundreds of subrequests.
 */
export async function enqueueMany(
  deps: NotifyDeps,
  userIds: string[],
  eventFor: (userId: string) => PushEvent,
): Promise<number> {
  if (userIds.length === 0) return 0;
  const now = (deps.now ?? (() => new Date()))();
  const stored = await insertChunked(
    deps.db,
    pushOutbox,
    userIds.map((id) => toRow(id, eventFor(id), now)),
    (insert) => insert.onConflictDoNothing().returning({ id: pushOutbox.id }),
  );
  return stored.reduce((total, rows) => total + rows.length, 0);
}

// --- Cron: flush, digest, receipts ------------------------------------------------------

/** A waiting row is superseded by a newer waiting row of the same user and collapse key. */
async function collapseWaiting(db: Database, now: Date): Promise<void> {
  await db.run(sql`
    UPDATE push_outbox SET status = 'dropped', last_error = 'collapsed'
    WHERE status = 'queued' AND collapse_key IS NOT NULL AND send_after <= ${now.getTime()}
      AND EXISTS (
        SELECT 1 FROM push_outbox n
        WHERE n.user_id = push_outbox.user_id AND n.collapse_key = push_outbox.collapse_key AND n.status = 'queued'
          AND (n.created_at > push_outbox.created_at OR (n.created_at = push_outbox.created_at AND n.id > push_outbox.id))
      )`);
}

/** Delivers everything that is due: queued rows whose time has come, plus retries. Returns how many rows it handled. */
export async function flushOutbox(deps: NotifyDeps): Promise<number> {
  const now = (deps.now ?? (() => new Date()))();
  await collapseWaiting(deps.db, now);
  let handled = 0;
  for (let round = 0; round < FLUSH_ROUNDS; round++) {
    const due = await deps.db
      .select()
      .from(pushOutbox)
      .where(and(eq(pushOutbox.status, "queued"), lte(pushOutbox.sendAfter, now)))
      .orderBy(asc(pushOutbox.sendAfter))
      .limit(FLUSH_BATCH);
    if (due.length === 0) break;
    const outcome = await deliverRows(deps, due);
    handled += due.length;
    // A row that stays queued with a past time cannot happen (quiet hours and retries move it forward), but a
    // short round still ends the loop.
    if (due.length < FLUSH_BATCH || [...outcome.values()].every((s) => s === "queued")) break;
  }
  return handled;
}

const DIGEST_COPY: Record<"social" | "group", { title: string; link: PushLink }> = {
  social: { title: "notify.digest.social.title", link: { t: "feed" } },
  group: { title: "notify.digest.group.title", link: { t: "inbox" } },
};

/**
 * From 19:00 local time: one line per person and category for the pushes the cap held back today. Held rows of an
 * earlier day are dropped (a digest of yesterday is not news). Runs per zone group, on the people living in it.
 */
export async function runDigest(deps: NotifyDeps): Promise<number> {
  const now = (deps.now ?? (() => new Date()))();
  const { db } = deps;
  // Null when the person has no profile row: they keep the default zone's day.
  const timezoneOf = sql`(SELECT p.timezone FROM profile p WHERE p.user_id = push_outbox.user_id)`;
  let sent = 0;
  for (const zone of ZONE_GROUPS) {
    const dayStart = wibDayStart(now, zone);
    const inZone = profileInZone(zone, timezoneOf);
    await db
      .update(pushOutbox)
      .set({ status: "dropped", lastError: "stale-digest" })
      .where(and(eq(pushOutbox.status, "digest"), lt(pushOutbox.createdAt, dayStart), inZone));
    if (wibMinutes(now, zone) < DIGEST_MINUTE) continue;

    const held = await db
      .select({ userId: pushOutbox.userId, category: pushOutbox.category, total: sql<number>`count(*)` })
      .from(pushOutbox)
      .where(and(eq(pushOutbox.status, "digest"), inZone))
      .groupBy(pushOutbox.userId, pushOutbox.category)
      .limit(200);
    for (const group of held) {
      if (group.category !== "social" && group.category !== "group") continue;
      const copy = DIGEST_COPY[group.category];
      const result = await notify(deps, group.userId, {
        category: group.category,
        kind: "digest",
        title: { key: copy.title, params: { n: group.total } },
        body: { key: `notify.digest.${group.category}.body` },
        link: copy.link,
        dedupeKey: `digest:${group.category}:${wibDateKey(now, zone)}`,
      });
      if (result.status === "sent") sent += 1;
      // Sent, duplicate or skipped alike: the held rows are accounted for.
      if (result.status !== "queued") {
        await db
          .update(pushOutbox)
          .set({ status: "digested" })
          .where(
            and(
              eq(pushOutbox.userId, group.userId),
              eq(pushOutbox.category, group.category),
              eq(pushOutbox.status, "digest"),
            ),
          );
      }
    }
  }
  return sent;
}

/** Reads the Expo receipts of pushes sent 15 minutes to a day ago, deletes tokens FCM / APNs refused, clears the ids. */
export async function checkReceipts(deps: NotifyDeps): Promise<number> {
  const now = (deps.now ?? (() => new Date()))();
  const { db } = deps;
  const rows = await db
    .select({ id: pushOutbox.id, userId: pushOutbox.userId, ticketsJson: pushOutbox.ticketsJson, sentAt: pushOutbox.sentAt })
    .from(pushOutbox)
    .where(
      and(
        eq(pushOutbox.status, "sent"),
        sql`${pushOutbox.ticketsJson} IS NOT NULL`,
        sql`${pushOutbox.sentAt} <= ${now.getTime() - RECEIPT_AFTER_MS}`,
      ),
    )
    .limit(200);
  if (rows.length === 0) return 0;

  const rowOf = new Map<string, string>();
  const deviceOf = new Map<string, string>();
  const expired: string[] = [];
  for (const row of rows) {
    const list = JSON.parse(row.ticketsJson ?? "[]") as Ticket[];
    if (row.sentAt && now.getTime() - row.sentAt.getTime() > RECEIPT_MAX_AGE_MS) expired.push(row.id);
    for (const ticket of list) {
      rowOf.set(ticket.t, row.id);
      deviceOf.set(ticket.t, ticket.d);
    }
  }
  const receipts = await fetchReceipts(deps.env, [...rowOf.keys()]);
  const deadDevices = [...rowOf.keys()].filter((id) => receipts[id]?.dead).map((id) => deviceOf.get(id)!);
  for (const ids of chunk(deadDevices, ID_CHUNK)) {
    await db.delete(pushDevice).where(inArray(pushDevice.id, ids));
  }
  const settled = new Set<string>([...expired]);
  for (const [ticket, rowId] of rowOf) if (receipts[ticket]) settled.add(rowId);
  for (const ids of chunk([...settled], ID_CHUNK)) {
    await db.update(pushOutbox).set({ ticketsJson: null }).where(inArray(pushOutbox.id, ids));
  }
  return settled.size;
}

/** Closed rows older than two weeks go (the daily cap only reads today). Run once a day. */
export async function pruneOutbox(deps: NotifyDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  await deps.db
    .delete(pushOutbox)
    .where(and(sql`${pushOutbox.status} != 'queued'`, lt(pushOutbox.createdAt, new Date(now.getTime() - KEEP_OUTBOX_MS))));
}
