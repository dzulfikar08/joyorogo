// Pure logic for "Tempat makan": plates grouped by where they were eaten.
// Coordinates are sensitive: they only exist when the user opted in, are cut
// to ~100 m before storage, and are only ever served back to their owner.

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

/** "850 m" under a kilometre, "2,4 km" above (id-ID decimal comma). */
export function formatDistance(meters: number): string {
  if (meters < 950) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  const km = meters / 1000;
  return `${km.toFixed(km < 10 ? 1 : 0).replace(".", ",")} km`;
}

/** "Hari ini", "Kemarin", "4 hari lalu", "2 minggu lalu", "3 bulan lalu". */
export function visitAgeLabel(date: string, today: string): string {
  const days = Math.max(0, daysBetween(date, today));
  if (days === 0) return "Hari ini";
  if (days === 1) return "Kemarin";
  if (days < 14) return `${days} hari lalu`;
  if (days < 60) return `${Math.floor(days / 7)} minggu lalu`;
  if (days < 365) return `${Math.floor(days / 30)} bulan lalu`;
  return `${Math.floor(days / 365)} tahun lalu`;
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

/** A cutout belonging to one component of a plate. */
export type PlateSticker = { plateId: string; scanId: string; name: string; kcal: number };

export type PlaceSummary = {
  key: string;
  /** The spelling used on the most recent visit. */
  name: string;
  visits: number;
  lastDate: string;
  favoriteDish: string | null;
  favoriteCount: number;
  avgPriceIdr: number | null;
  stickerScanId: string | null;
  stickerName: string | null;
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

/**
 * Groups plates by normalized place name. The favorite dish is the most
 * frequent plate name (ties go to the most recent); the sticker comes from
 * the newest visit of that dish that has a cutout, else the newest visit with one.
 */
export function aggregatePlaces(
  rows: PlaceVisitRow[],
  stickers: PlateSticker[],
): PlaceSummary[] {
  const stickerByPlate = new Map<string, PlateSticker>();
  for (const sticker of stickers) {
    const current = stickerByPlate.get(sticker.plateId);
    if (!current || sticker.kcal > current.kcal) stickerByPlate.set(sticker.plateId, sticker);
  }

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
    const dishes = new Map<string, { name: string; count: number }>();
    for (const visit of visits) {
      const dishKey = normalizePlaceKey(visit.name);
      const dish = dishes.get(dishKey);
      if (dish) dish.count += 1;
      else dishes.set(dishKey, { name: visit.name, count: 1 });
    }
    // Map keeps insertion order = newest first, so a strict > keeps the newest on ties.
    let favorite: { key: string; name: string; count: number } | null = null;
    for (const [dishKey, dish] of dishes) {
      if (!favorite || dish.count > favorite.count) favorite = { key: dishKey, ...dish };
    }

    const stickerVisit =
      visits.find(
        (visit) => normalizePlaceKey(visit.name) === favorite?.key && stickerByPlate.has(visit.id),
      ) ?? visits.find((visit) => stickerByPlate.has(visit.id));
    const sticker = stickerVisit ? stickerByPlate.get(stickerVisit.id)! : null;

    const prices = visits.map((v) => v.priceIdr).filter((p): p is number => p != null && p > 0);
    const located = visits.filter((v) => v.lat != null && v.lng != null);

    out.push({
      key,
      name: newest.place,
      visits: visits.length,
      lastDate: newest.date,
      favoriteDish: favorite?.name ?? null,
      favoriteCount: favorite?.count ?? 0,
      avgPriceIdr:
        prices.length > 0 ? Math.round(prices.reduce((s, p) => s + p, 0) / prices.length) : null,
      stickerScanId: sticker?.scanId ?? null,
      stickerName: sticker?.name ?? null,
      lat: located.length > 0 ? roundCoord(located.reduce((s, v) => s + v.lat!, 0) / located.length) : null,
      lng: located.length > 0 ? roundCoord(located.reduce((s, v) => s + v.lng!, 0) / located.length) : null,
    });
  }
  return out;
}

export type PlaceSort = "sering" | "terbaru" | "terdekat";

/** Orders summaries for a tab; "terdekat" needs an origin and drops places with no coordinates. */
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
  return withDistance.toSorted(
    (a, b) => b.visits - a.visits || b.lastDate.localeCompare(a.lastDate),
  );
}
