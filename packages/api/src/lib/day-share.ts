// A whole diary day as share data: the rows of one date, grouped by meal slot, with the cutouts to draw and the day's
// numbers against the targets. Pure: the screens hand over what Makan already loaded, and the sticker engine
// (packages/sticker `DayFoodStory`) draws it. The shape below is that story's, structurally; packages/api does not
// depend on the engine, so the apps pass it straight to the share sheet and TypeScript checks the match there.
//
// Honesty: a macro nobody logged for the day or the meal stays null (never 0), grams only when the row has them, and no
// body weight is part of it. Pride framing lives in the engine (only reached targets are called out).

import { MEALS } from "./engine";

export type DayShareRow = {
  name: string;
  meal: string;
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  grams: number | null;
  /** Cutout of this food. */
  scanId: string | null;
  /** Cutout of the whole plate (the same on every row of a scan). */
  plateScanId?: string | null;
  /** The diary's plate group, when the rows were logged as one plate. */
  plateId: string | null;
};

export type DayShareItem = {
  name: string;
  grams: number | null;
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
};

export type DayShareMeal = {
  label: string;
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  names: string;
  items: DayShareItem[];
  stickers: string[];
};

export type DayShare = {
  kind: "dayfood";
  date: Date;
  kcal: number;
  targetKcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  proteinTargetG: number | null;
  carbsTargetG: number | null;
  fatTargetG: number | null;
  fiberTargetG: number | null;
  gain: boolean;
  meals: DayShareMeal[];
};

export type DayShareInput = {
  /** YYYY-MM-DD, the diary day. */
  date: string;
  rows: readonly DayShareRow[];
  /** Names the user gave plates, by plate id. */
  plateNames?: Readonly<Record<string, string>>;
  /** Slots in the order the diary shows them (Ramadan swaps them). Slots with rows that are not listed follow. */
  slots: readonly string[];
  mealLabel: (meal: string) => string;
  stickerUrl: (scanId: string) => string;
  /** Scan ids of cutouts that could not be loaded (see `dayShareStickerIds`); the meal falls back to the next best one. */
  failedStickers?: ReadonlySet<string>;
  /** The day's kcal as the diary's header shows it. */
  eatenKcal: number;
  targets: {
    kcal: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    fiberG: number | null;
  };
  /** Hamil / Menyusui: a need to meet, so no kcal target is drawn. */
  maternal?: boolean;
  /** Naikin BB. */
  gain?: boolean;
};

/** Sum of the values somebody logged, or null when nobody did. */
function sumKnown(values: ReadonlyArray<number | null | undefined>): number | null {
  let total: number | null = null;
  for (const value of values) if (value != null) total = (total ?? 0) + value;
  return total;
}

function parseDay(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 12);
}

/** One plate group, or one loose row: the rows that were logged together. */
type Unit = { rows: DayShareRow[]; kcal: number };

function unitsOf(rows: readonly DayShareRow[]): Unit[] {
  const units: Unit[] = [];
  const byPlate = new Map<string, Unit>();
  for (const row of rows) {
    const existing = row.plateId ? byPlate.get(row.plateId) : undefined;
    if (existing) {
      existing.rows.push(row);
      existing.kcal += row.kcal;
      continue;
    }
    const unit: Unit = { rows: [row], kcal: row.kcal };
    units.push(unit);
    if (row.plateId) byPlate.set(row.plateId, unit);
  }
  return units;
}

function stickersOf(units: readonly Unit[], url: (scanId: string) => string, failed: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const usable = (id: string | null | undefined): id is string => Boolean(id) && !failed.has(id!);
  for (const unit of [...units].sort((a, b) => b.kcal - a.kcal)) {
    const plate = unit.rows.find((row) => usable(row.plateScanId))?.plateScanId;
    // A whole-plate cutout already shows every food of its scan, so the scan's component cutouts stay out.
    if (plate) {
      if (!out.includes(url(plate))) out.push(url(plate));
      continue;
    }
    const components = unit.rows
      .filter((row) => usable(row.scanId))
      .sort((a, b) => b.kcal - a.kcal)
      .map((row) => url(row.scanId!));
    for (const uri of components) if (!out.includes(uri)) out.push(uri);
  }
  return out;
}

/** The line that says what the meal was: a named plate stands for its foods, the rest list by name. */
function namesOf(units: readonly Unit[], plateNames: Readonly<Record<string, string>>): string {
  const names: string[] = [];
  for (const unit of units) {
    const plateId = unit.rows[0]?.plateId;
    const plateName = plateId && unit.rows.length >= 2 ? plateNames[plateId]?.trim() : "";
    for (const name of plateName ? [plateName] : unit.rows.map((row) => row.name.trim())) {
      if (name && !names.some((seen) => seen.toLowerCase() === name.toLowerCase())) names.push(name);
    }
  }
  return names.join(", ");
}

export function buildDayShare(input: DayShareInput): DayShare {
  const failed = input.failedStickers ?? new Set<string>();
  const plateNames = input.plateNames ?? {};
  const known = new Set(input.slots);
  const order = [...input.slots, ...MEALS.filter((meal) => !known.has(meal))];

  const meals: DayShareMeal[] = [];
  for (const slot of order) {
    const rows = input.rows.filter((row) => row.meal === slot);
    if (rows.length === 0) continue;
    const units = unitsOf(rows);
    meals.push({
      label: input.mealLabel(slot),
      kcal: rows.reduce((total, row) => total + row.kcal, 0),
      protein: sumKnown(rows.map((row) => row.protein)),
      carbs: sumKnown(rows.map((row) => row.carbs)),
      fat: sumKnown(rows.map((row) => row.fat)),
      names: namesOf(units, plateNames),
      items: rows.map((row) => ({
        name: row.name,
        grams: row.grams,
        kcal: row.kcal,
        protein: row.protein,
        carbs: row.carbs,
        fat: row.fat,
      })),
      stickers: stickersOf(units, input.stickerUrl, failed),
    });
  }

  const positive = (n: number | null): number | null => (n !== null && n > 0 ? n : null);
  return {
    kind: "dayfood",
    date: parseDay(input.date),
    kcal: input.eatenKcal,
    targetKcal: input.maternal ? null : positive(input.targets.kcal),
    protein: sumKnown(input.rows.map((row) => row.protein)),
    carbs: sumKnown(input.rows.map((row) => row.carbs)),
    fat: sumKnown(input.rows.map((row) => row.fat)),
    fiber: sumKnown(input.rows.map((row) => row.fiber)),
    proteinTargetG: positive(input.targets.proteinG),
    carbsTargetG: positive(input.targets.carbsG),
    fatTargetG: positive(input.targets.fatG),
    fiberTargetG: positive(input.targets.fiberG),
    gain: input.gain === true,
    meals,
  };
}

/** The distinct cutout ids a day share would draw, so a screen can check they load before it opens the sheet. */
export function dayShareStickerIds(rows: readonly DayShareRow[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.plateScanId) ids.add(row.plateScanId);
    if (row.scanId) ids.add(row.scanId);
  }
  return [...ids];
}
