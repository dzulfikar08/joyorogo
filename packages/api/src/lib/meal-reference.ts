import { MEALS, daysBetween, jakartaClockHour, jakartaToday, shiftDate, suggestMealNow } from "./engine";
import type { Meal } from "./engine";
import type { CalibratedItem } from "./tkpi";

/**
 * "Sama kayak tadi siang": a typed or spoken story that points at an earlier
 * meal instead of describing food. The rules here spot the pointer (a slot, a
 * day, "terakhir"), pick the logged rows it means, and apply the changes simple
 * enough to be unambiguous (portion scale, one item removed, one item scaled).
 * Everything else goes to the AI parser with the referenced rows as context.
 * No part of this invents nutrition: copied rows keep their stored values.
 */

/** How far back a reference may reach. */
export const REFERENCE_WINDOW_DAYS = 14;

/** Before 04:00 WIB a person still counts the day that just ended as "today". */
const NIGHT_OWL_HOUR = 4;
/** From 17:00 on, "tadi malam" can only mean this evening, earlier. */
const EVENING_HOUR = 17;

export type MealRow = {
  date: string;
  meal: Meal;
  name: string;
  kcal: number;
  grams: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  /** Log time (ms): orders rows inside a meal and meals by recency. */
  createdAt: number;
};

export type Modifiers = {
  /** Portion factor for the whole meal (1 = as logged). */
  scale: number;
  /** Item phrases to drop, each a list of name words ("teh", "manis"). */
  remove: string[][];
  /** Item phrases with their own portion factor ("nasi" ×0.5). */
  items: Array<{ phrase: string[]; factor: number }>;
};

export type MealReference = {
  /** Calendar offset from today (0 or negative); null when no day was said. */
  dayOffset: number | null;
  /** Candidate slots, most likely first; null when none was said (use the target slot). */
  slots: Meal[] | null;
  /** "terakhir" / "yang barusan": the most recently logged meal. */
  last: boolean;
  mods: Modifiers;
  /** Words the rules could not place ("tambah telur"): the AI reads those. */
  residual: string;
};

// ---------------------------------------------------------------- normalizing

const NUMBER_WORDS: Record<string, number> = {
  satu: 1,
  dua: 2,
  tiga: 3,
  empat: 4,
  lima: 5,
  enam: 6,
  tujuh: 7,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
};

const NUMBER_WORD_RE = Object.keys(NUMBER_WORDS).join("|");

/** English and slang rewritten to the one Indonesian vocabulary the rules read. */
const REWRITES: Array<[RegExp, string]> = [
  [/\bday before yesterday\b/g, "kemarin lusa"],
  [/\byesterday (?:evening|night)\b/g, "kemarin malam"],
  [/\blast night\b/g, "semalam"],
  [/\bsemalem\b/g, "semalam"],
  [/\bthis morning\b/g, "pagi ini"],
  [/\bthis afternoon\b/g, "siang ini"],
  [/\bthis evening\b/g, "sore ini"],
  [/\btonight\b/g, "malam ini"],
  [/\b(?:yesterday|kemaren|kmrn|kmaren|kmarin)\b/g, "kemarin"],
  [/\btoday\b/g, "hari ini"],
  [/\b(?:earlier|just now|a moment ago|moments ago|baru saja|baru aja|tdi)\b/g, "tadi"],
  [
    /\b(?:last meal|last one|latest|most recent|previous meal|previous one|previously|previous|before|paling baru)\b/g,
    "terakhir",
  ],
  [/\b(?:a|1|one) week ago\b/g, "minggu lalu"],
  [/\blast week\b/g, "minggu lalu"],
  [/\bmakan pagi\b/g, "sarapan"],
  [/\bbreakfast\b/g, "sarapan"],
  [/\blunch\b/g, "makan siang"],
  [/\b(?:dinner|supper)\b/g, "makan malam"],
  [/\b(?:iftar|buka puasa)\b/g, "berbuka"],
  [/\bsnacks\b/g, "snack"],
  [/\bmonday\b/g, "senin"],
  [/\btuesday\b/g, "selasa"],
  [/\bwednesday\b/g, "rabu"],
  [/\bthursday\b/g, "kamis"],
  [/\bfriday\b/g, "jumat"],
  [/\bsaturday\b/g, "sabtu"],
  [/\bsunday\b/g, "hari minggu"],
  [/\b(?:kyk|kaya|ky|kek|kaye)\b/g, "kayak"],
  [/\bspt\b/g, "seperti"],
  [/\bsm\b/g, "sama"],
  [/\b(?:dgn|dg)\b/g, "dengan"],
  [/\byg\b/g, "yang"],
  [/\b(?:tp|tpi)\b/g, "tapi"],
  [/\b(?:gak|nggak|ngga|gk|tdk|tak|enggak|engga|tidak)\b/g, "ga"],
  [/\bpake\b/g, "pakai"],
  [/\bjgn\b/g, "jangan"],
  [/\bgausah\b/g, "ga usah"],
  [/\bdobel\b/g, "double"],
  [/\bdan\b|&/g, "dan"],
  [/\+/g, " plus "],
  [/\b3\/4\b/g, "tigaperempat"],
  [/\b1\/2\b/g, "setengah"],
  [/\b1\/4\b/g, "seperempat"],
  [/\b(\d+) days? ago\b/g, "$1 hari lalu"],
  [new RegExp(`\\b(${NUMBER_WORD_RE}) days? ago\\b`, "g"), "$1 hari lalu"],
];

