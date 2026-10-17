import { describe, expect, test } from "bun:test";

import { SourceUnavailableError, classifyProduct, normalizeBarcode } from "./barcode";
import type { ProductData } from "./barcode";
import { lookupBarcode } from "./barcode-lookup";
import type { BarcodeSource } from "./barcode-lookup";
import { barcodeSources } from "./barcode-sources";
import { fetchUsdaProduct, parseUsdaFood, usdaQuery, usdaSource } from "./barcode-usda";
import { createClient } from "../../../db/node_modules/@libsql/client";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/libsql";
import type { Database } from "@joyorogo/db";

// Shaped like FDC /foods/search entries for dataType=Branded (field names per the
// FDC API guide): values are per 100 g, or per 100 ml when servingSizeUnit is ml.
const COOKIE = {
  fdcId: 1,
  description: "CHOCOLATE SANDWICH COOKIES",
  brandOwner: "Example Foods Inc.",
  brandName: "EXAMPLE",
  gtinUpc: "044000032029",
  servingSize: 34,
  servingSizeUnit: "g",
  packageWeight: "13.29 oz/376 g",
  foodNutrients: [
    { nutrientNumber: "203", nutrientName: "Protein", unitName: "G", value: 5.88 },
    { nutrientNumber: "204", nutrientName: "Total lipid (fat)", unitName: "G", value: 20.6 },
    { nutrientNumber: "205", nutrientName: "Carbohydrate, by difference", unitName: "G", value: 70.6 },
    { nutrientNumber: "208", nutrientName: "Energy", unitName: "KCAL", value: 471 },
    { nutrientNumber: "269", nutrientName: "Sugars, total including NLEA", unitName: "G", value: 38.2 },
    { nutrientNumber: "291", nutrientName: "Fiber, total dietary", unitName: "G", value: 2.9 },
    { nutrientNumber: "307", nutrientName: "Sodium, Na", unitName: "MG", value: 441 },
  ],
};

const SODA = {
  description: "Orange soda",
  brandOwner: "Example Beverage Co",
  gtinUpc: "00012000161155",
  servingSize: 355,
  servingSizeUnit: "ml",
  foodNutrients: [
    { nutrientNumber: 268, unitName: "KJ", value: 190 },
    { nutrientNumber: "205", unitName: "G", value: 11.2 },
    { nutrientNumber: "203", unitName: "G", value: 0 },
    { nutrientNumber: "204", unitName: "G", value: 0 },
  ],
};

