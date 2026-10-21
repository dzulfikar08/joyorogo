/** Languages the app ships. Add a code here AND a locales/<code>/ folder (docs/i18n.md). */
export const LOCALES = ["id", "en", "ms"] as const;
export type Locale = (typeof LOCALES)[number];

/** Source language: every key exists in it first; also the last-resort fallback. */
export const DEFAULT_LOCALE: Locale = "id";

/** Language names in their own language. Never translated, so a lost user can find theirs. */
export const LOCALE_NAMES: Record<Locale, string> = {
  id: "Bahasa Indonesia",
  en: "English",
  ms: "Bahasa Melayu",
};

/** Request header both clients send with the language they render in. */
export const LOCALE_HEADER = "x-locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** ISO 639 codes for Malay seen in the wild: `ms`, Standard Malay `zsm` (Android), `may`/`msa` (3-letter). */
const MALAY_LANGUAGES: ReadonlySet<string> = new Set(["ms", "zsm", "may", "msa"]);

/** Regions whose people default to Bahasa Melayu when their own language is not shipped (zh-MY, ta-MY, ...). */
const MALAY_REGIONS: ReadonlySet<string> = new Set(["MY"]);

function parts(tag: string): string[] {
  return tag.trim().replace(/_/g, "-").split("-");
}

/**
 * Maps a BCP-47 tag ("en-US", "id-ID", "ms-MY", legacy Android "in") to a shipped
 * locale, or null when the language is not shipped. The region is ignored here:
 * `en-MY` is English. See `matchRegionLocale` for the region fallback.
 */
export function matchLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const language = parts(tag)[0]?.toLowerCase() ?? "";
  if (language === "in") return "id";
  if (MALAY_LANGUAGES.has(language)) return "ms";
  return isLocale(language) ? language : null;
}

/**
 * Region fallback for a tag whose language is not shipped: Malaysia (`zh-MY`,
 * `ta-MY`, `pa-MY`) gets Bahasa Melayu instead of the `id` default, because
 * Indonesian is not what those users read. Null for every other region.
 */
export function matchRegionLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const region = parts(tag)
    .slice(1)
    .find((part) => /^[A-Za-z]{2}$/.test(part));
  return region && MALAY_REGIONS.has(region.toUpperCase()) ? "ms" : null;
}

/**
 * First shipped language in a list of tags (most preferred first). A language
 * match anywhere in the list beats a region match, so `["zh-MY", "en"]` is `en`
 * and `["zh-MY"]` is `ms`.
 */
export function matchTags(tags: readonly string[]): Locale | null {
  for (const tag of tags) {
    const locale = matchLocale(tag);
    if (locale) return locale;
  }
  for (const tag of tags) {
    const locale = matchRegionLocale(tag);
    if (locale) return locale;
  }
  return null;
}

/** First shipped language in an `Accept-Language` header, by the order sent. */
export function matchAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const tags = header
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { tag, q: q ? Number(q.slice(2)) : 1 };
    })
    .filter((entry) => entry.tag && entry.q > 0)
    .sort((a, b) => b.q - a.q);
  return matchTags(tags.map((entry) => entry.tag));
}

export type LocaleSources = {
  /** The choice saved on the account (profile.locale). */
  saved?: string | null;
  /** The choice stored on this device (localStorage / SecureStore): works before login. */
  stored?: string | null;
  /** Device or browser languages, most preferred first. */
  device?: string | readonly string[] | null;
};

/** saved account choice → stored device choice → device language (then device region) → `id`. */
export function resolveLocale({ saved, stored, device }: LocaleSources): Locale {
  if (isLocale(saved)) return saved;
  if (isLocale(stored)) return stored;
  const tags = typeof device === "string" ? [device] : (device ?? []);
  return matchTags(tags) ?? DEFAULT_LOCALE;
}
