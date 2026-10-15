import { describe, expect, test } from "bun:test";

import {
  foodKind,
  isHeavyDish,
  normalizeFoodKind,
  parseFoodKind,
  resolveFoodKind,
} from "./food-kind";

describe("foodKind", () => {
  test("gorengan, kue, keripik and martabak are camilan", () => {
    for (const name of [
      "Gorengan",
      "Pisang goreng",
      "Bakwan jagung",
      "Kue lapis",
      "Keripik singkong",
      "Martabak manis",
      "Es krim vanilla",
      "Roti bakar cokelat",
    ]) {
      expect(foodKind(name)).toBe("camilan");
    }
  });

  test("kopi, teh, jus, susu and es are minuman", () => {
    for (const name of ["Kopi susu", "Teh manis", "Jus alpukat", "Susu kedelai", "Es campur", "Cokelat panas"]) {
      expect(foodKind(name)).toBe("minuman");
    }
  });

  test("fried rice and fried chicken stay makanan berat", () => {
    for (const name of ["Nasi goreng", "Ayam goreng", "Mie goreng", "Gado-gado"]) {
      expect(foodKind(name)).toBe("makanan");
    }
  });

  test("supplements are lainnya", () => {
    expect(foodKind("Whey protein")).toBe("lainnya");
  });
});

describe("rice and main dishes are makanan", () => {
  const dishes = ["Nasi kuning", "Nasi uduk", "Nasi goreng", "Lontong sayur"];

  test("name heuristic", () => {
    for (const name of dishes) {
      expect(foodKind(name)).toBe("makanan");
      expect(isHeavyDish(name)).toBe(true);
    }
  });

  test("an AI snack/minuman hint cannot demote them", () => {
    for (const name of dishes) {
      expect(resolveFoodKind(name, "snack")).toBe("makanan");
      expect(resolveFoodKind(name, "Camilan")).toBe("makanan");
      expect(resolveFoodKind(name, "minuman")).toBe("makanan");
    }
  });

  test("snacks are not heavy dishes", () => {
    expect(isHeavyDish("Pisang goreng")).toBe(false);
    expect(resolveFoodKind("Pisang goreng", "snack")).toBe("camilan");
  });
});

describe("resolveFoodKind", () => {
  test("a usable AI kind wins over the name, except for staple dishes", () => {
    expect(resolveFoodKind("Bolu kukus", "minuman")).toBe("minuman");
    expect(resolveFoodKind("Teh", "Makanan Berat")).toBe("makanan");
    expect(resolveFoodKind("Nasi goreng", "camilan")).toBe("makanan");
  });

  test("a missing, unknown or lainnya hint falls back to the name", () => {
    expect(resolveFoodKind("Keripik tempe")).toBe("camilan");
    expect(resolveFoodKind("Keripik tempe", "entah")).toBe("camilan");
    expect(resolveFoodKind("Whey protein", "lainnya")).toBe("lainnya");
    expect(resolveFoodKind("Es teh", "lainnya")).toBe("minuman");
  });

  test("normalize and parse stay strict about their domain", () => {
    expect(normalizeFoodKind(" Snack ")).toBe("camilan");
    expect(normalizeFoodKind(42)).toBeUndefined();
    expect(parseFoodKind("camilan")).toBe("camilan");
    expect(parseFoodKind("snack")).toBeUndefined();
  });
});
