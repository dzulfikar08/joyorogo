// The "FOOD DATA (ours)" block put in the system prompt when a question is a food-choice question, so even a model without tool
// calling answers from our numbers. No network, no model: a cue check, a 1 to 3-gram scan of the text against our resolver, and
// the same functions the tools use.

import { NUTRIENTS, TYPICAL_PORTION_NOTE, amountsFor, choosePortion, fitsToday, lookupFood, normalize } from "./foods";
import type { Amounts, FoodFacts, Nutrient, Remaining } from "./foods";
import type { ToolData } from "./tool-data";

export const FOOD_BLOCK_LIMITS = { maxFoods: 6, maxGram: 3, maxChars: 2_400 } as const;

/** A food-choice question: "which / better / or / vs / compare / should I eat" in id, en and ms. Checked on the normalized text. */
const CUES: readonly string[] = [
  // id
  "mana yang",
  "lebih baik",
  "lebih bagus",
  "lebih sehat",
  "lebih tinggi",
  "mending",
  "atau",
  "vs",
  "bandingkan",
  "cocok",
  "boleh makan",
  "bolehkah makan",
  // en
  "which",
  "better",
  "or",
  "versus",
  "compare",
  "should i eat",
  "can i eat",
  "healthier",
  "fit my",
  // ms
  "mana",
  "banding",
  "bandingkan",
  "sesuai",
  "boleh saya makan",
];

/** Words that are never a food even when a row happens to match them as a one-word name. */
const STOP = new Set([
  "mana", "yang", "atau", "dan", "lebih", "baik", "paling", "tinggi", "rendah", "serat", "seratnya", "untuk", "target", "saya", "buat", "boleh", "makan",
  "cocok", "hari", "ini", "kalori", "kkal", "apa", "mending", "bandingkan", "banding", "sesuai", "sehat", "bagus", "pilih", "sisa", "cukup", "kenapa", "berat",
  "which", "better", "compare", "should", "for", "the", "and", "with", "than", "eat", "fiber", "fibre", "protein", "carbs", "calories", "calorie", "today", "my",
  "highest", "lowest", "more", "less", "can", "does", "fit", "healthier", "versus", "have", "has", "what", "how", "much", "many", "this", "that",
]);

const FOCUS: readonly { by: Nutrient; words: readonly string[] }[] = [
  { by: "fiber", words: ["serat", "seratnya", "fiber", "fibre", "berserat"] },
  { by: "protein", words: ["protein", "proteinnya"] },
  { by: "kcal", words: ["kalori", "kalorinya", "kkal", "kcal", "calorie", "calories", "energi"] },
  { by: "carbs", words: ["karbo", "karbohidrat", "carb", "carbs", "carbohydrate", "karbohidrat"] },
  { by: "fat", words: ["lemak", "fat", "lemaknya"] },
];

function hasCue(normalized: string): boolean {
  const padded = ` ${normalized} `;
  return CUES.some((cue) => padded.includes(` ${cue} `) || (cue.length > 4 && padded.includes(cue)));
}

function focusOf(tokens: readonly string[]): Nutrient | null {
  for (const { by, words } of FOCUS) if (tokens.some((t) => words.includes(t))) return by;
  return null;
}

interface Mentioned {
  foods: FoodFacts[];
  /** One-word names that match several rows: the person can be asked which one. */
  ambiguous: { query: string; candidates: string[] }[];
}

/** 1 to 3-gram scan, longest first, left to right; a match consumes its words. At most `maxFoods` distinct foods. */
function scan(tokens: readonly string[]): Mentioned {
  const foods: FoodFacts[] = [];
  const seen = new Set<string>();
  const ambiguous: Mentioned["ambiguous"] = [];
  let i = 0;
  while (i < tokens.length && foods.length < FOOD_BLOCK_LIMITS.maxFoods) {
    let matched = 0;
    for (let n = Math.min(FOOD_BLOCK_LIMITS.maxGram, tokens.length - i); n >= 1; n -= 1) {
      const words = tokens.slice(i, i + n);
      if (words.every((w) => STOP.has(w))) continue;
      if (n === 1 && ((words[0] as string).length < 3 || STOP.has(words[0] as string))) continue;
      const found = lookupFood(words.join(" "));
      if (found.ok) {
        const key = found.food.code ?? found.food.name;
        if (!seen.has(key)) {
          seen.add(key);
          foods.push(found.food);
        }
        matched = n;
        break;
      }
      if (n === 1 && found.reason === "ambiguous" && ambiguous.length < 3) {
        ambiguous.push({ query: words[0] as string, candidates: found.candidates.slice(0, 3) });
      }
    }
    i += Math.max(1, matched);
  }
  return { foods, ambiguous };
}

