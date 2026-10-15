/**
 * Light food / snack / drink / other classification shared by the Makan filter
 * chips, the row type chip, the AI scan result and the snack advisor.
 * food_log has no kind column, so a saved row is classified from its name: a
 * whole-word match against small Indonesian + English lists, else 'makanan'
 * (makanan berat). A fresh AI scan may carry its own `kind` hint, which wins
 * through `resolveFoodKind`. It is a display and guidance aid, never stored
 * and never used for calorie math.
 */

export const FOOD_KINDS = ["makanan", "camilan", "minuman", "lainnya"] as const;

export type FoodKind = (typeof FOOD_KINDS)[number];

export const FOOD_KIND_LABELS: Record<FoodKind, string> = {
  makanan: "Makanan",
  camilan: "Camilan",
  minuman: "Minuman",
  lainnya: "Lainnya",
};

/** Filter chip values: every kind, or 'semua' for no filter. */
export type FoodKindFilter = FoodKind | "semua";

export const FOOD_KIND_FILTERS: ReadonlyArray<{ value: FoodKindFilter; label: string }> = [
  { value: "semua", label: "Semua" },
  { value: "makanan", label: FOOD_KIND_LABELS.makanan },
  { value: "camilan", label: FOOD_KIND_LABELS.camilan },
  { value: "minuman", label: FOOD_KIND_LABELS.minuman },
  { value: "lainnya", label: FOOD_KIND_LABELS.lainnya },
];

export function parseFoodKindFilter(value: unknown): FoodKindFilter | undefined {
  return FOOD_KIND_FILTERS.find((filter) => filter.value === value)?.value;
}

/** A FoodKind for an exact stored value; undefined when it is not one of ours. */
export function parseFoodKind(value: unknown): FoodKind | undefined {
  return FOOD_KINDS.find((kind) => kind === value);
}

/** Words a vision model tends to answer with for `kind`, mapped onto ours. */
const KIND_ALIASES: Record<string, FoodKind> = {
  makanan: "makanan",
  "makanan berat": "makanan",
  berat: "makanan",
  food: "makanan",
  meal: "makanan",
  camilan: "camilan",
  cemilan: "camilan",
  snack: "camilan",
  jajanan: "camilan",
  minuman: "minuman",
  drink: "minuman",
  beverage: "minuman",
  lainnya: "lainnya",
};

/** Lenient parse of a model-supplied kind ("Makanan Berat", "snack"); undefined when unusable. */
export function normalizeFoodKind(value: unknown): FoodKind | undefined {
  if (typeof value !== "string") return undefined;
  return KIND_ALIASES[value.trim().toLowerCase()];
}

const DRINK_WORDS = new Set([
  "kopi",
  "coffee",
  "latte",
  "americano",
  "espresso",
  "cappuccino",
  "capuccino",
  "cappucino",
  "mocha",
  "macchiato",
  "teh",
  "tea",
  "matcha",
  "es",
  "jus",
  "juice",
  "smoothie",
  "susu",
  "milk",
  "milkshake",
  "boba",
  "soda",
  "cola",
  "sprite",
  "fanta",
  "minuman",
  "sirup",
  "sirop",
  "wedang",
  "bandrek",
  "bajigur",
  "cendol",
  "dawet",
  "cincau",
  "yakult",
  "jamu",
  "stmj",
  "bir",
  "beer",
  "wine",
]);

const DRINK_PHRASES = [
  "air putih",
  "air mineral",
  "air kelapa",
  "kelapa muda",
  "energy drink",
  "coklat panas",
  "cokelat panas",
];

const OTHER_WORDS = new Set([
  "suplemen",
  "supplement",
  "vitamin",
  "multivitamin",
  "kapsul",
  "tablet",
  "obat",
  "whey",
  "kolagen",
  "collagen",
  "omega",
  "elektrolit",
  "permen",
  "gum",
]);

