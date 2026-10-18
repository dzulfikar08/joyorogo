import { getT, type Locale } from "@joyorogo/i18n";

import type { Translate } from "../core/expr";

/** `ns:key` translator over the stateless i18n instance; works in Node, web and native. */
export function rogoTranslate(locale: Locale): Translate {
  const t = getT(locale);
  return (key, args) => (t as (k: string, o: Record<string, unknown>) => string)(key, args);
}
