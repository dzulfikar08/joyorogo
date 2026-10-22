// "Simpan sebagai favorit": the app offers to save what the user keeps logging. A food (or a plate of several foods)
// logged three times in 14 days is a habit; the favorite saves the typing next time. Pure: the router reads the rows
// and the marks, this decides which one habit, if any, to offer. Offered once per habit (the router stores the mark
// when the user taps Simpan or Nanti).
import { normalizeFoodName } from "./food-patterns";

/** Logs of the same food or combo needed before it is offered. */
export const OFFER_MIN_LOGS = 3;
/** The window the logs are counted in, in days back from today. */
export const OFFER_WINDOW_DAYS = 14;

/** The food_log columns the offer reads. */
export type OfferRow = {
  id: string;
  name: string;
  kcal: number;
  plateId: string | null;
  createdAt: number;
};

/** One thing the user logged at once: a single row, or every row of one plate. */
type LogEvent = { names: string[]; rows: OfferRow[]; newest: number };

/** A habit worth saving: save it with `foodId` (one food) or `plateId` (a combo). */
export type FavoriteOffer = {
  /** Habit fingerprint: the normalised food names, sorted, joined with "|". Also the mark key. */
  key: string;
  /** How many times it was logged in the window. */
  count: number;
  kind: "food" | "plate";
  /** The newest log of it: the row id (food) or plate id (plate) the favorite is saved from. */
  targetId: string;
  /** Row name (food) or the foods joined (plate); the router swaps in the plate's own name when it has one. */
  name: string;
  kcal: number;
  /** Components: 1 for a food. */
  items: number;
};

/** Habit fingerprint of a list of food names; "" when none is usable. */
export function habitKey(names: readonly string[]): string {
  return [...new Set(names.map(normalizeFoodName).filter((name) => name !== ""))].sort().join("|");
}

function groupEvents(rows: readonly OfferRow[]): LogEvent[] {
  const byPlate = new Map<string, OfferRow[]>();
  const events: LogEvent[] = [];
  for (const row of rows) {
    if (row.plateId === null) {
      events.push({ names: [row.name], rows: [row], newest: row.createdAt });
      continue;
    }
    const group = byPlate.get(row.plateId);
    if (group) group.push(row);
    else byPlate.set(row.plateId, [row]);
  }
  for (const group of byPlate.values()) {
    events.push({
      names: group.map((row) => row.name),
      rows: group,
      newest: Math.max(...group.map((row) => row.createdAt)),
    });
  }
  return events;
}

/**
 * The habit to offer: the food or combo logged most often in the window (at least OFFER_MIN_LOGS times), newest
 * first on a tie, skipping habits already saved (`savedKeys`: habitKey of each favorite's foods) and ones already
 * offered (`offeredKeys`). A habit of zero kcal (water) is not offered. Null when nothing qualifies.
 */
export function findOffer(
  rows: readonly OfferRow[],
  savedKeys: ReadonlySet<string>,
  offeredKeys: ReadonlySet<string>,
): FavoriteOffer | null {
  const byKey = new Map<string, LogEvent[]>();
  for (const event of groupEvents(rows)) {
    const key = habitKey(event.names);
    if (key === "" || savedKeys.has(key) || offeredKeys.has(key)) continue;
    const list = byKey.get(key);
    if (list) list.push(event);
    else byKey.set(key, [event]);
  }
  let best: { key: string; events: LogEvent[]; newest: number } | null = null;
  for (const [key, events] of byKey) {
    if (events.length < OFFER_MIN_LOGS) continue;
    const newest = Math.max(...events.map((event) => event.newest));
    if (!best || events.length > best.events.length || (events.length === best.events.length && newest > best.newest)) {
      best = { key, events, newest };
    }
  }
  if (!best) return null;
  const latest = best.events.find((event) => event.newest === best.newest)!;
  const kcal = latest.rows.reduce((sum, row) => sum + row.kcal, 0);
  if (!(kcal > 0)) return null;
  const first = latest.rows[0]!;
  const plateId = first.plateId;
  return plateId !== null && latest.rows.length > 1
    ? {
        key: best.key,
        count: best.events.length,
        kind: "plate",
        targetId: plateId,
        name: latest.rows.map((row) => row.name).join(", "),
        kcal: Math.round(kcal),
        items: latest.rows.length,
      }
    : {
        key: best.key,
        count: best.events.length,
        kind: "food",
        targetId: first.id,
        name: first.name,
        kcal: Math.round(kcal),
        items: 1,
      };
}
