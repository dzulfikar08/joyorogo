import { describe, expect, test } from "bun:test";

import { DEFAULT_DAY_ZONE as ZONE } from "@joyorogo/i18n";

import {
  applyModifiers,
  groupRows,
  isPlainCopy,
  parseMealReference,
  resolveReference,
  scaleRow,
  storyTarget,
} from "./meal-reference";
import type { MealReference, MealRow } from "./meal-reference";
import type { Meal } from "./engine";

// Monday 2026-10-19, 12:00 WIB.
const NOON = new Date("2026-10-19T05:00:00Z");
// Tuesday 2026-10-20, 00:30 WIB: the WIB day has just flipped (17:30Z is still Oct 19 in UTC).
const JUST_AFTER_MIDNIGHT = new Date("2026-10-19T17:30:00Z");
// Monday 21:00 WIB.
const EVENING = new Date("2026-10-19T14:00:00Z");
// Monday 09:00 WIB.
const MORNING = new Date("2026-10-19T02:00:00Z");

type Pointer = { day: number | null; slots: Meal[] | null; last?: boolean };

const point = (text: string, now: Date = NOON): Pointer | null => {
  const ref = parseMealReference(text, now, ZONE);
  return ref ? { day: ref.dayOffset, slots: ref.slots, last: ref.last } : null;
};

const LUNCH: Meal[] = ["makan_siang"];
const DINNER: Meal[] = ["makan_malam"];
const BREAKFAST: Meal[] = ["sarapan"];

describe("parseMealReference: phrases that point at an earlier meal", () => {
  const positives: Array<[string, Pointer]> = [
    // The owner's examples
    ["makan yang sama dengan tadi siang", { day: 0, slots: LUNCH }],
    ["sama kayak tadi siang", { day: 0, slots: LUNCH }],
    ["sama dengan sarapan kemarin", { day: -1, slots: BREAKFAST }],
    ["menu yang sama kayak makan malam kemarin", { day: -1, slots: DINNER }],
    ["kayak tadi pagi tapi nasinya setengah", { day: 0, slots: BREAKFAST }],
    ["ulang makan siang", { day: null, slots: LUNCH }],
    ["same as lunch", { day: null, slots: LUNCH }],
    ["same as yesterday's dinner", { day: -1, slots: DINNER }],
    // Slang and spelling variants
    ["kek tadi siang", { day: 0, slots: LUNCH }],
    ["kyk sarapan kemarin", { day: -1, slots: BREAKFAST }],
    ["kaya makan malam kmrn", { day: -1, slots: DINNER }],
    ["sm kayak sarapan kemaren", { day: -1, slots: BREAKFAST }],
    ["persis kayak tadi siang", { day: 0, slots: LUNCH }],
    ["sama persis dengan makan siang kemarin", { day: -1, slots: LUNCH }],
    ["samain kayak sarapan kemarin dong", { day: -1, slots: BREAKFAST }],
    ["mirip sama makan malam kemarin", { day: -1, slots: DINNER }],
    ["seperti sarapan kemarin", { day: -1, slots: BREAKFAST }],
    ["ulangi sarapan kemarin", { day: -1, slots: BREAKFAST }],
    ["ulangin makan malam kemarin ya", { day: -1, slots: DINNER }],
    ["sarapan kemarin lagi", { day: -1, slots: BREAKFAST }],
    ["makan malam kemarin lagi dong", { day: -1, slots: DINNER }],
    ["makan malam semalam lagi", { day: -1, slots: DINNER }],
    // Days
    ["sama kayak kemarin", { day: -1, slots: null }],
    ["sama kayak kemarin lusa", { day: -2, slots: null }],
    ["kayak 3 hari lalu", { day: -3, slots: null }],
    ["kayak tiga hari yang lalu", { day: -3, slots: null }],
    ["sama kayak makan siang minggu lalu", { day: -7, slots: LUNCH }],
    ["kayak hari senin", { day: -7, slots: null }],
    ["sama kayak sarapan hari jumat", { day: -3, slots: BREAKFAST }],
    ["kayak hari minggu", { day: -1, slots: null }],
    ["persis kayak semalem", { day: -1, slots: DINNER }],
    ["sama kayak kemarin malam", { day: -1, slots: DINNER }],
    // Slots
    ["kayak snack tadi", { day: 0, slots: ["snack"] }],
    ["sama kayak camilan kemarin", { day: -1, slots: ["snack"] }],
    ["sama kayak sahur kemarin", { day: -1, slots: ["sahur"] }],
    ["sama kayak buka puasa kemarin", { day: -1, slots: ["berbuka"] }],
    ["sama kayak makan sore kemarin", { day: -1, slots: ["makan_malam", "snack"] }],
    ["sama kayak pagi ini", { day: 0, slots: BREAKFAST }],
    // "the last one"
    ["ulangi yang tadi", { day: null, slots: null, last: true }],
    ["sama persis kayak yang barusan", { day: null, slots: null, last: true }],
    ["sama kayak yang terakhir", { day: null, slots: null, last: true }],
    ["kayak tadi", { day: null, slots: null, last: true }],
    ["same as the last meal", { day: null, slots: null, last: true }],
    // English
    ["same as breakfast", { day: null, slots: BREAKFAST }],
    ["same as yesterday", { day: -1, slots: null }],
    ["same as this morning's breakfast", { day: 0, slots: BREAKFAST }],
    ["same as last night's dinner", { day: -1, slots: DINNER }],
    ["same lunch as yesterday", { day: -1, slots: LUNCH }],
    ["repeat yesterday's lunch", { day: -1, slots: LUNCH }],
    ["repeat lunch", { day: null, slots: LUNCH }],
    ["just like yesterday's breakfast", { day: -1, slots: BREAKFAST }],
    ["same as two days ago", { day: -2, slots: null }],
    ["same as monday's lunch", { day: -7, slots: LUNCH }],
    ["same as before", { day: null, slots: null, last: true }],
    ["lunch from yesterday again", { day: -1, slots: LUNCH }],
  ];

  test.each(positives)("%s", (text, expected) => {
    expect(point(text)).toEqual({ last: false, ...expected });
  });

  test("the table covers at least 30 positive phrases", () => {
    expect(positives.length).toBeGreaterThanOrEqual(30);
  });
});

