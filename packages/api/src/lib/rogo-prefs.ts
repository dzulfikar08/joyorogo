import { ADD_BACK_SANITIZERS, DEFAULT_ADD_BACK_SETTINGS } from "./exercise-credit";
import { DEFAULT_MAKAN_VIEW, parseMakanView } from "./diary-view";
import { parseFoodKindFilter } from "./food-kind";
import { DEFAULT_REMINDER_CONFIG, sanitizeConfig } from "./reminder-config";

// The preferences that follow a JoyoRogo account to every phone and browser (sync namespace `rogo`, kind `pref`, record
// id = the key below, document `{ "value": ... }`). Contract: docs/multi-device.md. One sanitizer per key decides what
// a phone may store and what it accepts from the server: a document written by another phone, an older build or a bad
// client never reaches storage unless it passes here.
//
// A key at its default value is not stored: the phone sends a tombstone instead, so a default never overwrites
// somebody's real choice and resetting on one phone resets it everywhere.
//
// NOT synced, on purpose (each is a fact about one device, not about the person):
//  - the language: it lives in `profile.locale`, which the server also uses for push and email;
//  - notification permission, the push token and the scheduled reminder notifications themselves (the OS owns them;
//    the reminder CHOICES do sync and are rescheduled on every phone that has permission);
//  - the "save my location" switch (it mirrors this phone's OS location permission);
//  - app update dismissals and the OTA / Play-update state (each phone runs its own build);
//  - the Apple Health first-sync flag, the widget cache and the camera choice (hardware and OS state);
//  - the web iOS install banner and the analytics flags (browser state).

export interface RogoPrefSpec {
  /** The cleaned value, or undefined for anything malformed. */
  sanitize(value: unknown): unknown | undefined;
  /** Whether a sanitized value equals the default, i.e. is sent as a tombstone. */
  isDefault(value: unknown): boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export const THEMES = ["light", "dark", "system"] as const;
export type RogoTheme = (typeof THEMES)[number];

export type StickerPrefs = { hideNumbers: boolean; showName: boolean; watermark: boolean };
/** The privacy-safe options a sticker starts with. */
export const DEFAULT_STICKER_PREFS: StickerPrefs = { hideNumbers: true, showName: false, watermark: true };

const STICKER_FIELDS = Object.keys(DEFAULT_STICKER_PREFS) as (keyof StickerPrefs)[];

function sanitizeSticker(value: unknown): StickerPrefs | undefined {
  if (!isObject(value)) return undefined;
  const out = { ...DEFAULT_STICKER_PREFS };
  for (const field of STICKER_FIELDS) {
    const entry = value[field];
    if (entry === undefined) continue;
    if (typeof entry !== "boolean") return undefined;
    out[field] = entry;
  }
  return out;
}

/** A banner the person closed; only `true` is a value (not dismissed = no record). */
const dismissal: RogoPrefSpec = {
  sanitize: (value) => (value === true ? true : undefined),
  isDefault: () => false,
};

/** "Kalori olahraga" (lib/exercise-credit): how much of the day's activity is added to Sisa. Read by the server too. */
const addBack = (field: keyof typeof DEFAULT_ADD_BACK_SETTINGS, key: keyof typeof ADD_BACK_SANITIZERS): RogoPrefSpec => ({
  sanitize: ADD_BACK_SANITIZERS[key],
  isDefault: (value) => value === DEFAULT_ADD_BACK_SETTINGS[field],
});

const SPECS = {
  "exercise.addBack.enabled": addBack("enabled", "exercise.addBack.enabled"),
  "exercise.addBack.pct": addBack("pct", "exercise.addBack.pct"),
  "exercise.addBack.cap": addBack("cap", "exercise.addBack.cap"),
  "exercise.assumedActive": addBack("assumedKcal", "exercise.assumedActive"),
  theme: {
    sanitize: (value) => THEMES.find((theme) => theme === value),
    isDefault: (value) => value === "system",
  },
  /** Native only: the reminder choices (meals, water, weigh-in, Naikin BB evening, IF window). */
  reminders: {
    sanitize: (value) => (isObject(value) ? sanitizeConfig(value) : undefined),
    isDefault: (value) => same(value, DEFAULT_REMINDER_CONFIG),
  },
  "makan.view": {
    sanitize: (value) => parseMakanView(value),
    isDefault: (value) => value === DEFAULT_MAKAN_VIEW,
  },
  "makan.kind": {
    sanitize: (value) => parseFoodKindFilter(value),
    isDefault: (value) => value === "semua",
  },
  sticker: {
    sanitize: sanitizeSticker,
    isDefault: (value) => same(value, DEFAULT_STICKER_PREFS),
  },
  // The local keys carry the user id (one phone can hold several accounts); the synced key does not, the account is
  // the record's owner.
  "dismissed.handlePrompt": dismissal,
  "dismissed.stravaRetention7d": dismissal,
  // The one-time "how Sisa is counted changed" notice on Beranda (accounts made before the change). The id carries a
  // number: it was bumped when the base changed again, which shows the notice once more to everybody who had closed it.
  // The earlier `dismissed.addBackNotice` and the removed `exercise.addBack.source` / `.stepThreshold` records may still
  // be in an account (older builds write them); no build reads them any more.
  "dismissed.addBackNotice2": dismissal,
} satisfies Record<string, RogoPrefSpec>;

export type RogoPrefKey = keyof typeof SPECS;

export const ROGO_PREF_KEYS = Object.keys(SPECS) as RogoPrefKey[];

export function isRogoPrefKey(key: string): key is RogoPrefKey {
  return Object.hasOwn(SPECS, key);
}

/** The cleaned value of `key`, or undefined when the key is unknown or the value malformed. */
export function sanitizeRogoPref(key: string, value: unknown): unknown | undefined {
  return isRogoPrefKey(key) ? SPECS[key].sanitize(value) : undefined;
}

/** Whether `value` (already sanitized) is the key's default. */
export function isRogoPrefDefault(key: RogoPrefKey, value: unknown): boolean {
  return SPECS[key].isDefault(value);
}
