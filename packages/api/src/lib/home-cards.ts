/**
 * The cards on Beranda below the greeting and day switcher, their order and which are shown. One definition for the
 * native app and the web app: the same ids, so an arrangement means the same on both. Pure normalising and updates; each
 * app does its own storage (native: SecureStore, web: localStorage), local to the device and not part of the account sync.
 *
 * What is stored is only what the person chose (an order and a hidden list). Reading always runs it through
 * `normalizeHomeCards`: ids this build does not know are dropped and cards it has but the stored order lacks (a card added
 * by a later release) are appended at the end, shown. An update never reshuffles or hides what someone arranged.
 */

/**
 * Default order: today's daily report first (calorie ring with macros, the activity / sleep / water / weight list, meals
 * and the plate diary), then the notices that explain the numbers, then everything secondary. Ids are stored: never
 * rename or reuse one once released; new cards go at the END of this list.
 */
export const HOME_CARD_IDS = [
  "calorie",
  "stats",
  "meals",
  "mode",
  "notices",
  "weight",
  "waist",
  "fasting",
  "mealplan",
  "ideas",
  "belanja",
  "joyofit",
  "tips",
  "recap",
  "extras",
  "promo",
] as const;

export type HomeCardId = (typeof HOME_CARD_IDS)[number];

export type HomeCardPlatform = "native" | "web";

/** Cards a platform does not have are left out of its arrangement screen; they stay in the stored order. */
const WEB_ONLY: ReadonlySet<HomeCardId> = new Set(["waist"]);
const NATIVE_ONLY: ReadonlySet<HomeCardId> = new Set(["belanja"]);

export function homeCardsFor(platform: HomeCardPlatform): HomeCardId[] {
  const skip = platform === "native" ? WEB_ONLY : NATIVE_ONLY;
  return HOME_CARD_IDS.filter((id) => !skip.has(id));
}

export interface HomeCardPrefs {
  /** Every known card exactly once. */
  readonly order: readonly HomeCardId[];
  /** Cards the person turned off; a subset of `order`. */
  readonly hidden: readonly HomeCardId[];
}

export const DEFAULT_HOME_CARDS: HomeCardPrefs = { order: HOME_CARD_IDS, hidden: [] };

const KNOWN: ReadonlySet<string> = new Set(HOME_CARD_IDS);

function knownIds(value: unknown): HomeCardId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: HomeCardId[] = [];
  for (const id of value) {
    if (typeof id === "string" && KNOWN.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id as HomeCardId);
    }
  }
  return out;
}

/** A stored order and hidden list as the prefs to use now. Anything that is not a list is treated as unset. */
export function normalizeHomeCards(order: unknown, hidden: unknown): HomeCardPrefs {
  const chosen = knownIds(order);
  const have = new Set<string>(chosen);
  return {
    order: [...chosen, ...HOME_CARD_IDS.filter((id) => !have.has(id))],
    hidden: knownIds(hidden),
  };
}

/** The stored text as prefs; null, damaged or foreign text gives the defaults. */
export function parseHomeCards(raw: string | null | undefined): HomeCardPrefs {
  if (raw === null || raw === undefined) return DEFAULT_HOME_CARDS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return DEFAULT_HOME_CARDS;
    const { order, hidden } = parsed as Record<string, unknown>;
    return normalizeHomeCards(order, hidden);
  } catch {
    return DEFAULT_HOME_CARDS;
  }
}

export function serializeHomeCards(prefs: HomeCardPrefs): string {
  return JSON.stringify({ order: prefs.order, hidden: prefs.hidden });
}

/** The cards to draw, top to bottom. */
export function visibleHomeCards(prefs: HomeCardPrefs): HomeCardId[] {
  const hidden = new Set<string>(prefs.hidden);
  return prefs.order.filter((id) => !hidden.has(id));
}

/** Shows or hides one card; the same object when nothing changes. */
export function setHomeCardHidden(prefs: HomeCardPrefs, id: HomeCardId, hide: boolean): HomeCardPrefs {
  const isHidden = prefs.hidden.includes(id);
  if (isHidden === hide) return prefs;
  return { order: prefs.order, hidden: hide ? [...prefs.hidden, id] : prefs.hidden.filter((h) => h !== id) };
}

/**
 * Moves one card `delta` places (negative is up) among the cards in `among` (what this screen lists), skipping the ones
 * it does not have, so one tap always moves a card past a visible neighbour. Stops at the ends; the same object when
 * nothing moves.
 */
export function moveHomeCard(
  prefs: HomeCardPrefs,
  id: HomeCardId,
  delta: number,
  among: readonly HomeCardId[] = HOME_CARD_IDS,
): HomeCardPrefs {
  const listed = new Set<string>(among);
  const visibleOrder = prefs.order.filter((c) => listed.has(c));
  const from = visibleOrder.indexOf(id);
  if (from === -1) return prefs;
  const to = Math.min(visibleOrder.length - 1, Math.max(0, from + delta));
  if (to === from) return prefs;
  const target = visibleOrder[to]!;
  const order = prefs.order.filter((c) => c !== id);
  const at = order.indexOf(target);
  order.splice(delta > 0 ? at + 1 : at, 0, id);
  return { order, hidden: prefs.hidden };
}

export function isDefaultHomeCards(prefs: HomeCardPrefs): boolean {
  return prefs.hidden.length === 0 && prefs.order.every((id, i) => id === HOME_CARD_IDS[i]);
}