/** Desserts and fried bites are camilan; "es krim" is not the `es` (iced drink) word. */
const SNACK_DESSERT = /\b(es krim|ice cream)\b/;

const SNACK_WORDS = new Set([
  "gorengan",
  "bakwan",
  "mendoan",
  "cireng",
  "risol",
  "risoles",
  "pastel",
  "combro",
  "misro",
  "kue",
  "kuenya",
  "bolu",
  "brownies",
  "brownie",
  "donat",
  "donut",
  "cake",
  "cupcake",
  "muffin",
  "cookies",
  "cookie",
  "biskuit",
  "wafer",
  "keripik",
  "kripik",
  "chips",
  "martabak",
  "kerupuk",
  "popcorn",
  "dodol",
  "klepon",
  "lemper",
  "getuk",
  "serabi",
  "cilok",
  "basreng",
  "puding",
  "pudding",
  "croissant",
  "waffle",
  "pancake",
  "camilan",
  "cemilan",
  "snack",
  "jajanan",
  "onde",
]);

// Multi-word snacks: "goreng" alone is also nasi/ayam/mie goreng (makanan berat).
const SNACK_PHRASES = [
  "pisang goreng",
  "singkong goreng",
  "ubi goreng",
  "tahu goreng",
  "tempe goreng",
  "tempe mendoan",
  "tahu isi",
  "tahu crispy",
  "tahu walik",
  "bala-bala",
  "terang bulan",
  "roti bakar",
  "kentang goreng",
  "french fries",
  "kacang goreng",
  "kacang tanah",
  "es krim",
  "ice cream",
];

export function foodKind(name: string): FoodKind {
  const text = name.toLowerCase();
  const words = text.split(/[^a-z]+/).filter(Boolean);
  if (words.some((word) => OTHER_WORDS.has(word))) return "lainnya";
  if (DRINK_PHRASES.some((phrase) => text.includes(phrase))) return "minuman";
  if (SNACK_DESSERT.test(text)) return "camilan";
  if (SNACK_PHRASES.some((phrase) => text.includes(phrase))) return "camilan";
  if (words.some((word) => SNACK_WORDS.has(word))) return "camilan";
  if (words.some((word) => DRINK_WORDS.has(word))) return "minuman";
  return "makanan";
}

/**
 * Rice/noodle/lauk words that make a dish a main meal. A vision model
 * sometimes calls nasi kuning "snack"; these names win over a camilan hint.
 */
const STAPLE_WORDS: Record<string, true> = Object.fromEntries(
  [
    "nasi",
    "mie",
    "mi",
    "bihun",
    "kwetiau",
    "lontong",
    "ketupat",
    "soto",
    "rawon",
    "bubur",
    "sate",
    "satay",
    "gado",
    "pecel",
    "rendang",
    "opor",
    "ayam",
    "bakso",
    "pasta",
    "spaghetti",
    "burger",
    "pizza",
  ].map((word) => [word, true] as const),
);

/** True for a name that is a heavy main dish (nasi, mie, lontong, lauk). */
export function isHeavyDish(name: string): boolean {
  if (foodKind(name) !== "makanan") return false;
  return name
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((word) => STAPLE_WORDS[word] === true);
}

/**
 * The kind for an item: the AI's own call when it made a usable one, else the
 * name heuristic. A hint of 'lainnya' is ignored so supplements still come
 * from the name list; a camilan/minuman hint never overrides a staple name.
 */
export function resolveFoodKind(name: string, hint?: unknown): FoodKind {
  const fromAi = normalizeFoodKind(hint);
  if (fromAi && fromAi !== "lainnya") {
    if (fromAi !== "makanan" && isHeavyDish(name)) return "makanan";
    return fromAi;
  }
  return foodKind(name);
}

/** True when `name` passes the chip filter. */
export function matchesKind(name: string, filter: FoodKindFilter): boolean {
  return filter === "semua" || foodKind(name) === filter;
}