describe("parseMealReference: plain descriptions never trigger a copy", () => {
  const negatives = [
    "sama sekali belum makan",
    "makan siang di warung yang sama",
    "tadi makan siang nasi padang",
    "sarapan nasi uduk",
    "nasi goreng 1 porsi",
    "kemarin makan nasi goreng sama telur",
    "makan siang sama teman kemarin",
    "makan malam sama keluarga",
    "ga makan sama sekali kemarin",
    "ulang tahun tadi malam makan kue",
    "sarapan lagi",
    "lagi makan siang di kantor",
    "makan lagi",
    "lagi sarapan nih",
    "nasi goreng kayak makan malam",
    "I like lunch",
    "I had the same lunch as my friend",
    "same old breakfast",
    "kayak biasa",
    "mirip nasi padang",
    "kopi susu",
    "es teh manis dan roti bakar",
    "sama-sama",
    "kemarin sarapan bubur ayam, siang soto",
    "",
  ];

  test.each(negatives)("%s", (text) => {
    expect(point(text)).toBeNull();
  });

  test("the table covers at least 10 negatives", () => {
    expect(negatives.length).toBeGreaterThanOrEqual(10);
  });
});

describe("day math around midnight WIB", () => {
  test("'tadi siang' just after midnight means the day that just ended", () => {
    expect(point("sama kayak tadi siang", JUST_AFTER_MIDNIGHT)).toMatchObject({ day: -1, slots: LUNCH });
    expect(point("sama kayak tadi siang", NOON)).toMatchObject({ day: 0, slots: LUNCH });
  });

  test("'tadi malam' is yesterday except in the evening itself", () => {
    expect(point("kayak tadi malam", JUST_AFTER_MIDNIGHT)?.day).toBe(-1);
    expect(point("kayak tadi malam", MORNING)?.day).toBe(-1);
    expect(point("kayak tadi malam", EVENING)?.day).toBe(0);
  });

  test("calendar words stay calendar: 'kemarin' after midnight is the calendar yesterday", () => {
    expect(point("kayak kemarin", JUST_AFTER_MIDNIGHT)?.day).toBe(-1);
  });

  test("weekday names count back from the WIB weekday, not the UTC one", () => {
    // 00:30 WIB Tuesday is still Monday in UTC. "hari senin" is yesterday, not a week ago.
    expect(point("kayak hari senin", JUST_AFTER_MIDNIGHT)?.day).toBe(-1);
    expect(point("kayak hari senin", NOON)?.day).toBe(-7);
  });

  test("the resolver finds the WIB lunch of the day that just ended", () => {
    const rows = [row("2026-10-19", "makan_siang", "Nasi padang", 600, 1)];
    const ref = parseMealReference("sama kayak tadi siang", JUST_AFTER_MIDNIGHT, ZONE)!;
    const found = resolveReference(ref, rows, { date: "2026-10-20", meal: "snack" }, JUST_AFTER_MIDNIGHT, ZONE);
    expect(found.status === "found" && found.group.date).toBe("2026-10-19");
  });
});

