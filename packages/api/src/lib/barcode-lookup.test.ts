import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { d1TestDb } from "@joyorogo/db/test-d1";
import { DEFAULT_DAY_ZONE } from "@joyorogo/i18n";
import { barcodeContribution, barcodeProduct } from "@joyorogo/db/schema/barcode";

import { SourceUnavailableError } from "./barcode";
import type { ProductData } from "./barcode";
import {
  FOUND_TTL_MS,
  LABEL_SOURCE,
  MAX_CONTRIBUTIONS_PER_DAY,
  MISS_TTL_MS,
  confirmationInput,
  lookupBarcode,
  recordContribution,
} from "./barcode-lookup";
import type { BarcodeSource, ContributionInput } from "./barcode-lookup";

const { client, db } = await d1TestDb();
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email) VALUES ('u1','u1','u1@t.id'),('u2','u2','u2@t.id'),('u3','u3','u3@t.id'),('spam','spam','s@t.id');
`);

const CODE = "8992775012345";
const NOW = Date.parse("2026-10-17T05:00:00Z");

beforeEach(async () => {
  await client.executeMultiple(`DELETE FROM barcode_contribution; DELETE FROM barcode_product;`);
});

const COMPLETE: ProductData = {
  name: "Chitato Sapi Panggang",
  brand: "Chitato",
  quantity: "68 g",
  servingSize: 34,
  unit: "g",
  kcal100: 530,
  protein100: 6,
  carbs100: 53,
  fat100: 32,
  fiber100: 3,
  sugar100: 3,
  imageUrl: null,
};
const NAME_ONLY: ProductData = {
  ...COMPLETE,
  kcal100: null,
  protein100: null,
  carbs100: null,
  fat100: null,
  fiber100: null,
  sugar100: null,
};

/** A source answering a fixed value (or outage) and counting how often it is asked. */
function fake(id: string, answer: ProductData | null | "down", critical = false) {
  const source: BarcodeSource & { calls: number } = {
    id,
    critical,
    calls: 0,
    fetch: () => {
      source.calls++;
      return answer === "down"
        ? Promise.reject(new SourceUnavailableError(`${id} down`))
        : Promise.resolve(answer);
    },
  };
  return source;
}

async function row(code = CODE) {
  const [found] = await db.select().from(barcodeProduct).where(eq(barcodeProduct.code, code));
  return found;
}

describe("lookup order", () => {
  test("a label_photo row wins and no source is asked", async () => {
    const off = fake("off", COMPLETE, true);
    await db.insert(barcodeProduct).values({
      code: CODE,
      status: "found",
      source: LABEL_SOURCE,
      contributors: 2,
      name: "Dari label",
      unit: "g",
      kcal100: 400,
      fetchedAt: new Date(NOW - 400 * 24 * 60 * 60 * 1000),
    });
    const result = await lookupBarcode(db, CODE, [off], NOW);
    expect(off.calls).toBe(0);
    expect(result).toMatchObject({ status: "found", source: LABEL_SOURCE, contributors: 2 });
  });

  test("sources are asked in order and the first complete product stops the chain", async () => {
    const off = fake("off", COMPLETE, true);
    const other = fake("other", COMPLETE);
    const result = await lookupBarcode(db, CODE, [off, other], NOW);
    expect(result).toMatchObject({ status: "found", source: "off" });
    expect([off.calls, other.calls]).toEqual([1, 0]);
    expect((await row())?.source).toBe("off");
  });

  test("a name without calories does not stop the chain; a later source's complete numbers win", async () => {
    const off = fake("off", NAME_ONLY, true);
    const other = fake("other", COMPLETE);
    const result = await lookupBarcode(db, CODE, [off, other], NOW);
    expect(result).toMatchObject({ status: "found", source: "other" });
    expect((await row())?.source).toBe("other");
  });

  test("when nobody has numbers the incomplete product is returned and retried after the short TTL", async () => {
    const off = fake("off", NAME_ONLY, true);
    const first = await lookupBarcode(db, CODE, [off], NOW);
    expect(first).toMatchObject({ status: "incomplete", reason: "no_kcal", source: "off" });
    await lookupBarcode(db, CODE, [off], NOW + MISS_TTL_MS - 1000);
    expect(off.calls).toBe(1);
    await lookupBarcode(db, CODE, [off], NOW + MISS_TTL_MS + 1000);
    expect(off.calls).toBe(2);
  });

  test("complete products are cached for the long TTL", async () => {
    const off = fake("off", COMPLETE, true);
    await lookupBarcode(db, CODE, [off], NOW);
    await lookupBarcode(db, CODE, [off], NOW + FOUND_TTL_MS - 1000);
    expect(off.calls).toBe(1);
    await lookupBarcode(db, CODE, [off], NOW + FOUND_TTL_MS + 1000);
    expect(off.calls).toBe(2);
  });
});

describe("misses are cached per source", () => {
  test("every source says no: one miss row listing them, nobody asked again until the TTL", async () => {
    const off = fake("off", null, true);
    const other = fake("other", null);
    expect(await lookupBarcode(db, CODE, [off, other], NOW)).toEqual({ status: "not_found", code: CODE });
    expect((await row())?.sourcesChecked).toBe("off,other");
    await lookupBarcode(db, CODE, [off, other], NOW + 1000);
    expect([off.calls, other.calls]).toEqual([1, 1]);
    await lookupBarcode(db, CODE, [off, other], NOW + MISS_TTL_MS + 1000);
    expect([off.calls, other.calls]).toEqual([2, 2]);
  });

  test("a source added later is asked alone about a fresh miss", async () => {
    const off = fake("off", null, true);
    await lookupBarcode(db, CODE, [off], NOW);
    const added = fake("added", COMPLETE);
    const result = await lookupBarcode(db, CODE, [off, added], NOW + 1000);
    expect(off.calls).toBe(1);
    expect(added.calls).toBe(1);
    expect(result).toMatchObject({ status: "found", source: "added" });
  });

  test("misses written before sources were tracked count as an Open Food Facts miss", async () => {
    await db.insert(barcodeProduct).values({ code: CODE, status: "not_found", fetchedAt: new Date(NOW) });
    const off = fake("off", COMPLETE, true);
    expect(await lookupBarcode(db, CODE, [off], NOW + 1000)).toEqual({ status: "not_found", code: CODE });
    expect(off.calls).toBe(0);
  });
});

describe("outages", () => {
  test("a critical source down with nobody else answering throws and caches nothing", async () => {
    const off = fake("off", "down", true);
    await expect(lookupBarcode(db, CODE, [off], NOW)).rejects.toBeInstanceOf(SourceUnavailableError);
    expect(await row()).toBeUndefined();
  });

  test("a critical outage still records who did answer, and asks only the missing source next time", async () => {
    const off = fake("off", "down", true);
    const other = fake("other", null);
    await expect(lookupBarcode(db, CODE, [off, other], NOW)).rejects.toBeInstanceOf(SourceUnavailableError);
    expect((await row())?.sourcesChecked).toBe("other");
    const back = fake("off", null, true);
    await lookupBarcode(db, CODE, [back, other], NOW + 1000);
    expect([back.calls, other.calls]).toEqual([1, 1]);
  });

  test("an optional source down is skipped and asked again next time, never cached as a miss", async () => {
    const off = fake("off", null, true);
    const flaky = fake("flaky", "down");
    expect(await lookupBarcode(db, CODE, [off, flaky], NOW)).toEqual({ status: "not_found", code: CODE });
    expect((await row())?.sourcesChecked).toBe("off");
    await lookupBarcode(db, CODE, [off, flaky], NOW + 1000);
    expect([off.calls, flaky.calls]).toEqual([1, 2]);
  });

  test("an optional source down does not hide another source's product", async () => {
    const flaky = fake("flaky", "down");
    const off = fake("off", COMPLETE, true);
    expect(await lookupBarcode(db, CODE, [flaky, off], NOW)).toMatchObject({ status: "found", source: "off" });
  });

  test("a stale product is served when the source is down, and kept when no source confirms it", async () => {
    const off = fake("off", COMPLETE, true);
    await lookupBarcode(db, CODE, [off], NOW);
    const later = NOW + FOUND_TTL_MS + 1000;
    const down = fake("off", "down", true);
    expect(await lookupBarcode(db, CODE, [down], later)).toMatchObject({ status: "found", source: "off" });
    const gone = fake("off", null, true);
    expect(await lookupBarcode(db, CODE, [gone], later)).toMatchObject({ status: "found", source: "off" });
    expect((await row())?.status).toBe("found");
    expect((await row())?.fetchedAt.getTime()).toBe(later);
  });
});

const SERVING_LABEL: ContributionInput = {
  name: "Chitato Sapi Panggang",
  brand: "Chitato",
  quantity: "68 g",
  servingSize: 34,
  unit: "g",
  basis: "serving",
  nutrients: { kcal: 180, protein: 2, carbs: 18, fat: 11, fiber: 1, sugar: 1 },
};

describe("label contributions", () => {
  test("a per-serving label is stored per 100, shared at once, and outranks the sources", async () => {
    const result = await recordContribution(db, "u1", DEFAULT_DAY_ZONE, CODE, SERVING_LABEL, NOW);
    expect(result).toMatchObject({ ok: true, outcome: "saved", contributors: 1 });
    expect(await row()).toMatchObject({
      status: "found",
      source: LABEL_SOURCE,
      contributors: 1,
      kcal100: 529.4,
      protein100: 5.9,
      carbs100: 52.9,
      fat100: 32.4,
      servingSize: 34,
      imageUrl: null,
    });
    const off = fake("off", COMPLETE, true);
    const looked = await lookupBarcode(db, CODE, [off], NOW + 1000);
    expect(off.calls).toBe(0);
    expect(looked).toMatchObject({ status: "found", source: LABEL_SOURCE, sugar100: 2.9 });
    if (looked.status === "found") expect(looked.perServing?.kcal).toBe(180);
  });

  test("per-100 labels pass through and need no serving size", async () => {
    const result = await recordContribution(
      db,
      "u1",
      DEFAULT_DAY_ZONE,
      CODE,
      { ...SERVING_LABEL, servingSize: null, basis: "per100", nutrients: { kcal: 520, protein: 7, carbs: 60, fat: 27, fiber: null, sugar: null } },
      NOW,
    );
    expect(result).toMatchObject({ ok: true });
    expect(await row()).toMatchObject({ kcal100: 520, fiber100: null });
  });

  test("implausible, mismatched, unconvertible and rude submissions are refused and nothing is stored", async () => {
    const bad = (over: Partial<ContributionInput>) => recordContribution(db, "u1", DEFAULT_DAY_ZONE, CODE, { ...SERVING_LABEL, ...over }, NOW);
    expect(await bad({ nutrients: { ...SERVING_LABEL.nutrients, kcal: 400 } })).toEqual({ ok: false, reason: "implausible" });
    expect(await bad({ nutrients: { ...SERVING_LABEL.nutrients, kcal: 40 } })).toEqual({ ok: false, reason: "energy_mismatch" });
    expect(await bad({ servingSize: null })).toEqual({ ok: false, reason: "serving_required" });
    expect(await bad({ name: "beli di www.toko.com" })).toEqual({ ok: false, reason: "name_invalid" });
    expect(await bad({ name: " " })).toEqual({ ok: false, reason: "name_invalid" });
    expect(await row()).toBeUndefined();
  });

  test("an energy mismatch the user explicitly confirms is stored; an implausible one never is", async () => {
    const unusual = { ...SERVING_LABEL, nutrients: { ...SERVING_LABEL.nutrients, kcal: 40 } };
    expect(await recordContribution(db, "u1", DEFAULT_DAY_ZONE, CODE, { ...unusual, confirmEnergyMismatch: true }, NOW)).toMatchObject({ ok: true });
    const absurd = { ...SERVING_LABEL, nutrients: { ...SERVING_LABEL.nutrients, kcal: 400 }, confirmEnergyMismatch: true };
    expect(await recordContribution(db, "u2", DEFAULT_DAY_ZONE, CODE, absurd, NOW)).toEqual({ ok: false, reason: "implausible" });
  });

  test("a product a source already knows completely is not overwritten; an incomplete one is", async () => {
    await lookupBarcode(db, CODE, [fake("off", COMPLETE, true)], NOW);
    expect(await recordContribution(db, "u1", DEFAULT_DAY_ZONE, CODE, SERVING_LABEL, NOW)).toEqual({ ok: false, reason: "already_known" });
    await client.execute(`DELETE FROM barcode_product`);
    await lookupBarcode(db, CODE, [fake("off", NAME_ONLY, true)], NOW);
    expect(await recordContribution(db, "u1", DEFAULT_DAY_ZONE, CODE, SERVING_LABEL, NOW)).toMatchObject({ ok: true, outcome: "saved" });
    expect((await row())?.source).toBe(LABEL_SOURCE);
  });

  test("a second user's agreeing label confirms it", async () => {
    await recordContribution(db, "u1", DEFAULT_DAY_ZONE, CODE, SERVING_LABEL, NOW);
    const second = await recordContribution(db, "u2", DEFAULT_DAY_ZONE, CODE, { ...SERVING_LABEL, nutrients: { ...SERVING_LABEL.nutrients, kcal: 182 } }, NOW + 1000);
    expect(second).toMatchObject({ ok: true, outcome: "confirmed", contributors: 2 });
    expect((await row())?.contributors).toBe(2);
  });

  test("a second user who disagrees overrides, a third settles it, an outvoted reading is kept but not shown", async () => {
    await recordContribution(db, "u1", DEFAULT_DAY_ZONE, CODE, SERVING_LABEL, NOW);
    const other = { ...SERVING_LABEL, nutrients: { kcal: 90, protein: 1, carbs: 12, fat: 4, fiber: 0, sugar: 2 } };
    const overridden = await recordContribution(db, "u2", DEFAULT_DAY_ZONE, CODE, other, NOW + 1000);
    expect(overridden).toMatchObject({ ok: true, outcome: "saved", contributors: 1 });
    expect((await row())?.kcal100).toBeCloseTo(264.7, 1);
    const third = await recordContribution(db, "u3", DEFAULT_DAY_ZONE, CODE, SERVING_LABEL, NOW + 2000);
    expect(third).toMatchObject({ ok: true, outcome: "confirmed", contributors: 2 });
    expect((await row())?.kcal100).toBe(529.4);
    const again = await recordContribution(db, "u2", DEFAULT_DAY_ZONE, CODE, other, NOW + 3000);
    expect(again).toMatchObject({ ok: true, outcome: "outvoted", contributors: 2 });
    expect((await row())?.kcal100).toBe(529.4);
    expect(await db.select().from(barcodeContribution).where(eq(barcodeContribution.code, CODE))).toHaveLength(3);
  });

  test("a user resubmitting corrects their own reading instead of confirming themselves", async () => {
    await recordContribution(db, "u1", DEFAULT_DAY_ZONE, CODE, SERVING_LABEL, NOW);
    const fixed = await recordContribution(db, "u1", DEFAULT_DAY_ZONE, CODE, { ...SERVING_LABEL, nutrients: { ...SERVING_LABEL.nutrients, kcal: 160 } }, NOW + 1000);
    expect(fixed).toMatchObject({ ok: true, outcome: "saved", contributors: 1 });
    expect((await row())?.kcal100).toBeCloseTo(470.6, 1);
    expect(await db.select().from(barcodeContribution)).toHaveLength(1);
  });

  test("the stored row can be confirmed as another user's own submission", async () => {
    await recordContribution(db, "u1", DEFAULT_DAY_ZONE, CODE, SERVING_LABEL, NOW);
    const input = confirmationInput((await row())!);
    expect(input).not.toBeNull();
    const confirmed = await recordContribution(db, "u2", DEFAULT_DAY_ZONE, CODE, input!, NOW + 1000);
    expect(confirmed).toMatchObject({ ok: true, outcome: "confirmed", contributors: 2 });
    expect(confirmationInput({ ...(await row())!, source: "off" })).toBeNull();
  });

  test("a user's daily contribution limit", async () => {
    for (let i = 0; i < MAX_CONTRIBUTIONS_PER_DAY; i++) {
      const code = `${8990000000000 + i}`;
      expect(await recordContribution(db, "spam", DEFAULT_DAY_ZONE, code, SERVING_LABEL, NOW)).toMatchObject({ ok: true });
    }
    expect(await recordContribution(db, "spam", DEFAULT_DAY_ZONE, CODE, SERVING_LABEL, NOW)).toEqual({ ok: false, reason: "daily_limit" });
    // Editing a product they already contributed to is not a new one.
    expect(await recordContribution(db, "spam", DEFAULT_DAY_ZONE, "8990000000000", SERVING_LABEL, NOW)).toMatchObject({ ok: true });
    // The next WIB day starts fresh.
    expect(await recordContribution(db, "spam", DEFAULT_DAY_ZONE, CODE, SERVING_LABEL, NOW + 24 * 60 * 60 * 1000)).toMatchObject({ ok: true });
  });
});
