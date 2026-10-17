import i18next from "i18next";
import type { i18n as I18n, TFunction } from "i18next";

import { DEFAULT_LOCALE, LOCALES } from "./locale";
import type { Locale } from "./locale";
import { DEFAULT_NAMESPACE, NAMESPACES, resources } from "./resources";
import type { Namespace } from "./resources";
import "./types";

export type { TFunction } from "i18next";

const OPTIONS = {
  resources,
  supportedLngs: [...LOCALES],
  fallbackLng: DEFAULT_LOCALE,
  ns: NAMESPACES,
  defaultNS: DEFAULT_NAMESPACE,
  // React and React Native escape on their own; escaping here would double-encode.
  interpolation: { escapeValue: false },
  returnNull: false as const,
  // Resources are bundled, so init is synchronous: t() works on the first render.
  initAsync: false,
  react: { useSuspense: false },
};

/** The client instance (web + native). The apps bind it to React via `initI18n`. */
export const i18n: I18n = i18next.createInstance();

type Plugin = Parameters<I18n["use"]>[0];

/**
 * Initialises the shared client instance once. `plugins` is where each app
 * passes its own `initReactI18next`: react-i18next must resolve the same React
 * copy as the app, so it is never imported from this package.
 */
export function initI18n({ locale, plugins = [] }: { locale: Locale; plugins?: Plugin[] }): I18n {
  if (i18n.isInitialized) return i18n;
  for (const plugin of plugins) i18n.use(plugin);
  void i18n.init({ ...OPTIONS, lng: locale });
  return i18n;
}

// Server and formatting helpers need any locale at any time (a Worker serves
// every language concurrently), so they use a separate, stateless instance and
// getFixedT instead of the language switch of the client instance.
let standalone: I18n | undefined;

function standaloneInstance(): I18n {
  if (!standalone) {
    standalone = i18next.createInstance();
    void standalone.init({ ...OPTIONS, lng: DEFAULT_LOCALE });
  }
  return standalone;
}

/** Translator for one locale, independent of the client's current language. */
export function getT<N extends Namespace = typeof DEFAULT_NAMESPACE>(
  locale: Locale,
  ns?: N,
): TFunction<N> {
  return standaloneInstance().getFixedT(locale, ns ?? DEFAULT_NAMESPACE) as TFunction<N>;
}
