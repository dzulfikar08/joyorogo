import { describe, expect, test } from "bun:test";

import {
  aggregatePlaces,
  distanceM,
  formatDistance,
  normalizePlaceKey,
  roundCoord,
  sortPlaces,
  toStoredCoords,
  visitAgeLabel,
} from "./places";
import type { PlaceVisitRow, PlateSticker } from "./places";

const visit = (over: Partial<PlaceVisitRow> & { id: string }): PlaceVisitRow => ({
  date: "2026-10-10",
  meal: "makan_siang",
  name: "Nasi ayam",
  place: "Warung Bu Tini",
  priceIdr: null,
  lat: null,
  lng: null,
  createdAt: 0,
  ...over,
});

describe("coordinates", () => {
  test("rounds to about 100 m", () => {
    expect(roundCoord(-7.983908)).toBe(-7.984);
    expect(roundCoord(112.630026)).toBe(112.63);
  });

  test("rejects partial or out-of-range pairs", () => {
    expect(toStoredCoords(-7.98391, 112.63003)).toEqual({ lat: -7.984, lng: 112.63 });
    expect(toStoredCoords(-7.9, null)).toBeNull();
    expect(toStoredCoords(95, 10)).toBeNull();
    expect(toStoredCoords(Number.NaN, 10)).toBeNull();
  });

  test("haversine and labels", () => {
    expect(distanceM({ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 })).toBeCloseTo(1112, -1);
    expect(formatDistance(430)).toBe("430 m");
    expect(formatDistance(2400)).toBe("2,4 km");
    expect(formatDistance(14_000)).toBe("14 km");
    expect(formatDistance(2400, "en")).toBe("2.4 km");
    expect(formatDistance(430, "en")).toBe("430 m");
  });
});

describe("normalizePlaceKey", () => {
  test("ignores case, accents and spacing", () => {
    expect(normalizePlaceKey("  RM  Sederhana. ")).toBe("rm sederhana");
    expect(normalizePlaceKey("Café Kopi")).toBe("cafe kopi");
    expect(normalizePlaceKey("  ")).toBe("");
  });
});

describe("visitAgeLabel", () => {
  test("relative Indonesian labels", () => {
    expect(visitAgeLabel("2026-10-15", "2026-10-15")).toBe("Hari ini");
    expect(visitAgeLabel("2026-10-14", "2026-10-15")).toBe("Kemarin");
    expect(visitAgeLabel("2026-10-11", "2026-10-15")).toBe("4 hari lalu");
    expect(visitAgeLabel("2026-09-24", "2026-10-15")).toBe("3 minggu lalu");
    expect(visitAgeLabel("2026-07-15", "2026-10-15")).toBe("3 bulan lalu");
  });

  test("relative English labels with plurals", () => {
    expect(visitAgeLabel("2026-10-15", "2026-10-15", "en")).toBe("Today");
    expect(visitAgeLabel("2026-10-14", "2026-10-15", "en")).toBe("Yesterday");
    expect(visitAgeLabel("2026-10-11", "2026-10-15", "en")).toBe("4 days ago");
    expect(visitAgeLabel("2026-09-24", "2026-10-15", "en")).toBe("3 weeks ago");
    expect(visitAgeLabel("2025-10-14", "2026-10-15", "en")).toBe("1 year ago");
  });
});

describe("aggregatePlaces", () => {
  const rows = [
    visit({ id: "a", date: "2026-10-12", name: "Nasi ayam", priceIdr: 20000, lat: -7.984, lng: 112.63 }),
    visit({ id: "b", date: "2026-10-14", name: "Es teh", place: "warung bu tini ", priceIdr: 10000, lat: -7.986, lng: 112.632 }),
    visit({ id: "c", date: "2026-10-13", name: "nasi ayam" }),
    visit({ id: "d", date: "2026-10-01", name: "Soto", place: "Soto Pak Kumis" }),
    visit({ id: "e", date: "2026-10-02", place: null }),
    visit({ id: "f", date: "2026-10-03", place: "   " }),
  ];
  const stickers: PlateSticker[] = [
    { plateId: "a", scanId: "s-a", name: "Nasi ayam", kcal: 500 },
    { plateId: "a", scanId: "s-a2", name: "Lalap", kcal: 20 },
    { plateId: "b", scanId: "s-b", name: "Es teh", kcal: 80 },
  ];
  const places = aggregatePlaces(rows, stickers);

  test("groups by normalized place and skips plates without one", () => {
    expect(places.map((p) => p.key).toSorted()).toEqual(["soto pak kumis", "warung bu tini"]);
  });

  test("summarizes visits, favorite dish, price and spelling of the latest visit", () => {
    const tini = places.find((p) => p.key === "warung bu tini")!;
    expect(tini.visits).toBe(3);
    expect(tini.name).toBe("warung bu tini ");
    expect(tini.lastDate).toBe("2026-10-14");
    expect(tini.favoriteDish).toBe("nasi ayam");
    expect(tini.favoriteCount).toBe(2);
    expect(tini.avgPriceIdr).toBe(15000);
  });

  test("sticker comes from the favorite dish's newest visit and the biggest component", () => {
    const tini = places.find((p) => p.key === "warung bu tini")!;
    expect(tini.stickerScanId).toBe("s-a");
    expect(places.find((p) => p.key === "soto pak kumis")!.stickerScanId).toBeNull();
  });

  test("coordinates average and stay rounded; absent without opt-in", () => {
    const tini = places.find((p) => p.key === "warung bu tini")!;
    expect(tini.lat).toBe(-7.985);
    expect(tini.lng).toBe(112.631);
    const soto = places.find((p) => p.key === "soto pak kumis")!;
    expect(soto.lat).toBeNull();
    expect(soto.lng).toBeNull();
  });
});

describe("sortPlaces", () => {
  const rows = [
    visit({ id: "a", place: "Jauh", date: "2026-10-14", lat: -7.9, lng: 112.6 }),
    visit({ id: "b", place: "Dekat", date: "2026-10-01", lat: -7.984, lng: 112.63 }),
    visit({ id: "c", place: "Dekat", date: "2026-10-02", lat: -7.984, lng: 112.63 }),
    visit({ id: "d", place: "Tanpa lokasi", date: "2026-10-15" }),
  ];
  const places = aggregatePlaces(rows, []);

  test("tabs", () => {
    expect(sortPlaces(places, "sering").map((p) => p.name)[0]).toBe("Dekat");
    expect(sortPlaces(places, "terbaru").map((p) => p.name)[0]).toBe("Tanpa lokasi");
    const near = sortPlaces(places, "terdekat", { lat: -7.985, lng: 112.631 });
    expect(near.map((p) => p.name)).toEqual(["Dekat", "Jauh"]);
    expect(sortPlaces(places, "terdekat", null)).toEqual([]);
  });
});
