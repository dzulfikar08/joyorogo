// Food facts for Joyo AI, from OUR data only: TKPI 2019 (primary), the dish library and the USDA rows that ingredients carry
// (secondary). Pure: no db, no network, no model. A name that does not resolve to exactly ONE row is "unknown": never a loose
// substring guess, never an invented number. Ported in spirit from JoyoFit's tool design, written for JoyoRogo's own data.

import { BASE_INGREDIENTS } from "../meal/ingredients";
import type { IngredientDef } from "../meal/types";
import { TKPI_DISHES } from "../tkpi";
import type { TdpiDish } from "../tkpi";
import { TKPI_2019 } from "../tkpi2019-data";
import type { Tkpi2019Row } from "../tkpi2019-data";

export const NUTRIENTS = ["kcal", "protein", "carbs", "fat", "fiber"] as const;
export type Nutrient = (typeof NUTRIENTS)[number];
/** What `compareFoods` can rank by. `sugar` is accepted so the answer can say plainly that we have no sugar column. */
export type RankBy = Nutrient | "sugar";
export const RANK_BY: readonly RankBy[] = [...NUTRIENTS, "sugar"];

/** Per 100 g. `null` = unknown (never 0). `sugar` is always null: TKPI has no sugar column. */
export interface Per100g {
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  sugar: null;
}

export type FoodSource = "tkpi" | "dish" | "usda";

/**
 * macros_inconsistent: the row fails the Atwater check, so protein/carbs/fat are withheld (kcal and fiber stay).
 * dish_estimate: a dish-library row, kcal and fiber are a band centre rounded from TKPI-style data, with no macros.
 */
export type DataNote = "macros_inconsistent" | "dish_estimate";

export interface PortionOption {
  grams: number;
  /** Where the gram figure comes from in our data: a typical dish portion, or one counted piece of an ingredient. */
  label: string;
}

export interface FoodFacts {
  /** TKPI code (`ER073`), `FDC<id>` for a USDA row, `null` for a dish-library row. */
  code: string | null;
  /** The row's own name in our data. */
  name: string;
  source: FoodSource;
  per100g: Per100g;
  dataNote: DataNote | null;
  portions: { library: PortionOption | null; piece: PortionOption | null };
}

export type UnknownReason = "empty" | "no_match" | "ambiguous";

export type FoodLookup =
  | { ok: true; food: FoodFacts }
  | { ok: false; reason: UnknownReason; /** For `ambiguous`: up to 4 row names the person can pick from. */ candidates: string[] };

export interface FoodCandidate {
  code: string | null;
  name: string;
  source: FoodSource;
  score: number;
}

export type PortionSource = "yours" | "library" | "piece" | "asked";
export interface ChosenPortion {
  grams: number;
  source: PortionSource;
  /** Present for library/piece, so the model can say what the portion is. */
  label: string | null;
}