describe("parseUsdaFood", () => {
  test("maps per-100 nutrients, serving size, brand and a readable name", () => {
    const product = parseUsdaFood(COOKIE, "0044000032029");
    expect(product).toEqual({
      name: "Chocolate Sandwich Cookies",
      brand: "Example",
      quantity: "13.29 oz/376 g",
      servingSize: 34,
      unit: "g",
      kcal100: 471,
      protein100: 5.88,
      carbs100: 70.6,
      fat100: 20.6,
      fiber100: 2.9,
      sugar100: 38.2,
      imageUrl: null,
    });
  });

  test("a liquid is per 100 ml, energy in kJ only is converted, a 14-digit GTIN matches", () => {
    const product = parseUsdaFood(SODA, "0012000161155")!;
    expect(product.unit).toBe("ml");
    expect(product.servingSize).toBe(355);
    expect(product.kcal100).toBeCloseTo(45.4, 1);
    expect(product.name).toBe("Orange soda");
    expect(product.brand).toBe("Example Beverage Co");
    expect(product.fiber100).toBeNull();
  });

  test("Atwater energy is the fallback when 208 is absent; a unit that is not kcal is not trusted", () => {
    const withAtwater = { ...COOKIE, foodNutrients: [{ nutrientNumber: "958", unitName: "KCAL", value: 300 }] };
    expect(parseUsdaFood(withAtwater, "0044000032029")?.kcal100).toBe(300);
    const wrongUnit = { ...COOKIE, foodNutrients: [{ nutrientNumber: "208", unitName: "G", value: 300 }] };
    expect(parseUsdaFood(wrongUnit, "0044000032029")?.kcal100).toBeNull();
  });

  test("another GTIN, a missing name or an unusable serving unit", () => {
    expect(parseUsdaFood(COOKIE, "0044000032036")).toBeNull();
    expect(parseUsdaFood({ ...COOKIE, description: " " }, "0044000032029")).toBeNull();
    expect(parseUsdaFood({ ...COOKIE, gtinUpc: null }, "0044000032029")).toBeNull();
    const oz = parseUsdaFood({ ...COOKIE, servingSizeUnit: "oz" }, "0044000032029");
    expect(oz?.servingSize).toBeNull();
    expect(oz?.unit).toBe("g");
  });

  test("USDA numbers go through the same plausibility rules as every source", () => {
    const absurd = parseUsdaFood(
      { ...COOKIE, foodNutrients: [{ nutrientNumber: "208", unitName: "KCAL", value: 4000 }] },
      "0044000032029",
    )!;
    expect(classifyProduct("0044000032029", absurd, { source: "usda", contributors: 0 }).status).toBe("incomplete");
    const ok = parseUsdaFood(COOKIE, "0044000032029")!;
    expect(classifyProduct("0044000032029", ok, { source: "usda", contributors: 0 })).toMatchObject({
      status: "found",
      source: "usda",
      sugar100: 38.2,
    });
  });
});

describe("usdaQuery", () => {
  test("our zero-padded EAN-13 goes back to the UPC-A FDC stores; real EANs stay", () => {
    expect(usdaQuery(normalizeBarcode("044000032029")!)).toBe("044000032029");
    expect(usdaQuery("0044000032029")).toBe("044000032029");
    expect(usdaQuery("8996001600146")).toBe("8996001600146");
    expect(usdaQuery("96385074")).toBe("96385074");
  });
});

