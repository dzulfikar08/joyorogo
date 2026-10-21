import { resources } from "./resources";
import type { Locale } from "./locale";

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** Flattens `{ a: { b: "x" } }` to `["a.b"]`. */
function flatten(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([key, value]) =>
      flatten(value, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [];
}

/**
 * Every key a locale must define, as `namespace:path`, derived from the source
 * language. A plural key (`n_other` in the source) expands to the plural
 * categories the target language uses.
 */
function requiredKeys(locale: Locale): string[] {
  const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  const required = new Set<string>();
  for (const [ns, tree] of Object.entries(resources.id)) {
    const keys = flatten(tree);
    for (const key of keys) {
      if (PLURAL_SUFFIX.test(key)) {
        const base = key.replace(PLURAL_SUFFIX, "");
        for (const category of categories) required.add(`${ns}:${base}_${category}`);
      } else {
        required.add(`${ns}:${key}`);
      }
    }
  }
  return [...required].sort();
}

function definedKeys(locale: Locale): Set<string> {
  const defined = new Set<string>();
  for (const [ns, tree] of Object.entries(resources[locale])) {
    for (const key of flatten(tree)) defined.add(`${ns}:${key}`);
  }
  return defined;
}

/** Keys the source language has that `locale` lacks (plural-aware). */
export function missingKeys(locale: Locale): string[] {
  const defined = definedKeys(locale);
  return requiredKeys(locale).filter((key) => !defined.has(key));
}

/**
 * Keys `locale` defines that the source language does not (typos, deleted strings). A plural form the
 * language does not use (`x_one` in Malay, which only has `other`) is harmless when its base key is
 * required: the source itself may carry one, and i18next ignores it.
 */
export function orphanKeys(locale: Locale): string[] {
  const required = new Set(requiredKeys(locale));
  const bases = new Set([...required].map((key) => key.replace(PLURAL_SUFFIX, "")));
  return [...definedKeys(locale)]
    .filter((key) => !required.has(key) && !(PLURAL_SUFFIX.test(key) && bases.has(key.replace(PLURAL_SUFFIX, ""))))
    .sort();
}
