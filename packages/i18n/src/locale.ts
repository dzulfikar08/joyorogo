/** Languages the app ships. Add a code here AND a locales/<code>/ folder (docs/i18n.md). */
export const LOCALES = ["id", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** Source language: every key exists in it first; also the last-resort fallback. */
export const DEFAULT_LOCALE: Locale = "id";

/** Language names in their own language. Never translated, so a lost user can find theirs. */
export const LOCALE_NAMES: Record<Locale, string> = {
  id: "Bahasa Indonesia",
  en: "English",
};

/** Request header both clients send with the language they render in. */
export const LOCALE_HEADER = "x-locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Maps a BCP-47 tag ("en-US", "id-ID", legacy Android "in") to a shipped locale,
 * or null when the language is not shipped.
 */
export function matchLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const language = tag.trim().toLowerCase().replace(/_/g, "-").split("-")[0];
  if (language === "in") return "id";
  return isLocale(language) ? language : null;
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
  for (const { tag } of tags) {
    const locale = matchLocale(tag);
    if (locale) return locale;
  }
  return null;
}

export type LocaleSources = {
  /** The choice saved on the account (profile.locale). */
  saved?: string | null;
  /** The choice stored on this device (localStorage / SecureStore): works before login. */
  stored?: string | null;
  /** Device or browser languages, most preferred first. */
  device?: string | readonly string[] | null;
};

/** saved account choice → stored device choice → device language → `id`. */
export function resolveLocale({ saved, stored, device }: LocaleSources): Locale {
  if (isLocale(saved)) return saved;
  if (isLocale(stored)) return stored;
  const tags = typeof device === "string" ? [device] : (device ?? []);
  for (const tag of tags) {
    const locale = matchLocale(tag);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}
