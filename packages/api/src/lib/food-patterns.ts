// Eating patterns of a week, read from the food_log item names (the table has no category column, see
// lib/food-kind.ts): deep-fried or battered food, a second starch on the same meal, and sweets / sweet drinks. Names
// are matched against small Indonesian + English lists on whole words, so "nasi goreng" (stir-fried rice) is not a
// fried food but still counts as a starch, and "kecap manis" / "asam manis" are not sweets. Pure; a hint for the
// weekly reflection, never used for calorie math. What leaves this module is a term from our own lists, never the
// person's own text, so a food name cannot carry instructions into the AI prompt.

export type FoodPatternKind = "fried" | "double_carb" | "sweet";

export interface FoodItemInput {
  date: string;
  meal: string;
  name: string;
  kcal: number;
}

export interface FoodPatternHit {
  pattern: FoodPatternKind;
  /** Matching items (fried, sweet) or meals with two starches (double_carb). */
  count: number;
  /** Distinct days it happened on. */
  days: number;
  /** Share of the week's logged kcal that sat in the matching items (all items of a double-starch meal). */
  kcalSharePct: number;
  /** Up to three of our own list terms that matched most often. */
  examples: string[];
}

/** A pattern is only reported from this many matches, so one fried snack is not a "pattern". */
export const FOOD_PATTERN_MIN = {
  fried: { count: 4, days: 3 },
  sweet: { count: 4, days: 3 },
  doubleCarb: { meals: 3 },
} as const;

/** Lowercase, letters and digits only, single spaces: "Es Teh-Manis (L)" -> "es teh manis l". */
export function normalizeFoodName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const words = (normalized: string): string[] => (normalized === "" ? [] : normalized.split(" "));

/** First of `phrases` that appears in `normalized` as whole words. */
function findPhrase(normalized: string, phrases: readonly string[]): string | null {
  const padded = ` ${normalized} `;
  return phrases.find((phrase) => padded.includes(` ${phrase} `)) ?? null;
}

// ---- fried ----

const FRIED_PHRASES = [
  "gorengan",
  "bakwan",
  "mendoan",
  "cireng",
  "risol",
  "risoles",
  "tempura",
  "katsu",
  "crispy",
  "krispi",
  "kriuk",
  "geprek",
  "penyet",
  "kremes",
  "nugget",
  "nuggets",
  "ayam tepung",
  "udang tepung",
  "cumi tepung",
  "tahu bulat",
  "tahu crispy",
  "kentang goreng",
  "french fries",
  "fries",
  "fried chicken",
  "deep fried",
  "battered",
  "breaded",
  "onion rings",
  "fish and chips",
] as const;

/** A word before "goreng" / "fried" that makes it a stir-fry or a pan-fried egg, not deep-fried food. */
const STIR_FRIED_BASES = new Set(["nasi", "mie", "mi", "bihun", "kwetiau", "kwetiaw", "bakmi", "soun", "sohun", "kangkung", "sayur", "capcay", "telur", "tumis", "stir", "pan"]);
const STIR_FRIED_AFTER = new Set(["rice", "noodle", "noodles", "egg", "eggs", "vegetable", "vegetables", "veggies"]);

/** The list term that makes `normalized` a deep-fried food; null when it is none. */
export function friedTerm(normalized: string): string | null {
  const explicit = findPhrase(normalized, FRIED_PHRASES);
  if (explicit) return explicit;
  const parts = words(normalized);
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i] === "goreng") {
      const before = parts[i - 1];
      if (before === undefined || !STIR_FRIED_BASES.has(before)) return "makanan goreng";
    }
    if (parts[i] === "fried") {
      const before = parts[i - 1];
      const after = parts[i + 1];
      if (!(before !== undefined && STIR_FRIED_BASES.has(before)) && !(after !== undefined && STIR_FRIED_AFTER.has(after))) return "fried food";
    }
  }
  return null;
}

// ---- sweets ----

const SWEET_PHRASES = [
  "boba",
  "bubble tea",
  "es krim",
  "ice cream",
  "donat",
  "donut",
  "kue",
  "cake",
  "cupcake",
  "brownies",
  "brownie",
  "cokelat",
  "coklat",
  "chocolate",
  "martabak manis",
  "terang bulan",
  "dessert",
  "puding",
  "pudding",
  "permen",
  "candy",
  "wafer",
  "biskuit",
  "cookies",
  "cookie",
  "soda",
  "cola",
  "sprite",
  "fanta",
  "sirup",
  "sirop",
  "syrup",
  "milkshake",
  "frappe",
  "frappuccino",
  "thai tea",
  "es campur",
  "es teler",
  "es doger",
  "cendol",
  "dawet",
  "kolak",
  "klepon",
  "dodol",
  "lapis legit",
  "bolu",
  "gula aren",
  "karamel",
  "caramel",
  "teh botol",
  "sweet tea",
  "sweetened",
  "sugary",
  "es teh",
] as const;

