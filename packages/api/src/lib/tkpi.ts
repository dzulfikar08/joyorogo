// Curated Indonesian dish library for post-parse calibration.
// kcal/fiber values are rounded from TKPI (Tabel Komposisi Pangan Indonesia)
// style food-composition data plus pubchem-class nutrient entries; the point
// is a plausible band per dish, not lab precision.
import { foodKind } from "./food-kind";
import { lookupTkpi2019, portionFromTkpi2019 } from "./tkpi2019";

export type TdpiDish = {
  name: string;
  aliases: string[];
  typicalPortionG: number;
  kcalPer100g: number;
  fiberPer100g: number;
  plausibleKcalRange: [number, number];
};

export const TKPI_DISHES: TdpiDish[] = [
  {
    name: "nasi putih",
    aliases: ["nasi", "steamed rice"],
    typicalPortionG: 150,
    kcalPer100g: 130,
    fiberPer100g: 0.3,
    plausibleKcalRange: [150, 350],
  },
  {
    name: "nasi goreng",
    aliases: ["nasgor", "fried rice"],
    typicalPortionG: 250,
    kcalPer100g: 180,
    fiberPer100g: 2,
    plausibleKcalRange: [300, 700],
  },
  {
    name: "nasi uduk",
    aliases: ["nasi lemak"],
    typicalPortionG: 200,
    kcalPer100g: 190,
    fiberPer100g: 1,
    plausibleKcalRange: [300, 550],
  },
  {
    name: "nasi kuning",
    aliases: ["yellow rice"],
    typicalPortionG: 200,
    kcalPer100g: 160,
    fiberPer100g: 1,
    plausibleKcalRange: [250, 450],
  },
  {
    name: "bubur ayam",
    aliases: ["congee", "bubur"],
    typicalPortionG: 350,
    kcalPer100g: 90,
    fiberPer100g: 0.5,
    plausibleKcalRange: [200, 420],
  },
  {
    name: "mie goreng",
    aliases: ["mi goreng", "fried noodle"],
    typicalPortionG: 250,
    kcalPer100g: 180,
    fiberPer100g: 2,
    plausibleKcalRange: [300, 650],
  },
  {
    name: "mie ayam",
    aliases: ["mi ayam", "chicken noodle"],
    typicalPortionG: 350,
    kcalPer100g: 150,
    fiberPer100g: 2,
    plausibleKcalRange: [350, 650],
  },
  {
    name: "bihun goreng",
    aliases: ["meehoon goreng"],
    typicalPortionG: 250,
    kcalPer100g: 170,
    fiberPer100g: 1.5,
    plausibleKcalRange: [300, 600],
  },
  {
    name: "kwetiau goreng",
    aliases: ["kwetiau", "kway teow"],
    typicalPortionG: 300,
    kcalPer100g: 150,
    fiberPer100g: 1.5,
    plausibleKcalRange: [300, 600],
  },
  {
    name: "ayam geprek",
    aliases: ["geprek", "ayam geprek sambal"],
    typicalPortionG: 200,
    kcalPer100g: 220,
    fiberPer100g: 1,
    plausibleKcalRange: [350, 700],
  },
  {
    name: "ayam goreng",
    aliases: ["fried chicken", "ayam krispi"],
    typicalPortionG: 150,
    kcalPer100g: 260,
    fiberPer100g: 0.5,
    plausibleKcalRange: [300, 600],
  },
  {
    name: "ayam bakar",
    aliases: ["grilled chicken"],
    typicalPortionG: 200,
    kcalPer100g: 180,
    fiberPer100g: 0.5,
    plausibleKcalRange: [280, 500],
  },
  {
    name: "opor ayam",
    aliases: ["opor"],
    typicalPortionG: 200,
    kcalPer100g: 190,
    fiberPer100g: 0.5,
    plausibleKcalRange: [280, 550],
  },
  {
    name: "sate ayam",
    aliases: ["sate", "satay", "sate babi"],
    typicalPortionG: 200,
    kcalPer100g: 200,
    fiberPer100g: 0.5,
    plausibleKcalRange: [250, 500],
  },
  {
    name: "bakso",
    aliases: ["bakso sapi", "bakso urat", "meatball"],
    typicalPortionG: 400,
    kcalPer100g: 110,
    fiberPer100g: 0.5,
    plausibleKcalRange: [250, 500],
  },
  {
    name: "gado-gado",
    aliases: ["gado gado", "gado2"],
    typicalPortionG: 300,
    kcalPer100g: 130,
    fiberPer100g: 4,
    plausibleKcalRange: [250, 500],
  },
  {
    name: "pecel",
    aliases: ["pecel lele", "pecel sayur"],
    typicalPortionG: 250,
    kcalPer100g: 180,
    fiberPer100g: 3,
    plausibleKcalRange: [300, 700],
  },
  {
    name: "soto ayam",
    aliases: ["soto", "coto ayam"],
    typicalPortionG: 400,
    kcalPer100g: 100,
    fiberPer100g: 0.5,
    plausibleKcalRange: [200, 450],
  },
  {
    name: "soto babat",
    aliases: ["soto daging"],
    typicalPortionG: 400,
    kcalPer100g: 120,
    fiberPer100g: 0.5,
    plausibleKcalRange: [250, 550],
  },
  {
    name: "rawon",
    aliases: ["rawon daging"],
    typicalPortionG: 400,
    kcalPer100g: 120,
    fiberPer100g: 0.5,
    plausibleKcalRange: [250, 500],
  },
  {
    name: "rendang",
    aliases: ["rendang sapi", "rendang daging"],
    typicalPortionG: 150,
    kcalPer100g: 290,
    fiberPer100g: 1,
    plausibleKcalRange: [300, 650],
  },
  {
    name: "sayur lodeh",
    aliases: ["lodeh", "sayur nangka"],
    typicalPortionG: 250,
    kcalPer100g: 80,
    fiberPer100g: 3,
    plausibleKcalRange: [120, 300],
  },
  {
    name: "sayur asem",
    aliases: ["asem", "sayur asam"],
    typicalPortionG: 250,
    kcalPer100g: 50,
    fiberPer100g: 2,
    plausibleKcalRange: [80, 200],
  },
  {
    name: "capcay",
    aliases: ["cap cai", "cap cay"],
    typicalPortionG: 300,
    kcalPer100g: 90,
    fiberPer100g: 2,
    plausibleKcalRange: [150, 350],
  },
  {
    name: "lalapan",
    aliases: ["lalab", "sayur mentah"],
    typicalPortionG: 100,
    kcalPer100g: 40,
    fiberPer100g: 2,
    plausibleKcalRange: [20, 70],
  },
  {
    name: "tumis kangkung",
    aliases: ["cah kangkung", "kangkung"],
    typicalPortionG: 150,
    kcalPer100g: 70,
    fiberPer100g: 2,
    plausibleKcalRange: [60, 180],
  },
  {
    name: "telur ceplok",
    aliases: ["telur mata sapi", "fried egg"],
    typicalPortionG: 60,
    kcalPer100g: 210,
    fiberPer100g: 0,
    plausibleKcalRange: [120, 220],
  },
  {
    name: "telur dadar",
    aliases: ["omelet", "dadar telur"],
    typicalPortionG: 80,
    kcalPer100g: 200,
    fiberPer100g: 0,
    plausibleKcalRange: [130, 250],
  },
  {
    name: "tahu",
    aliases: ["tahu goreng", "beancurd", "tahu sumedang"],
    typicalPortionG: 100,
    kcalPer100g: 80,
    fiberPer100g: 0.5,
    plausibleKcalRange: [60, 150],
  },
  {
    name: "tempe",
    aliases: ["tempe goreng", "tempeh"],
    typicalPortionG: 80,
    kcalPer100g: 200,
    fiberPer100g: 2,
    plausibleKcalRange: [120, 220],
  },
  {
    name: "orek tempe",
    aliases: ["tempe orek"],
    typicalPortionG: 80,
    kcalPer100g: 320,
    fiberPer100g: 3,
    plausibleKcalRange: [180, 320],
  },
  {
    name: "kerupuk",
    aliases: ["krupuk", "kerupuk udang"],
    typicalPortionG: 20,
    kcalPer100g: 500,
    fiberPer100g: 1,
    plausibleKcalRange: [80, 150],
  },
  {
    name: "perkedel",
    aliases: ["perkedel kentang", "bekedel"],
    typicalPortionG: 50,
    kcalPer100g: 200,
    fiberPer100g: 1.5,
    plausibleKcalRange: [70, 160],
  },
  {
    name: "sambal",
    aliases: ["sambal terasi", "sambal ulek", "sambal bajak"],
    typicalPortionG: 15,
    kcalPer100g: 110,
    fiberPer100g: 2,
    plausibleKcalRange: [5, 80],
  },
  {
    name: "sambal goreng ati",
    aliases: ["ati ampela", "sambal goreng"],
    typicalPortionG: 120,
    kcalPer100g: 200,
    fiberPer100g: 1,
    plausibleKcalRange: [150, 350],
  },
  {
    name: "ikan goreng",
    aliases: ["ikan bakar", "ikan kembung goreng"],
    typicalPortionG: 120,
    kcalPer100g: 220,
    fiberPer100g: 0,
    plausibleKcalRange: [180, 400],
  },
  {
    name: "pisang goreng",
    aliases: ["gedang goreng", "fried banana"],
    typicalPortionG: 100,
    kcalPer100g: 300,
    fiberPer100g: 2,
    plausibleKcalRange: [200, 400],
  },
  {
    name: "martabak manis",
    aliases: ["terang bulan", "martabak"],
    typicalPortionG: 150,
    kcalPer100g: 300,
    fiberPer100g: 1.5,
    plausibleKcalRange: [350, 700],
  },
  {
    name: "martabak telur",
    aliases: ["martabak asin"],
    typicalPortionG: 150,
    kcalPer100g: 250,
    fiberPer100g: 1,
    plausibleKcalRange: [300, 600],
  },
  {
    name: "roti bakar",
    aliases: ["toast", "roti bakar coklat"],
    typicalPortionG: 100,
    kcalPer100g: 300,
    fiberPer100g: 2,
    plausibleKcalRange: [200, 400],
  },
  {
    name: "es teh",
    aliases: ["esteh", "teh manis", "es teh manis", "teh botol"],
    typicalPortionG: 250,
    kcalPer100g: 30,
    fiberPer100g: 0,
    plausibleKcalRange: [20, 90],
  },
  // Drinks with (almost) no energy. Without their own rows the generic band
  // floors them at 20 kcal and "teh tawar" used to land in es teh's 20-90.
  {
    name: "teh tawar",
    aliases: ["es teh tawar", "teh pahit", "teh hijau tawar", "green tea tawar", "unsweetened tea"],
    typicalPortionG: 250,
    kcalPer100g: 0.4,
    fiberPer100g: 0,
    plausibleKcalRange: [0, 10],
  },
  {
    name: "kopi hitam",
    aliases: ["kopi tubruk", "kopi tanpa gula", "kopi pahit", "black coffee", "es kopi hitam"],
    typicalPortionG: 200,
    kcalPer100g: 1,
    fiberPer100g: 0,
    plausibleKcalRange: [0, 10],
  },
  {
    name: "air putih",
    aliases: ["air mineral", "air minum", "air biasa", "aqua", "mineral water"],
    typicalPortionG: 250,
    kcalPer100g: 0,
    fiberPer100g: 0,
    plausibleKcalRange: [0, 0],
  },
  {
    name: "minuman zero",
    aliases: [
      "coke zero",
      "coca cola zero",
      "coca-cola zero",
      "diet coke",
      "coke light",
      "pepsi max",
      "pepsi zero",
      "sprite zero",
      "fanta zero",
      "soda zero",
      "cola zero",
      "zero sugar",
    ],
    typicalPortionG: 330,
    kcalPer100g: 0.3,
    fiberPer100g: 0,
    plausibleKcalRange: [0, 5],
  },
  {
    name: "minuman soda",
    // Not "coke"/"soda": as substrings they would also hit cokelat and soda gembira.
    aliases: ["coca cola", "coca-cola", "pepsi", "sprite", "fanta", "minuman bersoda"],
    typicalPortionG: 330,
    kcalPer100g: 42,
    fiberPer100g: 0,
    plausibleKcalRange: [100, 200],
  },
  {
    name: "kopi susu",
    aliases: ["es kopi", "es kopi susu", "kopi susu gula aren"],
    typicalPortionG: 200,
    kcalPer100g: 55,
    fiberPer100g: 0,
    plausibleKcalRange: [60, 160],
  },
  {
    name: "es jeruk",
    aliases: ["es jeruk peras", "jeruk peras"],
    typicalPortionG: 250,
    kcalPer100g: 45,
    fiberPer100g: 0,
    plausibleKcalRange: [50, 150],
  },
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const INDEX = TKPI_DISHES.flatMap((dish) => [
  { key: normalize(dish.name), dish },
  ...dish.aliases.map((a) => ({ key: normalize(a), dish })),
]).filter((e) => e.key.length >= 4);

function matchDish(name: string): TdpiDish | undefined {
  return matchEntry(name)?.dish;
}

function matchEntry(name: string): { dish: TdpiDish; key: string } | undefined {
  const q = normalize(name);
  // A name that is itself a library key ("coca cola") must not be pulled to a
  // longer key that merely contains it ("coca cola zero").
  const exact = INDEX.find((entry) => entry.key === q);
  if (exact) return { dish: exact.dish, key: exact.key };
  let best: { dish: TdpiDish; key: string; len: number } | undefined;
  for (const entry of INDEX) {
    const key = entry.key;
    if (q.includes(key)) {
      // User/model named the dish (or a superset of it) — always safe.
      if (!best || key.length > best.len) best = { dish: entry.dish, key, len: key.length };
    } else if (key.includes(q) && q.length >= 8 && q.length >= key.length / 2) {
      // "sambal" must NOT hit "sambal goreng ati"; "sayur asem campur" may.
      if (!best || key.length > best.len) best = { dish: entry.dish, key, len: key.length };
    }
  }
  return best && { dish: best.dish, key: best.key };
}

/**
 * Single-ingredient library rows. A longer name that only matched one of these
 * through its first word ("tahu tek", "tempe mendoan", "telur balado") is a
 * different, usually bigger dish: clamping it into the ingredient's small band
 * would cut a 300 g "tahu tek" to ~150 kcal.
 */
const BARE_INGREDIENT_KEYS = new Set(["tahu", "tempe", "kerupuk", "perkedel", "sambal"]);

function isCompoundOfIngredient(name: string): boolean {
  const q = normalize(name);
  const hit = matchEntry(name);
  return hit !== undefined && BARE_INGREDIENT_KEYS.has(hit.key) && q !== hit.key;
}

/**
 * "Nasi goreng telur ceplok" names two library dishes side by side. Matching
 * it to either one (longest key wins: "telur ceplok") would clamp a whole
 * plate into an egg's kcal band, so combinations skip both lookup stages.
 */
function isCombination(name: string): boolean {
  const q = normalize(name);
  const hits: Array<{ start: number; end: number; dish: TdpiDish }> = [];
  for (const entry of INDEX) {
    const start = q.indexOf(entry.key);
    if (start !== -1) hits.push({ start, end: start + entry.key.length, dish: entry.dish });
  }
  return hits.some((a) =>
    hits.some((b) => a.dish !== b.dish && (a.end <= b.start || b.end <= a.start)),
  );
}

/**
 * kcal of `grams` of the curated library dish that `name` names, or undefined
 * when the library has no single dish for it. For callers that swapped a dish
 * and need a number the model did not give (ai.correctScan renames).
 */
export function libraryKcal(name: string, grams: number): number | undefined {
  if (isCombination(name)) return undefined;
  const dish = matchDish(name);
  return dish ? Math.round((dish.kcalPer100g * grams) / 100) : undefined;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Two-sided Atwater sanity guard: kcal should roughly equal 4·P + 4·C + 9·F.
 * - Macros implying far more energy than the reported kcal → macros inflated
 *   (the model once said "nasi putih 150 g, karbo 150 g"): rescale macros.
 * - Reported kcal far exceeding macros → kcal hallucinated ("sambal 1 sdm,
 *   350 kcal"): pull kcal toward the macro-derived value.
 * Only fires on gross violations; real plates sit well inside the bands.
 */
export function atwaterAdjust<
  T extends { kcal: number; protein?: number; carbs?: number; fat?: number },
>(item: T): T {
  const { protein: p, carbs: c, fat: f } = item;
  if (p === undefined || c === undefined || f === undefined || item.kcal <= 0) return item;
  const kfm = 4 * (p + c) + 9 * f;
  if (kfm > item.kcal * 1.5 + 30) {
    const scale = (item.kcal * 0.9) / kfm;
    return {
      ...item,
      protein: round1(p * scale),
      carbs: round1(c * scale),
      fat: round1(f * scale),
    };
  }
  if (kfm >= 15 && item.kcal > kfm * 3 + 50) {
    return { ...item, kcal: Math.round(kfm * 1.4) };
  }
  return item;
}

/** Physical ceiling: pure fat is 9 kcal/g, so no item can exceed this per gram of its own weight. */
const MAX_KCAL_PER_GRAM = 9;

/**
 * The library band is written for `typicalPortionG`; the item's own grams stretch
 * it proportionally. An unscaled band clamped "martabak telur 50 g" up to the
 * 150 g portion's minimum (300 kcal, 6 kcal/g, against 2.5 in the table).
 */
function bandFor(dish: TdpiDish, grams: number, slack = 0): [number, number] {
  if (slack === Infinity) return [-Infinity, Infinity];
  const [min, max] = dish.plausibleKcalRange;
  const ratio = grams / dish.typicalPortionG;
  return [Math.round(min * ratio * (1 - slack)), Math.round(max * ratio * (1 + slack))];
}

/**
 * Eval harness only (scripts/eval-scans.ts); production never passes it.
 * `bandSlack` widens a matched dish's kcal band by that share on both sides
 * (0.5 = from half the minimum to 1.5 times the maximum; Infinity = no band, the
 * model's kcal stands apart from the density cap and the Atwater guard).
 */
export type CalibrateOptions = { bandSlack?: number };

export type CalibratedItem = {
  name: string;
  portion?: string;
  grams?: number;
  kcal: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  confidence?: number;
  matched?: boolean;
};

// Fallback band for dishes outside the library — catches truncation garbage
// without second-guessing the model on real plates.
const GENERIC_KCAL_RANGE: [number, number] = [20, 4000];

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Vision-shaped item — structurally compatible with visionItemSchema output. */
export type CalibratableItem = {
  name: string;
  portion?: string;
  grams?: number;
  kcal: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  confidence?: number;
  /** The caller knows this is a drink (model kind); otherwise the name decides. Zero-calorie drinks stay near 0. */
  drink?: boolean;
};

/**
 * A condiment word ("sambal", "kecap", "saus") at the tail of a protein or
 * staple dish name is a modifier, not the dish. Left alone, matchDish finds the
 * library row "sambal" (band 5-80 kcal) and clamps a whole "ayam penyet sambal
 * ijo" to 80 kcal, or TKPI 2019 "Kecap" does the same to "telur rebus kuah
 * kecap". Such names skip both lookups and keep the model's kcal under the
 * generic band, like any unknown dish. Names the library knows are untouched.
 */
const CONDIMENT = /\b(sambal|kecap|saus|bumbu|mayones|kuah)\b/;
const FOOD_HEAD =
  /\b(ayam|bebek|daging|sapi|kambing|ikan|lele|udang|cumi|telur|tahu|tempe|nasi|mie|mi|bihun|terong|kangkung|sayur|kentang|jamur|ati|usus|teri|tongkol|kacang)\b/;
const LIBRARY_KEYS = new Set(INDEX.map((e) => e.key));

function isCondimentedDish(name: string): boolean {
  const q = normalize(name);
  if (LIBRARY_KEYS.has(q)) return false;
  return CONDIMENT.test(q) && FOOD_HEAD.test(q);
}

/**
 * Density bands (+-30% around kcal/100 g) for calorie-dense add-ons the model
 * low-balls ("saus mayones 30 g, 100 kcal" is ~200). Unmatched dishes only have
 * an upper cap, so nothing else stops an underestimate. Rounded TKPI/label values.
 */
const DENSITY_BANDS: Array<{ re: RegExp; per100: number }> = [
  { re: /\b(mayones|mayonnaise|mayo)\b/, per100: 680 },
  { re: /\b(bumbu|saus) kacang\b/, per100: 250 },
  { re: /\bkacang tanah\b/, per100: 590 },
  { re: /\bnugget\b/, per100: 260 },
];

function applyDensityBand(item: CalibratedItem): CalibratedItem {
  const band = DENSITY_BANDS.find((b) => b.re.test(normalize(item.name)));
  if (!band || !item.grams || item.grams <= 0) return item;
  const base = (band.per100 * item.grams) / 100;
  return { ...item, kcal: Math.round(clamp(item.kcal, base * 0.7, base * 1.3)) };
}

/**
 * Pure post-parse calibration against the TKPI library. A matched dish's kcal
 * band scales with the item's grams (half a plate of rice is ~100 kcal, a 50 g
 * slice of martabak ~125), and no item exceeds 9 kcal per gram of its weight.
 */
export function calibrateItems(
  items: CalibratableItem[],
  options: CalibrateOptions = {},
): CalibratedItem[] {
  return items.map((item) => capDensity(applyDensityBand(calibrateOne(item, options))));
}

function capDensity(item: CalibratedItem): CalibratedItem {
  if (!item.grams || item.grams <= 0) return item;
  const cap = Math.round(item.grams * MAX_KCAL_PER_GRAM);
  return item.kcal > cap ? { ...item, kcal: cap } : item;
}

function calibrateOne({ drink, ...item }: CalibratableItem, options: CalibrateOptions): CalibratedItem {
  const combination = isCombination(item.name);
  const generic = combination || isCondimentedDish(item.name) || isCompoundOfIngredient(item.name);
  const dish = generic ? undefined : matchDish(item.name);
  if (!dish) {
    // Second stage: the full TKPI 2019 table (~1.1k bahan) — official
    // per-100 g numbers from Kemenkes, recomputed for the estimated portion.
    const raw = generic ? undefined : lookupTkpi2019(item.name);
    if (raw && raw.kcalPer100g > 0) {
      const grams = item.grams && item.grams > 0 ? item.grams : 100;
      const portion = portionFromTkpi2019(raw, grams);
      return atwaterAdjust({
        ...item,
        grams,
        kcal: portion.kcal > 0 ? portion.kcal : item.kcal,
        protein: portion.protein ?? item.protein,
        carbs: portion.carbs ?? item.carbs,
        fat: portion.fat ?? item.fat,
        fiber: portion.fiber ?? item.fiber,
        matched: true,
      });
    }
    const densityCap =
      item.grams && item.grams > 0 ? Math.max(400, item.grams * 7) : GENERIC_KCAL_RANGE[1];
    return atwaterAdjust({
      ...item,
      kcal: clamp(
        item.kcal,
        (drink ?? foodKind(item.name) === "minuman") ? 0 : GENERIC_KCAL_RANGE[0],
        Math.min(GENERIC_KCAL_RANGE[1], densityCap),
      ),
      matched: false,
    });
  }
  const grams = item.grams && item.grams > 0 ? item.grams : dish.typicalPortionG;
  const fiber =
    item.fiber && item.fiber > 0
      ? item.fiber
      : Math.round(((dish.fiberPer100g * grams) / 100) * 10) / 10;
  // TKPI kcal range first, then the Atwater guard (macro split can still be
  // inflated even when total kcal landed in the plausible band).
  return atwaterAdjust({
    ...item,
    grams,
    fiber,
    kcal: clamp(item.kcal, ...bandFor(dish, grams, options.bandSlack)),
    matched: true,
  });
}