function row(date: string, meal: Meal, name: string, kcal: number, at: number, extra: Partial<MealRow> = {}): MealRow {
  return {
    date,
    meal,
    name,
    kcal,
    grams: null,
    protein: null,
    carbs: null,
    fat: null,
    fiber: null,
    createdAt: at,
    ...extra,
  };
}

describe("modifiers", () => {
  const mods = (text: string) => parseMealReference(text, NOON, ZONE)!;

  test("a plain copy has no changes", () => {
    expect(isPlainCopy(mods("sama kayak tadi siang"))).toBe(true);
  });

  const scales: Array<[string, number]> = [
    ["sama kayak tadi siang tapi setengah porsi", 0.5],
    ["sama kayak tadi siang, setengah aja", 0.5],
    ["sama kayak kemarin ½", 0.5],
    ["sama kayak kemarin 1/2 porsi", 0.5],
    ["sama kayak kemarin porsi besar", 1.5],
    ["sama kayak kemarin porsi kecil", 0.75],
    ["sama kayak kemarin 2x", 2],
    ["sama kayak kemarin x2", 2],
    ["sama kayak kemarin dua kali", 2],
    ["sama kayak kemarin 1.5x", 1.5],
    ["sama kayak kemarin dobel", 2],
    ["same as yesterday, double portion", 2],
    ["same as yesterday but half", 0.5],
    ["same as yesterday large portion", 1.5],
    ["sama kayak kemarin seperempat", 0.25],
  ];
  test.each(scales)("portion scale: %s", (text, factor) => {
    const ref = mods(text);
    expect(ref.mods.scale).toBe(factor);
    expect(ref.residual).toBe("");
  });

  test("a single item can be scaled", () => {
    expect(mods("kayak tadi pagi tapi nasinya setengah").mods.items).toEqual([{ phrase: ["nasi"], factor: 0.5 }]);
    expect(mods("sama kayak kemarin nasi dobel").mods.items).toEqual([{ phrase: ["nasi"], factor: 2 }]);
    expect(mods("same as lunch but half the rice").mods.items).toEqual([{ phrase: ["rice"], factor: 0.5 }]);
    expect(mods("kayak kemarin tapi nasinya setengah").mods.scale).toBe(1);
  });

  test("items can be removed", () => {
    expect(mods("kayak kemarin tapi tanpa teh manis").mods.remove).toEqual([["teh", "manis"]]);
    expect(mods("kayak kemarin ga pake kerupuk").mods.remove).toEqual([["kerupuk"]]);
    expect(mods("kayak kemarin tanpa kerupuk dan sambal").mods.remove).toEqual([["kerupuk"], ["sambal"]]);
    expect(mods("same as yesterday without sugar").mods.remove).toEqual([["sugar"]]);
  });

  test("anything the rules cannot place is left as residual for the AI", () => {
    expect(mods("sama kayak kemarin tambah telur").residual).toBe("tambah telur");
    expect(mods("sama kayak kemarin tapi ayamnya diganti ikan").residual).toContain("ikan");
    expect(mods("same as yesterday plus an egg").residual).toContain("egg");
    expect(mods("sama kayak kemarin setengah porsi besar").residual).not.toBe("");
  });

  const breakfast = [
    row("2026-10-19", "sarapan", "Nasi putih", 200, 1, { grams: 150, protein: 4, carbs: 44, fat: 0.4, fiber: 0.6 }),
    row("2026-10-19", "sarapan", "Ayam goreng", 250, 2, { grams: 100, protein: 20, carbs: 5, fat: 15 }),
    row("2026-10-19", "sarapan", "Es teh manis", 80, 3, { grams: 250, carbs: 20 }),
  ];

  test("whole-meal scale keeps stored nutrition, scaled", () => {
    const out = applyModifiers(breakfast, mods("sama kayak kemarin setengah porsi"));
    expect(out).toEqual({
      ok: true,
      items: [
        { name: "Nasi putih", portion: "½×", grams: 75, kcal: 100, protein: 2, carbs: 22, fat: 0.2, fiber: 0.3 },
        { name: "Ayam goreng", portion: "½×", grams: 50, kcal: 125, protein: 10, carbs: 2.5, fat: 7.5, fiber: undefined },
        { name: "Es teh manis", portion: "½×", grams: 125, kcal: 40, protein: undefined, carbs: 10, fat: undefined, fiber: undefined },
      ],
    });
  });

  test("one item scaled, the rest untouched", () => {
    const out = applyModifiers(breakfast, mods("kayak kemarin tapi nasinya setengah"));
    expect(out.ok && out.items.map((i) => [i.name, i.kcal])).toEqual([
      ["Nasi putih", 100],
      ["Ayam goreng", 250],
      ["Es teh manis", 80],
    ]);
  });

  test("an item is removed by its words, in either language", () => {
    const id = applyModifiers(breakfast, mods("kayak kemarin tanpa teh manis"));
    expect(id.ok && id.items.map((i) => i.name)).toEqual(["Nasi putih", "Ayam goreng"]);
    const en = applyModifiers(breakfast, mods("same as yesterday without tea"));
    expect(en.ok && en.items.map((i) => i.name)).toEqual(["Nasi putih", "Ayam goreng"]);
  });

  test("removing everything gives an empty copy", () => {
    const out = applyModifiers([breakfast[0]!], mods("kayak kemarin tanpa nasi"));
    expect(out).toEqual({ ok: true, items: [] });
  });

  test("a phrase matching two rows, or none, is handed to the AI instead of guessed", () => {
    const twoRice = [...breakfast, row("2026-10-19", "sarapan", "Nasi goreng", 400, 4)];
    expect(applyModifiers(twoRice, mods("kayak kemarin nasinya setengah"))).toEqual({ ok: false });
    expect(applyModifiers(breakfast, mods("kayak kemarin tanpa kerupuk"))).toEqual({ ok: false });
    expect(applyModifiers(breakfast, mods("kayak kemarin tambah telur"))).toEqual({ ok: false });
  });

  test("scaleRow never invents values for fields the log does not have", () => {
    const item = scaleRow(row("2026-10-19", "snack", "Kue", 120, 1), 2);
    expect(item).toMatchObject({ kcal: 240, portion: "2×" });
    expect(item.grams).toBeUndefined();
    expect(item.protein).toBeUndefined();
  });
});