/** Nutrient amounts of an eaten quantity. `null` = unknown. */
export interface Amounts {
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Normalising and indexes

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Lowercase, accents/punctuation to spaces, collapsed. Digits stay (`ER073`, `3 in 1`). */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface TkpiEntry {
  row: Tkpi2019Row;
  code: string;
  name: string;
  key: string;
  /** normalized text before the first comma ("pepaya, segar" -> "pepaya") */
  head: string;
  /** normalized text after the first comma ("segar") */
  tail: string;
}

const TKPI: TkpiEntry[] = TKPI_2019.map((row) => {
  const name = row[1];
  const comma = name.indexOf(",");
  return {
    row,
    code: row[0],
    name,
    key: normalize(name),
    head: normalize(comma < 0 ? name : name.slice(0, comma)),
    tail: comma < 0 ? "" : normalize(name.slice(comma + 1)),
  };
});
const TKPI_BY_CODE = new Map(TKPI.map((e) => [e.code, e]));

interface IngredientEntry {
  def: IngredientDef;
}
/** Curated ingredient names (id and en) and the registry key, normalized. */
const INGREDIENT_BY_NAME = new Map<string, IngredientEntry>();
const INGREDIENT_BY_CODE = new Map<string, IngredientDef>();
for (const [key, def] of Object.entries(BASE_INGREDIENTS)) {
  const entry = { def };
  for (const label of [def.name.id, def.name.en, key]) {
    const k = normalize(label);
    if (!INGREDIENT_BY_NAME.has(k)) INGREDIENT_BY_NAME.set(k, entry);
  }
  if (!INGREDIENT_BY_CODE.has(def.code)) INGREDIENT_BY_CODE.set(def.code, def);
}

/** Dish-library names and aliases, normalized, 4+ characters like the library's own matcher. */
const DISH_BY_NAME = new Map<string, TdpiDish>();
for (const dish of TKPI_DISHES) {
  for (const label of [dish.name, ...dish.aliases]) {
    const k = normalize(label);
    if (k.length >= 4 && !DISH_BY_NAME.has(k)) DISH_BY_NAME.set(k, dish);
  }
}

/**
 * English and Malay names of foods the ingredient registry does not carry, mapped to the Indonesian name the resolver then
 * looks up. Names only: every number still comes from the TKPI row that name resolves to.
 */
const ALT_NAMES: Readonly<Record<string, string>> = {
  papaya: "pepaya",
  pawpaw: "pepaya",
  cantaloupe: "melon",
  rockmelon: "melon",
  honeydew: "melon",
  durian: "durian",
  "star fruit": "belimbing",
  starfruit: "belimbing",
  "sweet corn": "jagung manis rebus",
  "red rice": "nasi beras merah",
  "steamed rice": "nasi",
  rice: "nasi",
  // Malay
  betik: "pepaya",
  tembikai: "semangka",
  epal: "apel",
  nenas: "nanas",
  oren: "jeruk",
  "nasi perang": "nasi beras merah",
};

// ---------------------------------------------------------------------------------------------------------------------
// Facts from rows

/** The Atwater check: 4P + 4C + 9F against the row's kcal. Only a row with all three macros and a kcal can fail it. */
export function atwaterConsistent(kcal: number | null, protein: number | null, carbs: number | null, fat: number | null): boolean {
  if (kcal === null || protein === null || carbs === null || fat === null) return true;
  return Math.abs(4 * protein + 4 * carbs + 9 * fat - kcal) <= Math.max(25, 0.35 * kcal);
}

function pieceOf(def: IngredientDef | undefined): PortionOption | null {
  if (!def?.unit) return null;
  return { grams: def.unit.grams, label: `1 ${def.unit.name.en} (${def.unit.name.id})` };
}

function dishFor(...keys: string[]): TdpiDish | undefined {
  for (const k of keys) {
    const dish = DISH_BY_NAME.get(k);
    if (dish) return dish;
  }
  return undefined;
}

function libraryOf(dish: TdpiDish | undefined): PortionOption | null {
  if (!dish || !(dish.typicalPortionG > 0)) return null;
  return { grams: dish.typicalPortionG, label: `1 typical serving of ${dish.name}` };
}

function fromTkpi(entry: TkpiEntry, queryKey: string, def?: IngredientDef): FoodFacts {
  const [, , , kcal, protein, fat, carbs, fiber] = entry.row;
  const consistent = atwaterConsistent(kcal, protein, carbs, fat);
  const ingredient = def ?? INGREDIENT_BY_CODE.get(entry.code);
  return {
    code: entry.code,
    name: entry.name,
    source: "tkpi",
    per100g: {
      kcal,
      protein: consistent ? protein : null,
      carbs: consistent ? carbs : null,
      fat: consistent ? fat : null,
      fiber,
      sugar: null,
    },
    dataNote: consistent ? null : "macros_inconsistent",
    portions: { library: libraryOf(dishFor(queryKey, entry.key, entry.head)), piece: pieceOf(ingredient) },
  };
}

function fromUsda(def: IngredientDef): FoodFacts | null {
  const u = def.usda;
  if (!u) return null;
  return {
    code: def.code,
    name: u.description,
    source: "usda",
    per100g: { kcal: u.kcal, protein: u.proteinG, carbs: u.carbsG, fat: u.fatG, fiber: u.fiberG, sugar: null },
    dataNote: null,
    portions: { library: null, piece: pieceOf(def) },
  };
}

function fromDish(dish: TdpiDish): FoodFacts {
  return {
    code: null,
    name: dish.name,
    source: "dish",
    per100g: { kcal: dish.kcalPer100g, protein: null, carbs: null, fat: null, fiber: dish.fiberPer100g, sugar: null },
    dataNote: "dish_estimate",
    portions: { library: libraryOf(dish), piece: null },
  };
}

function fromIngredient(def: IngredientDef, queryKey: string): FoodFacts | null {
  const usda = fromUsda(def);
  if (usda) return usda;
  const entry = TKPI_BY_CODE.get(def.code);
  return entry ? fromTkpi(entry, queryKey, def) : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Resolver

const CODE_RE = /^[a-z]{2}\d{3}$/;
const unknown = (reason: UnknownReason, candidates: string[] = []): FoodLookup => ({ ok: false, reason, candidates });

/** Tails that mean "this is how it is normally eaten" (a fresh fruit, a cooked grain), best first. */
const READY_TAILS: readonly RegExp[] = [/^segar$/, /^(rebus|kukus|matang|masak)$/];
/** Tails that mean a processed or raw-ingredient state: never chosen automatically over a plain name. */
const RAW_TAIL = /\b(mentah|kering|tepung|bubuk|instan|awet|dendeng|asin)\b/;

function pickByHead(heads: TkpiEntry[]): TkpiEntry | "ambiguous" {
  if (heads.length === 1) return heads[0]!;
  for (const pattern of READY_TAILS) {
    const hit = heads.filter((e) => pattern.test(e.tail));
    if (hit.length === 1) return hit[0]!;
    if (hit.length > 1) return "ambiguous";
  }
  return "ambiguous";
}

/**
 * Resolves a typed food name to ONE row of our data, or unknown. Order: a TKPI code; the curated ingredient names (id/en);
 * an exact TKPI name; a dish-library name or alias; the name before the comma (preferring `segar`, then a cooked row);
 * a unique whole-word prefix. Anything ambiguous or unmatched is unknown, with up to 4 candidates to ask about.
 */
export function lookupFood(name: string): FoodLookup {
  const raw = typeof name === "string" ? name : "";
  let q = normalize(raw);
  if (q.length < 2) return unknown("empty");
  const english = Object.hasOwn(ALT_NAMES, q) ? ALT_NAMES[q] : undefined;
  if (english && !INGREDIENT_BY_NAME.has(q)) q = normalize(english);

  if (CODE_RE.test(q)) {
    const entry = TKPI_BY_CODE.get(q.toUpperCase());
    return entry ? { ok: true, food: fromTkpi(entry, entry.key) } : unknown("no_match");
  }

  const ingredient = INGREDIENT_BY_NAME.get(q);
  if (ingredient) {
    const food = fromIngredient(ingredient.def, q);
    if (food) return { ok: true, food };
  }

  const exact = TKPI.filter((e) => e.key === q);
  if (exact.length === 1) return { ok: true, food: fromTkpi(exact[0]!, q) };
  if (exact.length > 1) return unknown("ambiguous", exact.slice(0, 4).map((e) => e.name));

  const dish = DISH_BY_NAME.get(q);
  if (dish) return { ok: true, food: fromDish(dish) };

  if (q.length >= 3) {
    const heads = TKPI.filter((e) => e.head === q && !RAW_TAIL.test(e.tail));
    if (heads.length > 0) {
      const pick = pickByHead(heads);
      return pick === "ambiguous"
        ? unknown("ambiguous", heads.slice(0, 4).map((e) => e.name))
        : { ok: true, food: fromTkpi(pick, q) };
    }
  }

  // A unique whole-word prefix, and only when the query is most of the row's name ("sayur asem" -> "Sayur asem betawi"):
  // "anggur" must not become "Anggur hutan", nor "kopi" "Kopi bubuk instant".
  if (q.length >= 6) {
    const prefixed = TKPI.filter((e) => e.key.startsWith(`${q} `));
    const near = prefixed.filter((e) => q.length * 2 >= e.key.length);
    if (near.length === 1 && prefixed.length === 1) return { ok: true, food: fromTkpi(near[0]!, q) };
    if (prefixed.length > 1) return unknown("ambiguous", prefixed.slice(0, 4).map((e) => e.name));
  }
  return unknown("no_match");
}

// ---------------------------------------------------------------------------------------------------------------------
// Search

const SEARCH_LIMIT = 8;

/** Up to 8 candidates for a query, best first: exact, name-before-comma, prefix, then every query word present. */
export function searchFoods(query: string, limit = SEARCH_LIMIT): FoodCandidate[] {
  const q = normalize(typeof query === "string" ? query : "");
  if (q.length < 2) return [];
  const cap = Math.max(1, Math.min(SEARCH_LIMIT, Math.floor(limit) || SEARCH_LIMIT));
  const words = q.split(" ");
  const scored = new Map<string, FoodCandidate>();
  const add = (candidate: FoodCandidate) => {
    const key = `${candidate.source}:${candidate.code ?? candidate.name}`;
    const existing = scored.get(key);
    if (!existing || existing.score < candidate.score) scored.set(key, candidate);
  };

  for (const e of TKPI) {
    let score = 0;
    if (e.key === q) score = 100;
    else if (e.head === q) score = 80 + (e.tail === "segar" ? 5 : 0);
    else if (e.key.startsWith(`${q} `) || e.key.startsWith(q)) score = 60;
    else {
      const have = new Set(e.key.split(" "));
      if (words.every((w) => have.has(w))) score = 40;
    }
    if (score > 0) add({ code: e.code, name: e.name, source: "tkpi", score: score - Math.min(e.key.length, 30) / 100 });
  }
  for (const [key, entry] of INGREDIENT_BY_NAME) {
    if (key === q || (key.startsWith(q) && q.length >= 3)) {
      const e = TKPI_BY_CODE.get(entry.def.code);
      add({
        code: entry.def.code,
        name: e?.name ?? entry.def.usda?.description ?? entry.def.name.en,
        source: e ? "tkpi" : "usda",
        score: key === q ? 95 : 55,
      });
    }
  }
  for (const [key, dish] of DISH_BY_NAME) {
    if (key === q) add({ code: null, name: dish.name, source: "dish", score: 70 });
    else if (key.startsWith(q) && q.length >= 4) add({ code: null, name: dish.name, source: "dish", score: 50 });
  }
  return [...scored.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, cap);
}

// ---------------------------------------------------------------------------------------------------------------------
// Portions and amounts

/** The person's own usual grams, else a typical dish portion, else one counted piece; the caller's own grams always win. */
export function choosePortion(food: FoodFacts, opts: { asked?: number | null; usual?: number | null } = {}): ChosenPortion | null {
  if (typeof opts.asked === "number" && Number.isFinite(opts.asked) && opts.asked > 0) {
    return { grams: opts.asked, source: "asked", label: null };
  }
  if (typeof opts.usual === "number" && Number.isFinite(opts.usual) && opts.usual > 0) {
    return { grams: opts.usual, source: "yours", label: null };
  }
  if (food.portions.library) return { grams: food.portions.library.grams, source: "library", label: food.portions.library.label };
  if (food.portions.piece) return { grams: food.portions.piece.grams, source: "piece", label: food.portions.piece.label };
  return null;
}

/** Amounts of `grams` of the food; a column that is unknown for the food stays null. */
export function amountsFor(food: FoodFacts, grams: number): Amounts {
  const k = grams / 100;
  const scale = (v: number | null, digits: 0 | 1): number | null => {
    if (v === null) return null;
    return digits === 0 ? Math.round(v * k) : round1(v * k);
  };
  const p = food.per100g;
  return { kcal: scale(p.kcal, 0), protein: scale(p.protein, 1), carbs: scale(p.carbs, 1), fat: scale(p.fat, 1), fiber: scale(p.fiber, 1) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Compare

export interface CompareItem {
  query: string;
  name: string;
  code: string | null;
  source: FoodSource;
  per100g: Per100g;
  dataNote: DataNote | null;
  portion: ChosenPortion | null;
  /** `null` when we have no portion for the food (compare per 100 g instead). */
  perPortion: Amounts | null;
}

export interface RankedEntry {
  rank: number;
  name: string;
  value: number;
}

export interface CompareResult {
  by: RankBy;
  /** `highest_first`: rank 1 has the most of the nutrient. */
  order: "highest_first";
  items: CompareItem[];
  /** Ranking per 100 g; null when `by` is unknown for us (sugar) or fewer than 2 foods have the value. */
  per100gRanking: RankedEntry[] | null;
  /** Ranking per portion; only foods with a portion, null when fewer than 2 are comparable. */
  perPortionRanking: RankedEntry[] | null;
  /** Foods known to us but without the value of `by` (a withheld column or an unknown one), never ranked. */
  unrankable: { name: string; reason: "value_unknown" }[];
  /** Foods we have no portion for: ranked per 100 g only. */
  noPortion: string[];
  unknown: { query: string; reason: UnknownReason; candidates: string[] }[];
  notes: string[];
}

function rank(entries: { name: string; value: number }[]): RankedEntry[] {
  const sorted = [...entries].sort((a, b) => b.value - a.value);
  let place = 0;
  return sorted.map((e, i) => {
    if (i === 0 || e.value !== sorted[i - 1]!.value) place = i + 1;
    return { rank: place, name: e.name, value: e.value };
  });
}

export interface CompareOptions {
  /** One figure for every food, or one per food (same order as `foods`). */
  grams?: number | readonly (number | null)[];
  by?: RankBy;
  /** The person's own usual grams per food (same order as `foods`), when known. */
  usualGrams?: readonly (number | null)[];
}

export function compareFoods(foods: readonly string[], opts: CompareOptions = {}): CompareResult {
  const by: RankBy = opts.by ?? "fiber";
  const askedAt = (i: number): number | null => {
    const g = opts.grams;
    if (typeof g === "number") return g;
    return Array.isArray(g) ? (g[i] ?? null) : null;
  };
  const items: CompareItem[] = [];
  const unknownList: CompareResult["unknown"] = [];
  const notes: string[] = [];

  foods.forEach((query, i) => {
    const found = lookupFood(query);
    if (!found.ok) {
      unknownList.push({ query, reason: found.reason, candidates: found.candidates });
      return;
    }
    const food = found.food;
    const portion = choosePortion(food, { asked: askedAt(i), usual: opts.usualGrams?.[i] ?? null });
    items.push({
      query,
      name: food.name,
      code: food.code,
      source: food.source,
      per100g: food.per100g,
      dataNote: food.dataNote,
      portion,
      perPortion: portion ? amountsFor(food, portion.grams) : null,
    });
  });

  const unrankable: CompareResult["unrankable"] = [];
  const noPortion = items.filter((i) => i.perPortion === null).map((i) => i.name);
  let per100gRanking: RankedEntry[] | null = null;
  let perPortionRanking: RankedEntry[] | null = null;

  if (by === "sugar") {
    notes.push("We have no sugar column for any food (unknown), so nothing is ranked by sugar. Compare fiber, protein or kcal instead.");
  } else {
    const per100: { name: string; value: number }[] = [];
    const perPortion: { name: string; value: number }[] = [];
    for (const item of items) {
      const v = item.per100g[by];
      if (v === null) {
        unrankable.push({ name: item.name, reason: "value_unknown" });
        continue;
      }
      per100.push({ name: item.name, value: v });
      const pv = item.perPortion?.[by] ?? null;
      if (pv !== null) perPortion.push({ name: item.name, value: pv });
    }
    if (per100.length >= 2) per100gRanking = rank(per100);
    if (perPortion.length >= 2) perPortionRanking = rank(perPortion);
    if (items.some((i) => i.perPortion === null)) {
      notes.push("Some foods have no portion in our data: compare them per 100 g, or give grams for each.");
    }
  }
  if (items.some((i) => i.dataNote === "macros_inconsistent")) {
    notes.push("A row whose numbers do not add up has its protein, carbs and fat withheld (null); its kcal and fiber are kept.");
  }
  if (items.some((i) => i.dataNote === "dish_estimate")) {
    notes.push("A dish row is an approximate band centre: kcal and fiber only, no protein, carbs or fat.");
  }
  return { by, order: "highest_first", items, per100gRanking, perPortionRanking, unrankable, noPortion, unknown: unknownList, notes };
}

// ---------------------------------------------------------------------------------------------------------------------
// Fits today

/** What is left of today's budget per nutrient (target minus eaten, from the app's own day numbers). `null` = no target / unknown. */
export interface Remaining {
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
}

export interface FitsToday {
  name: string;
  grams: number;
  amounts: Amounts;
  /** Remaining after eating it; null when the food's amount or the remaining is unknown. */
  after: Amounts;
  /** True when eating it goes past what is left; null when unknown. */
  over: Record<Nutrient, boolean | null>;
}

export function fitsToday(food: FoodFacts, grams: number, remaining: Remaining): FitsToday {
  const amounts = amountsFor(food, grams);
  const after = {} as Amounts;
  const over = {} as Record<Nutrient, boolean | null>;
  for (const n of NUTRIENTS) {
    const have = amounts[n];
    const left = remaining[n];
    if (have === null || left === null) {
      after[n] = null;
      over[n] = null;
    } else {
      const rest = n === "kcal" ? Math.round(left - have) : round1(left - have);
      after[n] = rest;
      over[n] = rest < 0;
    }
  }
  return { name: food.name, grams, amounts, after, over };
}