const fmt = (v: number | null, unit = ""): string => (v === null ? "unknown" : `${v}${unit}`);

function per100Line(food: FoodFacts): string {
  const p = food.per100g;
  const macros =
    food.dataNote === "macros_inconsistent"
      ? "protein/carbs/fat withheld (the row's numbers do not add up)"
      : food.dataNote === "dish_estimate"
        ? "protein/carbs/fat not in our data (approximate dish row)"
        : `protein ${fmt(p.protein, " g")}, carbs ${fmt(p.carbs, " g")}, fat ${fmt(p.fat, " g")}`;
  return `- ${food.name}${food.code ? ` (${food.code})` : ""}: ${fmt(p.kcal, " kcal")}, fiber ${fmt(p.fiber, " g")}, ${macros}`;
}

function amountsText(a: Amounts): string {
  return NUTRIENTS.map((n) => `${n} ${fmt(a[n], n === "kcal" ? "" : " g")}`).join(", ");
}

/**
 * The block for one question, or null when it is not a food-choice question or names no food of ours. `data` supplies today's
 * remaining numbers and the person's usual grams when it can; a failure there only drops those lines.
 */
export async function foodBlockFor(text: string, data: ToolData): Promise<string | null> {
  const normalized = normalize(typeof text === "string" ? text : "");
  if (normalized === "" || !hasCue(normalized)) return null;
  const tokens = normalized.split(" ");
  const { foods, ambiguous } = scan(tokens);
  if (foods.length === 0 && ambiguous.length === 0) return null;

  const lines: string[] = [
    "FOOD DATA (ours: TKPI 2019, dish library, USDA; per 100 g; unknown = we have no value, never guess one):",
    ...foods.map(per100Line),
  ];

  const by = focusOf(tokens);
  if (by && foods.length >= 2) {
    const ranked = foods
      .map((f) => ({ name: f.name, value: f.per100g[by] }))
      .filter((r): r is { name: string; value: number } => r.value !== null)
      .sort((a, b) => b.value - a.value);
    if (ranked.length >= 2) {
      lines.push(`Ranked by ${by} per 100 g (highest first): ${ranked.map((r, i) => `${i + 1}. ${r.name} ${r.value}`).join("; ")}`);
    }
  }

  let remaining: Remaining | null = null;
  try {
    remaining = (await data.day(data.today())).remaining;
  } catch {
    remaining = null;
  }
  if (foods.length > 0) lines.push("Per portion, and what is left of today's budget after it (the app's own numbers):");
  let usedTypical = false;
  for (const food of foods) {
    let usual: number | null = null;
    try {
      usual = data.usualGrams ? await data.usualGrams(food.name) : null;
    } catch {
      usual = null;
    }
    const portion = choosePortion(food, { usual });
    if (!portion) {
      lines.push(`- ${food.name}: no portion in our data, compare per 100 g or ask the person for grams`);
      continue;
    }
    if (portion.source === "typical") usedTypical = true;
    const amounts = amountsFor(food, portion.grams);
    const where = portion.source === "yours" ? "the person's usual" : (portion.label ?? portion.source);
    let line = `- ${food.name}, ${portion.grams} g (${where}): ${amountsText(amounts)}`;
    if (remaining) {
      const fit = fitsToday(food, portion.grams, remaining);
      line += `; left today after it: ${(["kcal", "protein", "fiber"] as const).map((n) => `${n} ${fmt(fit.after[n])}`).join(", ")}`;
    }
    lines.push(line);
  }

  if (usedTypical) lines.push(TYPICAL_PORTION_NOTE);
  if (ambiguous.length > 0) {
    lines.push(`Several rows match (ask which one, do not pick): ${ambiguous.map((a) => `${a.query} -> ${a.candidates.join(" / ")}`).join("; ")}`);
  }
  lines.push("A food the person named that is not listed above is not in our data: say so, give no numbers for it.");
  const out = lines.join("\n");
  return out.length > FOOD_BLOCK_LIMITS.maxChars ? `${out.slice(0, FOOD_BLOCK_LIMITS.maxChars - 1)}…` : out;
}