function reply(status: number, body: unknown, seen?: { url?: string; headers?: Headers }): typeof fetch {
  return ((url: string, init?: RequestInit) => {
    if (seen) {
      seen.url = url;
      seen.headers = new Headers(init?.headers);
    }
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as unknown as typeof fetch;
}

describe("fetchUsdaProduct", () => {
  test("searches branded foods by GTIN with the key in a header, not the URL", async () => {
    const seen: { url?: string; headers?: Headers } = {};
    const product = await fetchUsdaProduct("0044000032029", "SECRET", reply(200, { foods: [COOKIE] }, seen));
    expect(product?.name).toBe("Chocolate Sandwich Cookies");
    const url = new URL(seen.url!);
    expect(url.searchParams.get("query")).toBe("044000032029");
    expect(url.searchParams.get("dataType")).toBe("Branded");
    expect(seen.url).not.toContain("SECRET");
    expect(seen.headers?.get("x-api-key")).toBe("SECRET");
  });

  test("a text hit for another product is not a hit; the entry with calories is preferred", async () => {
    const other = { ...COOKIE, gtinUpc: "044000099999", description: "OTHER" };
    const noKcal = { ...COOKIE, description: "NO NUMBERS", foodNutrients: [] };
    expect(await fetchUsdaProduct("0044000032029", "k", reply(200, { foods: [other] }))).toBeNull();
    expect((await fetchUsdaProduct("0044000032029", "k", reply(200, { foods: [noKcal, COOKIE] })))?.name).toBe(
      "Chocolate Sandwich Cookies",
    );
    expect(await fetchUsdaProduct("0044000032029", "k", reply(200, { foods: [] }))).toBeNull();
  });

  test("rate limit, a rejected key, 5xx, garbage and network failure are outages, never misses", async () => {
    for (const status of [429, 403, 500, 503]) {
      await expect(fetchUsdaProduct("0044000032029", "k", reply(status, {}))).rejects.toBeInstanceOf(
        SourceUnavailableError,
      );
    }
    const garbage = (() => Promise.resolve(new Response("<html>", { status: 200 }))) as unknown as typeof fetch;
    await expect(fetchUsdaProduct("0044000032029", "k", garbage)).rejects.toBeInstanceOf(SourceUnavailableError);
    const down = (() => Promise.reject(new Error("net"))) as unknown as typeof fetch;
    await expect(fetchUsdaProduct("0044000032029", "k", down)).rejects.toBeInstanceOf(SourceUnavailableError);
  });
});

describe("source registry", () => {
  test("USDA is asked after Open Food Facts, and only with its secret", () => {
    expect(barcodeSources({}).map((s) => s.id)).toEqual(["off"]);
    expect(barcodeSources({ USDA_FDC_API_KEY: "  " }).map((s) => s.id)).toEqual(["off"]);
    const sources = barcodeSources({ USDA_FDC_API_KEY: "key" });
    expect(sources.map((s) => s.id)).toEqual(["off", "usda"]);
    expect(sources[1]!.critical).toBe(false);
    expect(usdaSource("k").id).toBe("usda");
  });
});

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
const db = drizzle(client) as unknown as Database;

function counting(id: string, answer: ProductData | null, critical: boolean) {
  const source: BarcodeSource & { calls: number } = {
    id,
    critical,
    calls: 0,
    fetch: () => {
      source.calls++;
      return Promise.resolve(answer);
    },
  };
  return source;
}

describe("USDA in the lookup chain", () => {
  const NOW = Date.parse("2026-10-17T05:00:00Z");

  test("an OFF hit never reaches USDA; an OFF miss falls through to it", async () => {
    const product = parseUsdaFood(COOKIE, "0044000032029")!;
    await client.execute(`DELETE FROM barcode_product`);
    const off = counting("off", product, true);
    const usda = counting("usda", product, false);
    await lookupBarcode(db, "0044000032029", [off, usda], NOW);
    expect(usda.calls).toBe(0);

    await client.execute(`DELETE FROM barcode_product`);
    const offMiss = counting("off", null, true);
    const result = await lookupBarcode(db, "0044000032029", [offMiss, usda], NOW);
    expect(result).toMatchObject({ status: "found", source: "usda", per100: { kcal: 471 } });
  });

  test("each source's miss is cached on its own; enabling USDA later asks only USDA about an old OFF miss", async () => {
    await client.execute(`DELETE FROM barcode_product`);
    const off = counting("off", null, true);
    await lookupBarcode(db, "8996001600146", [off], NOW);
    const usda = counting("usda", null, false);
    await lookupBarcode(db, "8996001600146", [off, usda], NOW + 1000);
    expect([off.calls, usda.calls]).toEqual([1, 1]);
    const row = await client.execute(`select sources_checked from barcode_product where code = '8996001600146'`);
    expect(row.rows[0]!.sources_checked).toBe("off,usda");
    await lookupBarcode(db, "8996001600146", [off, usda], NOW + 2000);
    expect([off.calls, usda.calls]).toEqual([1, 1]);
  });

  test("a USDA outage (rate limit) is skipped, not cached, and does not fail the lookup", async () => {
    await client.execute(`DELETE FROM barcode_product`);
    const off = counting("off", null, true);
    const limited = usdaSource("k");
    const real = limited.fetch;
    let calls = 0;
    limited.fetch = (code) => {
      calls++;
      return calls === 1 ? fetchUsdaProduct(code, "k", reply(429, {})) : real(code);
    };
    expect(await lookupBarcode(db, "8996001600146", [off, limited], NOW)).toEqual({
      status: "not_found",
      code: "8996001600146",
    });
    const row = await client.execute(`select sources_checked from barcode_product where code = '8996001600146'`);
    expect(row.rows[0]!.sources_checked).toBe("off");
  });
});
