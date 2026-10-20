// Caffeine and alcohol read off a dish name (Indonesian + English). Shared by the Hamil / Menyusui food notes
// (maternal.ts) and the sleep insights (sleep-insights*.ts). Rough on purpose: brew strength and pour size vary, and a
// name is all the food log holds.

// Typical caffeine per serving (mg).
const CAFFEINE_RULES: { match: RegExp; mg: number }[] = [
  { match: /\b(energy drink|minuman energi|kratingdaeng|extra joss|red bull|monster|hemaviton)\b/, mg: 80 },
  { match: /\b(espresso|americano|kopi hitam|black coffee|long black|doppio)\b/, mg: 95 },
  { match: /\b(kopi|coffee|latte|cappuccino|capuccino|flat white|mocha|macchiato|kopi susu|cold brew|frappe|frappuccino)\b/, mg: 80 },
  { match: /\b(matcha)\b/, mg: 70 },
  { match: /\b(teh|tea|chai|boba|thai tea)\b/, mg: 40 },
  { match: /\b(cola|coca[- ]cola|pepsi|soda cola)\b/, mg: 35 },
  { match: /\b(coklat panas|hot chocolate|cokelat panas|dark chocolate|cokelat hitam)\b/, mg: 15 },
];

/** Estimated caffeine of one serving of a drink/food by name; null when it has none we know of. */
export function caffeineMgFor(name: string): number | null {
  const n = name.toLowerCase();
  if (/\b(decaf|tanpa kafein|bebas kafein|herbal tea|teh herbal)\b/.test(n)) return null;
  for (const rule of CAFFEINE_RULES) if (rule.match.test(n)) return rule.mg;
  return null;
}

export const ALCOHOL_MATCH =
  /\b(bir|beer|wine|anggur merah|anggur putih|vodka|whisky|whiskey|sake|soju|tuak|arak|brem|cocktail|koktail|brandy|rum|tequila|champagne|sampanye|ciu|lapen|cap tikus|tape|tapai)\b/;
export const ALCOHOL_UNLESS = /\b(root beer|bir pletok|brem cair? bebas alkohol|non[- ]?alcohol(ic)?|tanpa alkohol)\b/;

/** Maternal notes: `tape|tapai` stay flagged there (a fermented food, a note to check), see {@link isAlcoholicDrink}. */
export function isAlcoholName(name: string): boolean {
  const n = name.toLowerCase();
  return ALCOHOL_MATCH.test(n) && !ALCOHOL_UNLESS.test(n);
}

const ALCOHOL_DRINK_MATCH = new RegExp(ALCOHOL_MATCH.source.replace("|tape|tapai", ""));

/** For sleep: a drink. `tape|tapai` is a food and does not count; `brem` does. */
export function isAlcoholicDrink(name: string): boolean {
  const n = name.toLowerCase();
  return ALCOHOL_DRINK_MATCH.test(n) && !ALCOHOL_UNLESS.test(n);
}
