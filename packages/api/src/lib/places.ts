// Pure logic for "Tempat makan": plates grouped by where they were eaten.
// Coordinates are sensitive: they only exist when the user opted in, are cut
// to ~100 m before storage, and are only ever served back to their owner.

import { fmtDecimal, fmtInt, getActiveLocale, getT } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

import { daysBetween } from "./engine";

/** 3 decimals of a degree is ~111 m north-south: coarse enough to not be a doorstep. */
export const COORD_DECIMALS = 3;

export function roundCoord(value: number): number {
  const factor = 10 ** COORD_DECIMALS;
  return Math.round(value * factor) / factor;
}

/** Latitude/longitude pair as stored, or null when either is missing/out of range. */
export function toStoredCoords(
  lat: number | null | undefined,
  lng: number | null | undefined,
): { lat: number; lng: number } | null {
  if (lat == null || lng == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: roundCoord(lat), lng: roundCoord(lng) };
}

/** Case-, accent- and whitespace-insensitive key: "RM  Sederhana " = "rm sederhana". */
export function normalizePlaceKey(place: string): string {
  return place
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[\s,.;:]+/g, " ")
    .trim();
}

/** Great-circle distance in metres. */
export function distanceM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "850 m" under a kilometre, "2,4 km" (id) / "2.4 km" (en) above. */
export function formatDistance(meters: number, locale: Locale = getActiveLocale()): string {
  const t = getT(locale, "place");
  if (meters < 950) return t("distance.m", { value: fmtInt(Math.max(10, Math.round(meters / 10) * 10), locale) });
  const km = meters / 1000;
  return t("distance.km", { value: km < 10 ? fmtDecimal(km, 1, locale) : fmtInt(km, locale) });
}

/** "Hari ini", "Kemarin", "4 hari lalu", "2 minggu lalu", "3 bulan lalu". */
export function visitAgeLabel(
  date: string,
  today: string,
  locale: Locale = getActiveLocale(),
): string {
  const t = getT(locale, "place");
  const days = Math.max(0, daysBetween(date, today));
  if (days === 0) return t("age.today");
  if (days === 1) return t("age.yesterday");
  if (days < 14) return t("age.days", { count: days });
  if (days < 60) return t("age.weeks", { count: Math.floor(days / 7) });
  if (days < 365) return t("age.months", { count: Math.floor(days / 30) });
  return t("age.years", { count: Math.floor(days / 365) });
}

/** One plate that carries a place: a single visit. */
export type PlaceVisitRow = {
  id: string;
  date: string;
  meal: string;
  name: string;
  place: string | null;
  priceIdr: number | null;
  lat: number | null;
  lng: number | null;
  createdAt: number | string | Date | null;
};

/** What one plate added up to: its food rows' kcal and protein (protein null when none of them recorded it). */
export type PlateNutrition = { plateId: string; kcal: number; proteinG: number | null };

/** One dish as eaten at a place: how many plates and what they averaged. */
export type PlaceDish = {
  name: string;
  count: number;
  avgKcal: number;
  avgProteinG: number | null;
};

export type PlaceSummary = {
  key: string;
  /** The spelling used on the most recent visit. */
  name: string;
  visits: number;
  lastDate: string;
  avgPriceIdr: number | null;
  /** Mean kcal and protein per plate, over the visits whose plate has food rows. */
  avgKcal: number | null;
  avgProteinG: number | null;
  /** The dish with the most protein for its kcal; null with fewer than two dishes to compare. */
  proteinPick: PlaceDish | null;
  /** Mean of the stored (already rounded) visit coordinates, rounded again. */
  lat: number | null;
  lng: number | null;
};

const ms = (value: PlaceVisitRow["createdAt"]): number => {
  if (value == null) return 0;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
};

/** Newest visit first: by date, then by when it was logged. */
export function byNewestVisit(a: PlaceVisitRow, b: PlaceVisitRow): number {
  return b.date.localeCompare(a.date) || ms(b.createdAt) - ms(a.createdAt);
}

const hasPlace = (row: PlaceVisitRow): row is PlaceVisitRow & { place: string } =>
  row.place != null && normalizePlaceKey(row.place) !== "";

/** Visits of one place, newest first. */
export function visitsOfPlace(rows: PlaceVisitRow[], key: string): PlaceVisitRow[] {
  return rows
    .filter((row) => hasPlace(row) && normalizePlaceKey(row.place) === key)
    .toSorted(byNewestVisit);
}

const mean = (values: number[]): number | null =>
  values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const roundOrNull = (value: number | null): number | null =>
  value === null ? null : Math.round(value);

/** Protein per kcal of a dish, or null when the protein was never recorded. */
const proteinDensity = (dish: PlaceDish): number | null =>
  dish.avgProteinG !== null && dish.avgKcal > 0 ? dish.avgProteinG / dish.avgKcal : null;

/**
 * Dishes with the most protein for their kcal first; dishes whose protein was
 * never recorded follow, lightest first.
 */