/** Spoken-for-sugarless markers that cancel a sweet match ("es teh tawar", "kopi tanpa gula"). */
const UNSWEET = ["tawar", "unsweet", "unsweetened", "tanpa gula", "no sugar", "sugar free", "zero"] as const;
/** "manis" after these is a sauce or a dish, not a sweet. */
const SAVORY_MANIS_BEFORE = new Set(["kecap", "asam", "saus", "sambal", "bumbu"]);

/** The list term that makes `normalized` a sweet or a sweet drink; null when it is none. */
export function sweetTerm(normalized: string): string | null {
  if (findPhrase(normalized, UNSWEET)) return null;
  const explicit = findPhrase(normalized, SWEET_PHRASES);
  if (explicit) return explicit;
  const parts = words(normalized);
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i] === "manis" && !(parts[i - 1] !== undefined && SAVORY_MANIS_BEFORE.has(parts[i - 1]!))) return "manis";
  }
  return null;
}

// ---- starches ----

/** Canonical starch -> the words that name it. Two different starches on one meal is a double-carb meal. */
const STARCHES: ReadonlyArray<readonly [canonical: string, terms: readonly string[]]> = [
  ["nasi", ["nasi", "rice"]],
  ["lontong", ["lontong", "ketupat", "buras"]],
  ["bubur", ["bubur", "porridge", "congee"]],
  ["mie", ["mie", "mi", "bihun", "kwetiau", "kwetiaw", "bakmi", "soun", "sohun", "spaghetti", "pasta", "makaroni", "macaroni", "noodle", "noodles", "indomie", "ramen", "udon"]],
  ["kentang", ["kentang", "potato", "potatoes", "fries", "wedges"]],
  ["roti", ["roti", "bread", "toast", "bun", "bagel"]],
  ["singkong", ["singkong", "ubi", "talas", "cassava", "yam"]],
];

/** Canonical starches named in `normalized`. */
export function starchesIn(normalized: string): string[] {
  const parts = new Set(words(normalized));
  return STARCHES.filter(([, terms]) => terms.some((term) => parts.has(term))).map(([canonical]) => canonical);
}

// ---- week scan ----

const top3 = (counts: Map<string, number>): string[] =>
  [...counts.entries()]
    .toSorted((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 3)
    .map(([term]) => term);

/**
 * The patterns that reach their threshold in `items` (the judged days of one week). Fried and sweet count matching
 * items, double_carb counts meals; each hit says how many days it spread over and how much of the week's kcal it was.
 */
export function detectFoodPatterns(items: readonly FoodItemInput[]): FoodPatternHit[] {
  const totalKcal = items.reduce((sum, item) => sum + Math.max(0, item.kcal), 0);
  const share = (kcal: number) => (totalKcal > 0 ? Math.round((kcal / totalKcal) * 100) : 0);

  const fried = { count: 0, kcal: 0, days: new Set<string>(), terms: new Map<string, number>() };
  const sweet = { count: 0, kcal: 0, days: new Set<string>(), terms: new Map<string, number>() };
  const meals = new Map<string, { date: string; kcal: number; starches: Set<string> }>();

  for (const item of items) {
    const name = normalizeFoodName(item.name);
    if (name === "") continue;
    const kcal = Math.max(0, item.kcal);
    for (const [bucket, term] of [
      [fried, friedTerm(name)],
      [sweet, sweetTerm(name)],
    ] as const) {
      if (term === null) continue;
      bucket.count += 1;
      bucket.kcal += kcal;
      bucket.days.add(item.date);
      bucket.terms.set(term, (bucket.terms.get(term) ?? 0) + 1);
    }
    const key = `${item.date}|${item.meal}`;
    const meal = meals.get(key) ?? { date: item.date, kcal: 0, starches: new Set<string>() };
    meal.kcal += kcal;
    for (const starch of starchesIn(name)) meal.starches.add(starch);
    meals.set(key, meal);
  }

  const hits: FoodPatternHit[] = [];
  if (fried.count >= FOOD_PATTERN_MIN.fried.count && fried.days.size >= FOOD_PATTERN_MIN.fried.days) {
    hits.push({ pattern: "fried", count: fried.count, days: fried.days.size, kcalSharePct: share(fried.kcal), examples: top3(fried.terms) });
  }
  const doubled = [...meals.values()].filter((meal) => meal.starches.size >= 2);
  if (doubled.length >= FOOD_PATTERN_MIN.doubleCarb.meals) {
    const pairs = new Map<string, number>();
    for (const meal of doubled) {
      const pair = [...meal.starches].toSorted().join(" + ");
      pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
    }
    hits.push({
      pattern: "double_carb",
      count: doubled.length,
      days: new Set(doubled.map((meal) => meal.date)).size,
      kcalSharePct: share(doubled.reduce((sum, meal) => sum + meal.kcal, 0)),
      examples: top3(pairs),
    });
  }
  if (sweet.count >= FOOD_PATTERN_MIN.sweet.count && sweet.days.size >= FOOD_PATTERN_MIN.sweet.days) {
    hits.push({ pattern: "sweet", count: sweet.count, days: sweet.days.size, kcalSharePct: share(sweet.kcal), examples: top3(sweet.terms) });
  }
  return hits;
}