describe("resolveReference", () => {
  const TARGET = { date: "2026-10-19", meal: "snack" as Meal };
  const log = [
    row("2026-10-19", "sarapan", "Bubur ayam", 350, 100),
    row("2026-10-19", "makan_siang", "Nasi padang", 700, 200),
    row("2026-10-18", "sarapan", "Roti", 200, 50),
    row("2026-10-18", "makan_malam", "Sate", 500, 60),
    row("2026-10-17", "makan_siang", "Soto", 300, 40),
    row("2026-10-05", "makan_siang", "Terlalu lama", 300, 10),
  ];
  const resolve = (text: string, target = TARGET, rows = log) =>
    resolveReference(parseMealReference(text, NOON, ZONE) as MealReference, rows, target, NOON, ZONE);
  const names = (r: ReturnType<typeof resolve>) => (r.status === "found" ? r.group.rows.map((x) => x.name) : null);

  test("'tadi siang' is today's lunch", () => {
    expect(names(resolve("sama kayak tadi siang"))).toEqual(["Nasi padang"]);
  });

  test("an explicit day and slot", () => {
    expect(names(resolve("sama kayak makan malam kemarin"))).toEqual(["Sate"]);
  });

  test("a day without a slot copies that day's meal for the slot being added to", () => {
    expect(names(resolve("sama kayak kemarin", { date: "2026-10-19", meal: "sarapan" }))).toEqual(["Roti"]);
  });

  test("a slot without a day takes the most recent one, skipping the slot being added to", () => {
    expect(names(resolve("ulang makan siang"))).toEqual(["Nasi padang"]);
    expect(names(resolve("ulang makan siang", { date: "2026-10-19", meal: "makan_siang" }))).toEqual(["Soto"]);
  });

  test("'terakhir' is the newest log, never the slot being filled", () => {
    expect(names(resolve("ulangi yang tadi"))).toEqual(["Nasi padang"]);
    expect(names(resolve("ulangi yang tadi", { date: "2026-10-19", meal: "makan_siang" }))).toEqual(["Bubur ayam"]);
  });

  test("an empty slot says so and offers the nearest logged meal", () => {
    const out = resolve("sama kayak sarapan kemarin lusa");
    expect(out.status).toBe("empty");
    if (out.status !== "empty") return;
    expect(out.wanted).toEqual({ date: "2026-10-17", meal: "sarapan" });
    // 17 Oct has lunch only; 18 Oct breakfast is the same slot one day away, 17 Oct lunch the same day another slot.
    expect(out.suggestion).toMatchObject({ date: "2026-10-17", meal: "makan_siang" });
  });

  test("nothing logged in the window at all gives no suggestion", () => {
    const out = resolve("sama kayak tadi siang", TARGET, []);
    expect(out).toMatchObject({ status: "empty", suggestion: null });
  });

  test("meals older than the window are out of reach", () => {
    const out = resolve("sama kayak makan siang minggu lalu", TARGET, [log[5]!]);
    expect(out.status).toBe("empty");
  });

  test("groupRows keeps diary order inside a meal", () => {
    const [group] = groupRows([
      row("2026-10-19", "sarapan", "B", 1, 2),
      row("2026-10-19", "sarapan", "A", 1, 1),
    ]);
    expect(group!.rows.map((r) => r.name)).toEqual(["A", "B"]);
  });
});

describe("storyTarget", () => {
  const slots: Meal[] = ["sarapan", "makan_siang", "makan_malam", "snack"];

  test("the slot the user is adding to wins, on the day being viewed", () => {
    expect(storyTarget({ zone: ZONE, now: NOON, date: "2026-10-17", meal: "snack", slots })).toEqual({
      date: "2026-10-17",
      meal: "snack",
    });
  });

  test("without a slot it follows the clock; future days clamp to today", () => {
    expect(storyTarget({ zone: ZONE, now: NOON, date: "2030-01-01", slots })).toEqual({ date: "2026-10-19", meal: "makan_siang" });
    expect(storyTarget({ zone: ZONE, now: MORNING, slots })).toEqual({ date: "2026-10-19", meal: "sarapan" });
  });

  test("a slot the client does not offer falls back to the clock", () => {
    expect(storyTarget({ zone: ZONE, now: NOON, meal: "sahur", slots })).toEqual({ date: "2026-10-19", meal: "makan_siang" });
  });
});