function normalize(raw: string): string {
  let s = raw
    .toLowerCase()
    .replace(/½/g, " 1/2 ")
    .replace(/¼/g, " 1/4 ")
    .replace(/¾/g, " 3/4 ")
    .normalize("NFKC")
    .replace(/[’'`]s\b/g, "")
    .replace(/['’`]/g, "")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/\bulang tahun\b|\bultah\b/g, " | ")
    .replace(/(?<!\d)[.,;:!?()[\]{}"“”\n\r\t]+|[.,;:!?()[\]{}"“”\n\r\t]+(?!\d)/g, " | ")
    .replace(/\s[-–—]\s/g, " | ");
  for (const [pattern, replacement] of REWRITES) s = s.replace(pattern, replacement);
  return s
    .replace(/\|/g, " | ")
    .replace(/\s+/g, " ")
    .trim();
}

// ----------------------------------------------------------------- the cue

/** Words that can start a reference to an earlier meal. */
const REF_WORD =
  "tadi|barusan|kemarin|semalam|lusa|sarapan|makan|menu|makanan|snack|camilan|cemilan|jajan|jajanan|pagi|siang|sore|malam|hari|terakhir|yang|sahur|buka|berbuka|senin|selasa|rabu|kamis|jumat|sabtu|minggu|seminggu|sepekan|pekan|\\d+|my|the|that|a|one|" +
  NUMBER_WORD_RE;

/** "sama kayak ..." style cues: the reference must follow right behind them. */
const PRE_CUE = new RegExp(
  "(?<![a-z0-9])(?:" +
    [
      "(?:sama|persis|mirip|samain|samakan)(?: (?:dengan|kayak|seperti))?",
      "(?:kayak|seperti)",
      "same(?: [a-z]+){0,2} as",
      "(?:same|just|exactly) like",
      "like(?= (?:kemarin|tadi|terakhir|semalam|hari ini|pagi ini|siang ini|sore ini|malam ini|the one))",
    ].join("|") +
    `) (?=(?:${REF_WORD})(?![a-z0-9]))`,
);
const ULANG = /(?<![a-z0-9])(?:ulang|ulangi|ulangin|ngulang|repeat|salin|copy|duplicate|duplikat|redo)(?![a-z0-9])/;
const LAGI =
  /(?<![a-z0-9])(?:lagi|again)(?= \||$| (?:tapi|but|dengan|tanpa|with|without|setengah|double|dong|ya|yah|deh|nih|aja|saja|sih|please)(?![a-z0-9]))/;

// -------------------------------------------------------- the day and the slot

const WEEKDAYS: Record<string, number> = {
  minggu: 0,
  senin: 1,
  selasa: 2,
  rabu: 3,
  kamis: 4,
  jumat: 5,
  sabtu: 6,
};

type Cursor = { s: string };

/** First match of `re`, cut out of the text (replaced by a clause break). */
function take(cursor: Cursor, re: RegExp): RegExpExecArray | null {
  const match = re.exec(cursor.s);
  if (!match) return null;
  cursor.s = `${cursor.s.slice(0, match.index)} | ${cursor.s.slice(match.index + match[0].length)}`;
  return match;
}

type Expr = {
  dayOffset: number | null;
  slots: Meal[] | null;
  last: boolean;
  /** A day was named outright ("kemarin", "hari senin"), not just implied by "tadi". */
  dayWord: boolean;
};

const SLOT_WORDS: Array<[RegExp, Meal[]]> = [
  [/(?<![a-z0-9])(?:makan )?pagi(?![a-z0-9])|(?<![a-z0-9])sarapan(?![a-z0-9])/, ["sarapan"]],
  [/(?<![a-z0-9])(?:makan )?siang(?![a-z0-9])/, ["makan_siang"]],
  [/(?<![a-z0-9])(?:makan )?malam(?![a-z0-9])/, ["makan_malam"]],
  [/(?<![a-z0-9])(?:makan )?sore(?![a-z0-9])/, ["makan_malam", "snack"]],
  [/(?<![a-z0-9])(?:snack|camilan|cemilan|jajanan|jajan|ngemil)(?![a-z0-9])/, ["snack"]],
  [/(?<![a-z0-9])sahur(?![a-z0-9])/, ["sahur"]],
  [/(?<![a-z0-9])(?:berbuka|buka)(?![a-z0-9])/, ["berbuka"]],
];

/** Pull the day / slot / "last" words out of `text`; null when there are none. */
function extractExpr(text: string, now: Date): { expr: Expr; rest: string } | null {
  const cursor: Cursor = { s: ` ${text} ` };
  const today = jakartaToday(now);
  const hour = jakartaClockHour(now);
  let dayOffset: number | null = null;
  let dayWord = false;
  let slots: Meal[] | null = null;
  let last = false;
  let tadi = false;

  const setDay = (offset: number) => {
    dayOffset = offset;
    dayWord = true;
  };

  if (take(cursor, /(?<![a-z0-9])(?:seminggu|sepekan|minggu|pekan) (?:yang )?(?:lalu|kemarin|lewat)(?![a-z0-9])/)) {
    setDay(-7);
  }
  const weekday = take(
    cursor,
    /(?<![a-z0-9])(?:hari )?(senin|selasa|rabu|kamis|jumat|sabtu)(?: (?:kemarin|lalu|lewat))?(?![a-z0-9])|(?<![a-z0-9])hari (minggu)(?: (?:kemarin|lalu|lewat))?(?![a-z0-9])/,
  );
  if (weekday) {
    const name = (weekday[1] ?? weekday[2])!;
    const todayDow = new Date(`${today}T00:00:00Z`).getUTCDay();
    setDay(-(((todayDow - WEEKDAYS[name]!) % 7 + 7) % 7 || 7));
  }
  if (take(cursor, /(?<![a-z0-9])kemarin lusa(?![a-z0-9])|(?<![a-z0-9])lusa kemarin(?![a-z0-9])/)) setDay(-2);
  const daysAgo = take(
    cursor,
    new RegExp(`(?<![a-z0-9])(\\d+|${NUMBER_WORD_RE}) hari (?:yang )?(?:lalu|lewat)(?![a-z0-9])`),
  );
  if (daysAgo) {
    const n = NUMBER_WORDS[daysAgo[1]!] ?? Number(daysAgo[1]);
    if (n >= 1 && n <= REFERENCE_WINDOW_DAYS) setDay(-n);
  }
  if (take(cursor, /(?<![a-z0-9])(?:kemarin malam|malam kemarin|semalam)(?![a-z0-9])/)) {
    setDay(-1);
    slots = ["makan_malam"];
  }
  if (take(cursor, /(?<![a-z0-9])(?:tadi malam|malam tadi)(?![a-z0-9])/)) {
    setDay(hour >= EVENING_HOUR ? 0 : -1);
    slots = ["makan_malam"];
  }
  if (take(cursor, /(?<![a-z0-9])kemarin(?![a-z0-9])/)) setDay(-1);
  if (take(cursor, /(?<![a-z0-9])hari ini(?![a-z0-9])/)) setDay(0);
  if (take(cursor, /(?<=(?:pagi|siang|sore|malam) )ini(?![a-z0-9])/)) setDay(0);
  if (take(cursor, /(?<![a-z0-9])(?:tadi|barusan)(?![a-z0-9])/)) tadi = true;
  if (take(cursor, /(?<![a-z0-9])(?:terakhir|sebelumnya)(?![a-z0-9])/)) last = true;
  if (!slots) {
    for (const [re, found] of SLOT_WORDS) {
      if (take(cursor, re)) {
        slots = found;
        break;
      }
    }
  }
  if (tadi && dayOffset === null) {
    if (slots) {
      dayOffset = hour < NIGHT_OWL_HOUR ? -1 : 0;
    } else {
      last = true;
    }
  }
  if (dayOffset === null && slots === null && !last) return null;
  return { expr: { dayOffset, slots, last, dayWord }, rest: cursor.s.trim() };
}

// ------------------------------------------------------------------- modifiers

/** Words that carry no food or change of their own. */
const FILLER = new Set(
  (
    "yang tapi cuma hanya aja saja ya yah dong deh nih sih kok banget dan makan menu makanan porsi lagi aku saya gue gw mau pengen ingin catat tolong please but and " +
    "the a an my of it that meal food i had ate want to log just only as is for di ke dari dengan sama untuk buat hari ini itu tadi jadi portion portions with one kayak seperti pakai " +
    "last same like me this these those yg ga"
  ).split(" "),
);
const SKIP_BACK = new Set(["jadi", "cuma", "hanya", "aja", "saja", "just", "only", "porsi", "portion", "jadinya"]);
const SKIP_FORWARD = new Set(["porsi", "portion", "of", "the", "dari", "untuk", "buat", "for", "to"]);

const REMOVE_CUES = new Set(["tanpa", "minus", "kecuali", "jangan", "without", "except", "excluding", "skip", "no", "w/o"]);
const REMOVE_CUES_GA = new Set(["pakai", "usah", "ada", "mau", "perlu"]);
const REMOVE_STOP = new Set([
  "tapi", "but", "plus", "tambah", "tambahin", "ganti", "diganti", "dengan", "with", "terus", "trus", "lalu",
  "jadi", "setengah", "separuh", "seperempat", "tigaperempat", "double", "besar", "kecil",
]);
const LIST_JOINERS = new Set(["dan", "and", "sama"]);

type FactorHit = { len: number; factor: number };

function factorAt(tokens: string[], i: number): FactorHit | null {
  const t = tokens[i]!;
  const next = tokens[i + 1];
  if (t === "satu" && next === "setengah") return { len: 2, factor: 1.5 };
  if (t === "setengah" || t === "separuh" || t === "half") return { len: 1, factor: 0.5 };
  if (t === "seperempat" || t === "quarter") return { len: 1, factor: 0.25 };
  if (t === "tigaperempat") return { len: 1, factor: 0.75 };
  if (t === "double") return { len: 1, factor: 2 };
  if (t === "porsi" && (next === "besar" || next === "jumbo" || next === "gede")) return { len: 2, factor: 1.5 };
  if (t === "porsi" && (next === "kecil" || next === "mini")) return { len: 2, factor: 0.75 };
  if (t === "jumbo") return { len: 1, factor: 1.5 };
  if ((t === "large" || t === "big" || t === "bigger" || t === "larger") && next === "portion") {
    return { len: 2, factor: 1.5 };
  }
  if ((t === "small" || t === "smaller") && next === "portion") return { len: 2, factor: 0.75 };
  const times = /^(\d+(?:\.\d+)?)x$/.exec(t) ?? /^x(\d+(?:\.\d+)?)$/.exec(t);
  if (times) return { len: 1, factor: Number(times[1]) };
  const num = /^\d+(?:\.\d+)?$/.test(t) ? Number(t) : NUMBER_WORDS[t];
  if (num !== undefined && (next === "kali" || next === "x" || next === "porsi" || next === "portion" || next === "portions")) {
    return { len: 2, factor: num };
  }
  return null;
}

const CHANGE_WORDS =
  /(?<![a-z0-9])(?:tambah|tambahin|ditambah|plus|ganti|diganti|ubah|tukar|swap|replace|add|extra|instead|kurang|kurangi|banyakin|lebih|less|more)(?![a-z0-9])/;
const MIN_FACTOR = 0.1;
const MAX_FACTOR = 5;

/** Words that finish a portion phrase ("porsi besar"), never an item name. */
const SIZE_WORDS = new Set(["besar", "kecil", "jumbo", "gede", "mini", "banyak", "sedikit", "dikit", "portion"]);

function isWord(token: string | undefined): token is string {
  return token !== undefined && token !== "|" && /^[a-z]/.test(token);
}

function parseModifiers(rest: string): { mods: Modifiers; residual: string } {
  const tokens = rest.split(" ").filter((t) => t.length > 0);
  const used = new Array<boolean>(tokens.length).fill(false);
  const mods: Modifiers = { scale: 1, remove: [], items: [] };
  const globals: number[] = [];

  // "tanpa teh manis", "ga pakai kerupuk dan sambal"
  for (let i = 0; i < tokens.length; i++) {
    if (used[i]) continue;
    const t = tokens[i]!;
    let cueLen = 0;
    if (REMOVE_CUES.has(t)) cueLen = 1;
    else if (t === "ga" && REMOVE_CUES_GA.has(tokens[i + 1] ?? "")) cueLen = 2;
    if (cueLen === 0) continue;
    if (t === "no" && !isWord(tokens[i + cueLen])) continue;
    let j = i + cueLen;
    const phrases: string[][] = [[]];
    let taken = 0;
    while (j < tokens.length && taken < 6) {
      const w = tokens[j]!;
      if (!isWord(w) || REMOVE_STOP.has(w) || w.endsWith("nya") || used[j]) break;
      if (LIST_JOINERS.has(w)) phrases.push([]);
      else if (!FILLER.has(w)) phrases[phrases.length - 1]!.push(w);
      j += 1;
      taken += 1;
    }
    const found = phrases.filter((p) => p.length > 0);
    if (found.length === 0) continue;
    mods.remove.push(...found);
    for (let k = i; k < j; k++) used[k] = true;
  }

  // Portion factors: whole meal ("setengah", "porsi besar") or one item.
  for (let i = 0; i < tokens.length; i++) {
    if (used[i]) continue;
    const hit = factorAt(tokens, i);
    if (!hit || used.slice(i, i + hit.len).some(Boolean)) continue;
    if (hit.factor === 1) {
      for (let k = i; k < i + hit.len; k++) used[k] = true;
      continue;
    }
    if (hit.factor < MIN_FACTOR || hit.factor > MAX_FACTOR) continue;
    for (let k = i; k < i + hit.len; k++) used[k] = true;
    // Item to the left: "nasinya setengah", "nasi setengah".
    let b = i - 1;
    while (b >= 0 && !used[b] && SKIP_BACK.has(tokens[b]!)) b -= 1;
    let phrase: string[] | null = null;
    const left = tokens[b];
    if (b >= 0 && !used[b] && isWord(left) && !FILLER.has(left)) {
      const possessive = left.length > 4 && left.endsWith("nya");
      const stem = possessive ? left.slice(0, -3) : left;
      const before = tokens[b - 1];
      phrase =
        possessive && b > 0 && !used[b - 1] && isWord(before) && !FILLER.has(before) ? [before, stem] : [stem];
      if (possessive && phrase.length === 2) used[b - 1] = true;
      used[b] = true;
    } else {
      // Item to the right: "setengah nasi", "half the rice", "double rice".
      let f = i + hit.len;
      while (f < tokens.length && !used[f] && SKIP_FORWARD.has(tokens[f]!)) f += 1;
      const right = tokens[f];
      if (f < tokens.length && !used[f] && isWord(right) && !FILLER.has(right) && !REMOVE_CUES.has(right) && !SIZE_WORDS.has(right) && factorAt(tokens, f) === null) {
        phrase = [right.endsWith("nya") && right.length > 4 ? right.slice(0, -3) : right];
        used[f] = true;
      }
    }
    if (phrase) mods.items.push({ phrase, factor: hit.factor });
    else globals.push(hit.factor);
  }

  const residual = tokens
    .filter((t, i) => !used[i] && isWord(t) && !FILLER.has(t) && !SKIP_BACK.has(t) && !SKIP_FORWARD.has(t))
    .join(" ");
  if (globals.length === 1) mods.scale = globals[0]!;
  // A second whole-meal factor ("setengah ... porsi besar") has no clear reading: the AI gets the text.
  return { mods, residual: globals.length > 1 ? rest.replace(/\|/g, " ").replace(/\s+/g, " ").trim() : residual };
}

// ------------------------------------------------------------------- the parse

/**
 * Detect "same as ..." in a story and say what it points at. Null when the
 * text is a plain description ("sama sekali belum makan", "makan siang di
 * warung yang sama").
 */
export function parseMealReference(text: string, now: Date = new Date()): MealReference | null {
  const s = normalize(text);
  if (s.length === 0) return null;

  let expr: Expr;
  let rest: string;
  const pre = PRE_CUE.exec(s);
  if (pre) {
    const head = s.slice(0, pre.index);
    const tail = s.slice(pre.index + pre[0].length);
    const fromTail = extractExpr(tail, now);
    if (!fromTail) return null;
    // "makan siang yang sama kayak kemarin": a slot said before the cue still counts.
    const fromHead = extractExpr(`${head} ${pre[0]}`, now);
    expr = {
      dayOffset: fromTail.expr.dayOffset ?? fromHead?.expr.dayOffset ?? null,
      slots: fromTail.expr.slots ?? fromHead?.expr.slots ?? null,
      last: fromTail.expr.last,
      dayWord: fromTail.expr.dayWord || (fromTail.expr.dayOffset === null && Boolean(fromHead?.expr.dayWord)),
    };
    rest = `${fromHead ? fromHead.rest : head} | ${fromTail.rest}`;
  } else {
    const cursor: Cursor = { s: s };
    const needsDay = !take(cursor, ULANG) && Boolean(take(cursor, LAGI));
    const stripped = cursor.s;
    if (stripped === s) return null;
    const parsed = extractExpr(stripped, now);
    if (!parsed) return null;
    // "sarapan lagi" alone reads as a plain mention; "sarapan kemarin lagi" is a pointer.
    if (needsDay && !parsed.expr.dayWord && !parsed.expr.last) return null;
    expr = parsed.expr;
    rest = parsed.rest;
  }

  const { mods, residual } = parseModifiers(rest);
  // A cue behind a food description is a plain story ("nasi goreng kayak makan malam")
  // unless the leftovers ask for a change ("tambah telur").
  if (pre && residual.length > 0 && !CHANGE_WORDS.test(residual)) {
    const described = s.slice(0, pre.index).split(" ").filter((w) => isWord(w) && !FILLER.has(w)).length;
    if (described >= 2) return null;
  }
  return {
    dayOffset: expr.dayOffset,
    slots: expr.slots,
    last: expr.last,
    mods,
    residual,
  };
}

// ------------------------------------------------------------------ resolution

export type Target = { date: string; meal: Meal };

/** Where a story lands: the sheet's slot (or the clock's) on the viewed day. */
export function storyTarget(input: {
  now: Date;
  date?: string;
  meal?: Meal;
  slots: readonly Meal[];
}): Target {
  const today = jakartaToday(input.now);
  const slots = input.slots.length > 0 ? input.slots : (MEALS as readonly Meal[]);
  const suggested = suggestMealNow(input.now, slots.includes("sahur"));
  return {
    date: input.date && input.date <= today ? input.date : today,
    meal:
      input.meal && slots.includes(input.meal)
        ? input.meal
        : slots.includes(suggested)
          ? suggested
          : slots[0]!,
  };
}

export type MealGroup = {
  date: string;
  meal: Meal;
  rows: MealRow[];
  kcal: number;
  /** Newest log time inside the group (ms). */
  latest: number;
};

export function groupRows(rows: readonly MealRow[]): MealGroup[] {
  const groups = new Map<string, MealGroup>();
  for (const row of rows) {
    const key = `${row.date}|${row.meal}`;
    let group = groups.get(key);
    if (!group) {
      group = { date: row.date, meal: row.meal, rows: [], kcal: 0, latest: 0 };
      groups.set(key, group);
    }
    group.rows.push(row);
    group.kcal += row.kcal;
    group.latest = Math.max(group.latest, row.createdAt);
  }
  for (const group of groups.values()) group.rows.sort((a, b) => a.createdAt - b.createdAt);
  return [...groups.values()];
}

export type Resolution =
  | { status: "found"; group: MealGroup }
  | {
      status: "empty";
      wanted: { date: string | null; meal: Meal | null };
      /** The nearest logged meal, offered instead. */
      suggestion: MealGroup | null;
    };

/** Pick the logged meal a reference points at, given what the user is adding to. */
export function resolveReference(
  ref: Pick<MealReference, "dayOffset" | "slots" | "last">,
  rows: readonly MealRow[],
  target: Target,
  now: Date = new Date(),
): Resolution {
  const today = jakartaToday(now);
  const oldest = shiftDate(today, -REFERENCE_WINDOW_DAYS);
  const groups = groupRows(rows).filter((g) => g.date <= today && g.date >= oldest);
  const isTarget = (g: MealGroup) => g.date === target.date && g.meal === target.meal;
  const others = groups.filter((g) => !isTarget(g));
  const newest = (a: MealGroup, b: MealGroup) => b.latest - a.latest;
  const at = (date: string, meal: Meal) => groups.find((g) => g.date === date && g.meal === meal);

  let wanted: { date: string | null; meal: Meal | null } = { date: null, meal: null };
  if (ref.last) {
    const found = [...others].sort(newest)[0];
    if (found) return { status: "found", group: found };
  } else if (ref.dayOffset !== null) {
    const date = shiftDate(today, ref.dayOffset);
    if (ref.slots) {
      wanted = { date, meal: ref.slots[0]! };
      for (const slot of ref.slots) {
        const found = at(date, slot);
        if (found) return { status: "found", group: found };
      }
    } else {
      wanted = { date, meal: target.meal };
      const same = at(date, target.meal);
      const found =
        same && !isTarget(same)
          ? same
          : [...others.filter((g) => g.date === date)].sort(newest)[0];
      if (found) return { status: "found", group: found };
    }
  } else if (ref.slots) {
    wanted = { date: null, meal: ref.slots[0]! };
    for (let back = 0; back <= REFERENCE_WINDOW_DAYS; back++) {
      const date = shiftDate(today, -back);
      for (const slot of ref.slots) {
        const found = at(date, slot);
        if (found && !isTarget(found)) return { status: "found", group: found };
      }
    }
  }

  const anchor = wanted.date ?? today;
  const cost = (g: MealGroup) =>
    Math.abs(daysBetween(g.date, anchor)) * 4 + (wanted.meal && g.meal !== wanted.meal ? 1 : 0);
  const suggestion = [...others].sort((a, b) => cost(a) - cost(b) || newest(a, b))[0] ?? null;
  return { status: "empty", wanted, suggestion };
}

// ------------------------------------------------------------------- applying

const ALIASES = [
  ["nasi", "rice"],
  ["teh", "tea"],
  ["telur", "egg", "eggs"],
  ["ayam", "chicken"],
  ["mie", "noodle", "noodles"],
  ["kopi", "coffee"],
  ["susu", "milk"],
  ["sayur", "vegetable", "vegetables", "veggies"],
  ["daging", "beef", "meat"],
  ["ikan", "fish"],
  ["tahu", "tofu"],
  ["tempe", "tempeh"],
  ["gula", "sugar"],
  ["es", "ice", "iced"],
  ["air", "water"],
  ["goreng", "fried"],
  ["bakar", "grilled"],
  ["roti", "bread"],
  ["buah", "fruit"],
  ["keju", "cheese"],
  ["manis", "sweet"],
  ["sambal", "chili"],
  ["kerupuk", "cracker", "crackers"],
] as const;

function variants(word: string): string[] {
  const group = ALIASES.find((g) => (g as readonly string[]).includes(word));
  return group ? [...group] : [word];
}

function nameWords(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 0);
}

/** Rows that best match an item phrase; several when it cannot tell them apart. */
function matchRows(rows: readonly MealRow[], phrase: readonly string[]): number[] {
  let best = 0;
  let hits: number[] = [];
  rows.forEach((row, index) => {
    const words = nameWords(row.name);
    let score = 0;
    for (const word of phrase) {
      const options = variants(word);
      if (
        words.some((w) =>
          options.some((o) => w === o || (o.length >= 4 && w.length >= 4 && (w.startsWith(o) || o.startsWith(w)))),
        )
      ) {
        score += 1;
      }
    }
    if (score > best) {
      best = score;
      hits = [index];
    } else if (score === best && score > 0) {
      hits.push(index);
    }
  });
  return hits;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** "½×", "2×", "1.5×": how a scaled copy is labelled in the review list. */
export function factorLabel(factor: number): string {
  if (factor === 0.5) return "½×";
  if (factor === 0.25) return "¼×";
  if (factor === 0.75) return "¾×";
  return `${round1(factor)}×`;
}

/** One logged row as a review item: stored nutrition, scaled; nothing re-estimated. */
export function scaleRow(row: MealRow, factor: number): CalibratedItem {
  const scaled = (value: number | null) => (value === null ? undefined : round1(value * factor));
  return {
    name: row.name,
    ...(factor !== 1 ? { portion: factorLabel(factor) } : {}),
    grams: row.grams === null ? undefined : Math.max(1, round1(row.grams * factor)),
    kcal: round1(row.kcal * factor),
    protein: scaled(row.protein),
    carbs: scaled(row.carbs),
    fat: scaled(row.fat),
    fiber: scaled(row.fiber),
  };
}

export type Applied =
  | { ok: true; items: CalibratedItem[] }
  /** A change the rules could not pin to one item, or words they could not place. */
  | { ok: false };

/** Apply portion/removal changes to the referenced rows. */
export function applyModifiers(rows: readonly MealRow[], ref: Pick<MealReference, "mods" | "residual">): Applied {
  if (ref.residual.length > 0) return { ok: false };
  const factors = rows.map(() => ref.mods.scale);
  const removed = new Set<number>();
  for (const phrase of ref.mods.remove) {
    const hits = matchRows(rows, phrase);
    if (hits.length !== 1) return { ok: false };
    removed.add(hits[0]!);
  }
  for (const { phrase, factor } of ref.mods.items) {
    const hits = matchRows(rows, phrase);
    if (hits.length !== 1) return { ok: false };
    factors[hits[0]!] = factors[hits[0]!]! * factor;
  }
  const items = rows.flatMap((row, i) => (removed.has(i) ? [] : [scaleRow(row, factors[i]!)]));
  return { ok: true, items };
}

/** True when the reference carries nothing beyond "copy that meal". */
export function isPlainCopy(ref: Pick<MealReference, "mods">): boolean {
  return ref.mods.scale === 1 && ref.mods.remove.length === 0 && ref.mods.items.length === 0;
}