export function rankDishes(dishes: PlaceDish[]): PlaceDish[] {
  return dishes.toSorted((a, b) => {
    const da = proteinDensity(a);
    const db = proteinDensity(b);
    if (da !== null && db !== null) return db - da || a.avgKcal - b.avgKcal;
    if (da !== null) return -1;
    if (db !== null) return 1;
    return a.avgKcal - b.avgKcal;
  });
}

/**
 * What each dish eaten at a place averaged, from the plates that have food rows.
 * Dishes group by normalized plate name and come back ranked by `rankDishes`.
 */
export function dishesOfPlace(visits: PlaceVisitRow[], nutrition: PlateNutrition[]): PlaceDish[] {
  const byPlate = new Map(nutrition.map((entry) => [entry.plateId, entry]));
  const groups = new Map<string, { name: string; kcal: number[]; protein: number[] }>();
  // Newest visit first, so a dish keeps the spelling of its latest plate.
  for (const visit of visits.toSorted(byNewestVisit)) {
    const entry = byPlate.get(visit.id);
    if (!entry) continue;
    const key = normalizePlaceKey(visit.name);
    const group = groups.get(key) ?? { name: visit.name, kcal: [], protein: [] };
    group.kcal.push(entry.kcal);
    if (entry.proteinG !== null) group.protein.push(entry.proteinG);
    groups.set(key, group);
  }
  return rankDishes(
    [...groups.values()].map((group) => ({
      name: group.name,
      count: group.kcal.length,
      avgKcal: Math.round(mean(group.kcal) ?? 0),
      avgProteinG: roundOrNull(mean(group.protein)),
    })),
  );
}

/**
 * Groups plates by normalized place name and averages what was eaten there. The
 * protein pick is the dish with the most protein for its kcal, offered only
 * when the place has at least two dishes to compare.
 */
export function aggregatePlaces(
  rows: PlaceVisitRow[],
  nutrition: PlateNutrition[],
): PlaceSummary[] {
  const byPlate = new Map(nutrition.map((entry) => [entry.plateId, entry]));

  const groups = new Map<string, Array<PlaceVisitRow & { place: string }>>();
  for (const row of rows.toSorted(byNewestVisit)) {
    if (!hasPlace(row)) continue;
    const key = normalizePlaceKey(row.place);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const out: PlaceSummary[] = [];
  for (const [key, visits] of groups) {
    const newest = visits[0]!;
    const prices = visits.map((v) => v.priceIdr).filter((p): p is number => p != null && p > 0);
    const located = visits.filter((v) => v.lat != null && v.lng != null);
    const eaten = visits.flatMap((visit) => byPlate.get(visit.id) ?? []);
    const dishes = dishesOfPlace(visits, nutrition);

    out.push({
      key,
      name: newest.place,
      visits: visits.length,
      lastDate: newest.date,
      avgPriceIdr: roundOrNull(mean(prices)),
      avgKcal: roundOrNull(mean(eaten.map((entry) => entry.kcal))),
      avgProteinG: roundOrNull(
        mean(eaten.flatMap((entry) => (entry.proteinG === null ? [] : [entry.proteinG]))),
      ),
      proteinPick: dishes.length >= 2 ? dishes[0]! : null,
      lat: located.length > 0 ? roundCoord(located.reduce((s, v) => s + v.lat!, 0) / located.length) : null,
      lng: located.length > 0 ? roundCoord(located.reduce((s, v) => s + v.lng!, 0) / located.length) : null,
    });
  }
  return out;
}

export type PlaceSort = "sering" | "terbaru" | "terdekat" | "ringan";

/**
 * Orders summaries for a tab; "terdekat" needs an origin and drops places with no coordinates,
 * "ringan" puts the lowest average plate first (places with no nutrition data last).
 */
export function sortPlaces(
  places: PlaceSummary[],
  sort: PlaceSort,
  origin?: { lat: number; lng: number } | null,
): Array<PlaceSummary & { distanceM: number | null }> {
  const withDistance = places.map((place) => ({
    ...place,
    distanceM:
      origin && place.lat != null && place.lng != null
        ? distanceM(origin, { lat: place.lat, lng: place.lng })
        : null,
  }));
  if (sort === "terdekat") {
    return withDistance
      .filter((place) => place.distanceM != null)
      .toSorted((a, b) => a.distanceM! - b.distanceM!);
  }
  if (sort === "terbaru") {
    return withDistance.toSorted(
      (a, b) => b.lastDate.localeCompare(a.lastDate) || b.visits - a.visits,
    );
  }
  if (sort === "ringan") {
    return withDistance.toSorted(
      (a, b) =>
        (a.avgKcal ?? Number.POSITIVE_INFINITY) - (b.avgKcal ?? Number.POSITIVE_INFINITY) ||
        b.visits - a.visits,
    );
  }
  return withDistance.toSorted(
    (a, b) => b.visits - a.visits || b.lastDate.localeCompare(a.lastDate),
  );
}
