// Typical household portions for foods that carry no portion of their own, for Joyo AI. TKPI is per 100 g only: portions live in
// the dish library (`typicalPortionG`) and in an ingredient's counted piece, and most fresh fruit and many snacks have neither,
// so "which fruit fits today" would end in "how many grams?". These are curated ESTIMATES of what a person usually eats at
// once (edible part, no peel, seed or shell), keyed by TKPI code so every name that resolves to the row gets it. Only the gram
// figure is ours: kcal and macros still come from the TKPI row. A portion the food really has (the person's own grams, the
// dish library, a counted piece) always wins over these; see `choosePortion`.

export interface TypicalPortion {
  grams: number;
  /** The household unit in Indonesian and English, as the person would say it ("1 potong", "1 slice"). */
  id: string;
  en: string;
}

const p = (grams: number, id: string, en: string): TypicalPortion => ({ grams, id, en });

const SLICE_100 = p(100, "1 potong", "1 slice");
const PISANG = p(100, "1 buah", "1 banana");
const MANGGA = p(150, "1 buah sedang", "1 medium mango");
const KERUPUK = p(20, "2 lembar", "2 crackers");

const ENTRIES: readonly (readonly [codes: readonly string[], portion: TypicalPortion])[] = [
  // Fruit
  [["ER073"], SLICE_100], // pepaya
  [["ER105"], p(150, "1 potong", "1 slice")], // semangka
  [["ER067"], SLICE_100], // melon
  [["ER114"], SLICE_100], // blewah
  [["ER069", "ER070"], p(90, "1 potong", "1 slice")], // nanas
  [["ER054", "ER055", "ER056", "ER057", "ER058", "ER059", "ER060", "ER061", "ER062"], MANGGA], // mangga
  [["ER098", "ER099", "ER100", "ER101"], p(100, "3 buah", "3 fruits")], // salak
  [["ER096", "ER097"], p(60, "5 buah", "5 fruits")], // rambutan
  [["ER031", "ER032"], p(100, "1 buah", "1 guava")], // jambu biji
  [["ER006"], p(100, "1 buah", "1 starfruit")], // belimbing
  [["ER001"], p(100, "1/2 buah", "1/2 avocado")], // alpukat
  [["ER023"], p(100, "3 biji", "3 pods")], // durian
  [["ER064"], p(60, "3 buah", "3 fruits")], // manggis
  [["ER022", "ER051"], p(60, "5 buah", "5 fruits")], // duku, langsat
  [["ER035"], p(100, "3 siung", "3 segments")], // jeruk bali
  [["ER043", "ER044"], p(70, "1 buah", "1 fruit")], // kedondong
  // Pisang: every banana row without a counted piece of its own (ambon and kepok have one)
  [
    ["ER075", "ER076", "ER077", "ER078", "ER079", "ER080", "ER082", "ER083", "ER084", "ER085", "ER086", "ER087", "ER088", "ER089", "ER090", "ER091", "ER092", "ER093"],
    PISANG,
  ],
  // Staples
  [["AP005"], p(150, "1 centong", "1 scoop")], // nasi merah, like the dish library's nasi putih
  // Bread, biscuits, cakes
  [["AP029"], p(30, "3 keping", "3 biscuits")], // biskuit
  [["AP075"], p(35, "1 buah", "1 piece")], // kue sus
  [["AP094"], p(40, "1 buah", "1 piece")], // onde-onde
  // Gorengan
  [["AP031"], p(50, "1 buah", "1 piece")], // bakwan
  [["AP096"], p(60, "1 buah", "1 piece")], // pastel
  // Crackers and chips
  [["BP040", "BP042", "BP044", "BP045", "BP041", "BP043"], KERUPUK],
  [["CP024"], p(20, "1 genggam kecil", "1 small handful")], // emping
  [["BP036", "BP037", "BP038", "EP004"], p(30, "1 bungkus kecil", "1 small pack")], // keripik kentang, singkong, lampung
];

const BY_CODE = new Map<string, TypicalPortion>();
for (const [codes, portion] of ENTRIES) for (const code of codes) BY_CODE.set(code, portion);

/** The curated typical portion for a TKPI code, or undefined. */
export function typicalPortionFor(code: string | null): TypicalPortion | undefined {
  return code === null ? undefined : BY_CODE.get(code);
}

/** Every code with a typical portion (tests check each one is a real TKPI row). */
export const TYPICAL_PORTION_CODES: readonly string[] = [...BY_CODE.keys()];
