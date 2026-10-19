// The week's shopping list: every ingredient of the recipes still to be eaten, summed, converted to what is bought
// (cooked rice -> raw rice), shown in friendly units and grouped by where it is found.

import { fmtDecimal, fmtInt, getT } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

import { computePortion, INGREDIENTS, recipeById } from "./catalog";
import { SHOP_CATS } from "./types";
import type { PlannedItem, ShopCat } from "./types";

export type ShoppingEntry = {
  /** ingredient key: also the key of the "bought" checkbox */
  key: string;
  name: string;
  cat: ShopCat;
  /** grams to buy, rounded up */
  grams: number;
  /** "6 butir (330 g)", "450 g", "1,2 kg" */
  amount: string;
  /** number of planned meals the ingredient is used in */
  uses: number;
};

/** Rounds a purchase up to a figure a shopper can ask for: 5 g under 50, 10 g under 200, 50 g above. */
export function roundUpGrams(g: number): number {
  if (g <= 0) return 0;
  if (g < 50) return Math.ceil(g / 5) * 5;
  if (g < 200) return Math.ceil(g / 10) * 10;
  return Math.ceil(g / 50) * 50;
}

function pick(l: { id: string; en: string }, locale: Locale): string {
  return locale === "en" ? l.en : l.id;
}

/** Sums the ingredients of `items` (recipe items only: foods the person logs themselves have no ingredient list). */
export function aggregateShopping(items: PlannedItem[], locale: Locale): ShoppingEntry[] {
  const t = getT(locale, "mealPlan");
  const sums = new Map<string, { grams: number; uses: number }>();
  for (const item of items) {
    if (!item.ref.startsWith("r:")) continue;
    const recipe = recipeById(item.ref.slice(2));
    if (!recipe) continue;
    for (const line of computePortion(recipe, item.scale, item.carbScale).lines) {
      const ratio = INGREDIENTS[line.key]?.shop?.ratio ?? 1;
      const entry = sums.get(line.key) ?? { grams: 0, uses: 0 };
      entry.grams += line.grams * ratio;
      entry.uses += 1;
      sums.set(line.key, entry);
    }
  }
  const out: ShoppingEntry[] = [];
  for (const [key, { grams, uses }] of sums) {
    const def = INGREDIENTS[key];
    if (!def) continue;
    const name = pick(def.shop?.name ?? def.name, locale);
    const buy = roundUpGrams(grams);
    let amount: string;
    if (def.unit && !def.shop) {
      const pieces = Math.max(1, Math.ceil(grams / def.unit.grams - 0.05));
      amount = t("amount.units", { n: fmtInt(pieces, locale), unit: pick(def.unit.name, locale), g: fmtInt(Math.round(pieces * def.unit.grams), locale) });
    } else if (buy >= 1000) {
      amount = t("amount.kg", { n: fmtDecimal(buy / 1000, 1, locale) });
    } else {
      amount = t("amount.grams", { g: fmtInt(buy, locale) });
    }
    out.push({ key, name, cat: def.cat, grams: buy, amount, uses });
  }
  return out.toSorted((a, b) => SHOP_CATS.indexOf(a.cat) - SHOP_CATS.indexOf(b.cat) || a.name.localeCompare(b.name, locale));
}

export type ShoppingGroup = { cat: ShopCat; label: string; items: (ShoppingEntry & { checked: boolean })[] };

export function groupShopping(entries: ShoppingEntry[], checked: Set<string>, locale: Locale): ShoppingGroup[] {
  const t = getT(locale, "mealPlan");
  return SHOP_CATS.map((cat) => ({
    cat,
    label: t(`shopping.group.${cat}`),
    items: entries.filter((e) => e.cat === cat).map((e) => ({ ...e, checked: checked.has(e.key) })),
  })).filter((g) => g.items.length > 0);
}
