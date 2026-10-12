/**
 * Curated geprek-style calorie facts (Indonesian portions, rough averages).
 * Shared by web and native loading screens + the daily dashboard card.
 */
export const FOOD_FACTS: Array<{ text: string; kcal: number; move: string }> = [
  { text: "1 porsi ayam geprek + es teh", kcal: 600, move: "lari 55 menit" },
  { text: "1 porsi nasi goreng", kcal: 640, move: "jalan 1,5 jam" },
  { text: "1 slice martabak manis", kcal: 510, move: "sepeda 50 menit" },
  { text: "1 bungkus indomie goreng", kcal: 400, move: "lari 35 menit" },
  { text: "1 porsi sate ayam (10 tusuk)", kcal: 480, move: "jalan 1 jam" },
  { text: "1 es kopi susu kekinian", kcal: 300, move: "jalan 45 menit" },
  { text: "1 porsi bakso urat", kcal: 550, move: "lari 50 menit" },
  { text: "1 soto ayam", kcal: 350, move: "jalan 50 menit" },
  { text: "1 porsi mie ayam", kcal: 430, move: "sepeda 40 menit" },
  { text: "1 roti bakar cokelat", kcal: 320, move: "jalan 40 menit" },
  { text: "1 porsi nasi padang rendang", kcal: 720, move: "lari 1 jam" },
  { text: "1 gorengan (tempe mendoan)", kcal: 150, move: "jalan 20 menit" },
  { text: "1 porsi ayam McDonald's", kcal: 470, move: "lari 45 menit" },
  { text: "1 teh tarik", kcal: 320, move: "jalan 40 menit" },
  { text: "1 porsi kwetiau siram", kcal: 520, move: "lari 45 menit" },
  { text: "3 risoles", kcal: 420, move: "sepeda 40 menit" },
  { text: "1 porsi pempek lenjer", kcal: 350, move: "jalan 40 menit" },
  { text: "1 gelas es cincau susu", kcal: 260, move: "jalan 30 menit" },
  { text: "1 porsi pecel lele", kcal: 610, move: "lari 55 menit" },
  { text: "1 mangkuk bubur ayam", kcal: 300, move: "jalan 35 menit" },
  { text: "1 porsi ketoprak", kcal: 490, move: "sepeda 45 menit" },
  { text: "1 batang pisang goreng", kcal: 230, move: "jalan 25 menit" },
  { text: "1 porsi seblak level 3", kcal: 400, move: "lari 35 menit" },
  { text: "1 cireng rujak (5 pcs)", kcal: 380, move: "jalan 45 menit" },
];

/** Stable pick by 'YYYY-MM-DD' — same fact all day, changes daily. */
export function pickFact(date: string): (typeof FOOD_FACTS)[number] {
  let hash = 0;
  for (const ch of date) hash = (hash * 31 + ch.charCodeAt(0)) % 100000;
  return FOOD_FACTS[hash % FOOD_FACTS.length]!;
}

/** Random fact — for loading screens where variety beats determinism. */
export function randomFact(): (typeof FOOD_FACTS)[number] {
  return FOOD_FACTS[Math.floor(Math.random() * FOOD_FACTS.length)]!;
}
