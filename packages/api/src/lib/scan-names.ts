// English names the vision model sometimes answers with, mapped to the Indonesian library names, so one
// food is always one row (the same "nasi putih" row and kcal) whatever language the model happened to use.
// Exact names only (after the same normalization as the dish index): "rice cake" must not become rice.

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ENGLISH_TO_INDONESIAN: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["nasi putih", ["white rice", "steamed rice", "cooked rice", "plain rice", "boiled rice", "rice", "steamed white rice"]],
  ["nasi goreng", ["fried rice", "indonesian fried rice"]],
  ["nasi uduk", ["coconut rice"]],
  ["nasi kuning", ["yellow rice", "turmeric rice"]],
  ["ayam goreng", ["fried chicken", "indonesian fried chicken"]],
  ["ayam bakar", ["grilled chicken", "roast chicken", "roasted chicken"]],
  ["telur rebus", ["boiled egg", "boiled eggs", "hard boiled egg", "hard boiled eggs"]],
  ["putih telur rebus", ["boiled egg white", "boiled egg whites", "egg white boiled"]],
  ["telur ceplok", ["fried egg", "fried eggs", "sunny side up egg", "sunny side up"]],
  ["telur dadar", ["omelette", "omelet", "plain omelette", "egg omelette"]],
  ["tahu", ["tofu", "white tofu"]],
  ["tahu goreng", ["fried tofu"]],
  ["tempe", ["tempeh"]],
  ["tempe goreng", ["fried tempeh"]],
  ["mie goreng", ["fried noodles", "indonesian fried noodles"]],
  ["mie ayam", ["chicken noodles", "chicken noodle"]],
  ["bakso", ["meatball", "meatballs", "indonesian meatballs", "meatball soup"]],
  ["sate ayam", ["chicken satay", "chicken skewers"]],
  ["bubur ayam", ["chicken porridge", "chicken congee"]],
  ["pisang goreng", ["fried banana", "fried bananas"]],
  ["kerupuk", ["crackers", "prawn crackers", "shrimp crackers"]],
  ["timun", ["cucumber", "sliced cucumber"]],
  ["tomat", ["tomato", "tomatoes"]],
  ["kopi hitam", ["black coffee", "iced black coffee"]],
  ["es kopi susu", ["iced milk coffee", "iced coffee with milk"]],
  ["es teh manis", ["iced sweet tea", "sweet iced tea", "iced tea", "sweet tea"]],
  ["teh tawar", ["unsweetened tea", "plain tea", "unsweetened iced tea"]],
  ["air putih", ["water", "mineral water", "plain water", "drinking water"]],
  ["jus jeruk", ["orange juice", "fresh orange juice"]],
  ["jus mangga", ["mango juice", "fresh mango juice"]],
  ["jus alpukat", ["avocado juice", "avocado shake"]],
  ["jus jambu", ["guava juice"]],
];

const NAME_MAP = new Map<string, string>(
  ENGLISH_TO_INDONESIAN.flatMap(([indonesian, english]) => english.map((name) => [normalizeName(name), indonesian] as const)),
);

/** The Indonesian library name for an English food name, or the name unchanged. */
export function indonesianName(name: string): string {
  return NAME_MAP.get(normalizeName(name)) ?? name;
}
