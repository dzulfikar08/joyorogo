import { describe, expect, test } from "bun:test";

import {
  OFF_USER_AGENT,
  OffUnavailableError,
  classifyProduct,
  fetchOffProduct,
  normalizeBarcode,
  parseOffProduct,
} from "./barcode";

// Trimmed from the live OFF v2 responses (checked 2026-10-15).
const INDOMIE = {
  product_name: "Indomie Mi Goreng Original",
  brands: "Indofood, indomie",
  quantity: "85 g",
  serving_quantity: 85,
  serving_size: "85 g",
  nutriments: {
    "energy-kcal_100g": 470.588235294118,
    "energy-kj_100g": 1964.7,
    proteins_100g: 8.23529411764706,
    carbohydrates_100g: 64.7058823529412,
    fat_100g: 18.8235294117647,
    fiber_100g: 3.52941176470588,
  },
};

const TEH_PUCUK = {
  product_name: "Teh Pucuk Harum Jasmine 350 ml",
  brands: "Mayora",
  quantity: "350 ml",
  serving_quantity: "240",
  nutriments: {
    "energy-kcal_100g": 29.1666666666667,
    proteins_100g: 0,
    carbohydrates_100g: 7.5,
    fat_100g: 0,
  },
};

describe("normalizeBarcode", () => {
  test("UPC-A is zero-padded to EAN-13, the same key a scanner reports", () => {
    expect(normalizeBarcode("089686010947")).toBe("0089686010947");
    expect(normalizeBarcode("0089686010947")).toBe("0089686010947");
  });
  test("EAN-13 and EAN-8 pass through; spaces and dashes are ignored", () => {
    expect(normalizeBarcode("8996001600146")).toBe("8996001600146");
    expect(normalizeBarcode("8996 0016-00146")).toBe("8996001600146");
    expect(normalizeBarcode("96385074")).toBe("96385074");
  });
  test("zero-led GTIN-14 is trimmed to 13", () => {
    expect(normalizeBarcode("08996001600146")).toBe("8996001600146");
  });
  test("bad check digit, letters and odd lengths are rejected", () => {
    expect(normalizeBarcode("8996001600147")).toBeNull();
    expect(normalizeBarcode("89960016001A6")).toBeNull();
    expect(normalizeBarcode("12345")).toBeNull();
    expect(normalizeBarcode("")).toBeNull();
  });
});

describe("parseOffProduct + classifyProduct", () => {
  test("maps per 100 g and derives the serving from it", () => {
    const parsed = parseOffProduct(INDOMIE)!;
    expect(parsed.brand).toBe("Indofood");
    expect(parsed.unit).toBe("g");
    const result = classifyProduct("0089686010947", parsed);
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.missing).toEqual([]);
    expect(result.per100.kcal).toBeCloseTo(470.59, 1);
    expect(result.perServing).toMatchObject({ grams: 85, kcal: 400, protein: 7, carbs: 55, fat: 16 });
  });

  test("drinks are ml, string serving is parsed, absent nutrients stay unknown", () => {
    const parsed = parseOffProduct(TEH_PUCUK)!;
    expect(parsed.unit).toBe("ml");
    expect(parsed.servingSize).toBe(240);
    const result = classifyProduct("8996001600146", parsed);
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.missing).toEqual(["fiber"]);
    expect(result.perServing?.kcal).toBe(70);
    expect(result.perServing?.fiber).toBeNull();
  });

  test("kcal falls back to kJ / 4.184", () => {
    const parsed = parseOffProduct({
      product_name: "X",
      nutriments: { "energy-kj_100g": 418.4 },
    })!;
    expect(parsed.kcal100).toBeCloseTo(100, 5);
  });

  test("no calories is incomplete, never zero", () => {
    const parsed = parseOffProduct({ product_name: "Aqua Botol 600 ml", nutriments: {} })!;
    expect(parsed.kcal100).toBeNull();
    expect(classifyProduct("8886008101053", parsed).status).toBe("incomplete");
  });

  test("impossible numbers are incomplete", () => {
    const highKcal = parseOffProduct({
      product_name: "X",
      nutriments: { "energy-kcal_100g": 4700 },
    })!;
    expect(classifyProduct("1", highKcal).status).toBe("incomplete");
    const bigMacros = parseOffProduct({
      product_name: "X",
      nutriments: { "energy-kcal_100g": 300, proteins_100g: 60, carbohydrates_100g: 60, fat_100g: 20 },
    })!;
    expect(classifyProduct("1", bigMacros).status).toBe("incomplete");
  });

  test("nameless products are dropped", () => {
    expect(parseOffProduct({ nutriments: { "energy-kcal_100g": 100 } })).toBeNull();
    expect(parseOffProduct(null)).toBeNull();
  });
});

describe("fetchOffProduct", () => {
  const reply = (status: number, body: unknown) =>
    (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as unknown as typeof fetch;

  test("sends the OFF-style User-Agent", async () => {
    let seen: Headers | undefined;
    const fake = ((_: string, init?: RequestInit) => {
      seen = new Headers(init?.headers);
      return Promise.resolve(new Response(JSON.stringify({ status: 1, product: INDOMIE })));
    }) as unknown as typeof fetch;
    const product = await fetchOffProduct("0089686010947", fake);
    expect(product?.name).toBe("Indomie Mi Goreng Original");
    expect(seen?.get("user-agent")).toBe(OFF_USER_AGENT);
  });

  test("404 and status 0 are a miss", async () => {
    expect(await fetchOffProduct("1", reply(404, { status: 0 }))).toBeNull();
    expect(await fetchOffProduct("1", reply(200, { status: 0 }))).toBeNull();
  });

  test("429, 5xx and network failure are outages, not misses", async () => {
    await expect(fetchOffProduct("1", reply(429, {}))).rejects.toBeInstanceOf(OffUnavailableError);
    await expect(fetchOffProduct("1", reply(503, {}))).rejects.toBeInstanceOf(OffUnavailableError);
    const down = (() => Promise.reject(new Error("net"))) as unknown as typeof fetch;
    await expect(fetchOffProduct("1", down)).rejects.toBeInstanceOf(OffUnavailableError);
  });
});
