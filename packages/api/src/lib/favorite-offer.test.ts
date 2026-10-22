import { describe, expect, test } from "bun:test";

import { OFFER_MIN_LOGS, findOffer, habitKey } from "./favorite-offer";
import type { OfferRow } from "./favorite-offer";

let seq = 0;
const row = (name: string, over: Partial<OfferRow> = {}): OfferRow => {
  seq += 1;
  return { id: `r${seq}`, name, kcal: 100, plateId: null, createdAt: 1_000 + seq, ...over };
};
const none = new Set<string>();

describe("habitKey", () => {
  test("case, punctuation and order do not matter", () => {
    expect(habitKey(["Nasi Putih", "ayam goreng!"])).toBe(habitKey(["Ayam Goreng", "nasi putih"]));
    expect(habitKey(["", "  "])).toBe("");
  });
});

describe("findOffer", () => {
  test(`a food logged ${OFFER_MIN_LOGS} times is offered, twice is not`, () => {
    const rows = [row("Putih telur", { kcal: 52 }), row("putih telur", { kcal: 52 })];
    expect(findOffer(rows, none, none)).toBeNull();
    const third = row("Putih Telur", { kcal: 104 });
    expect(findOffer([...rows, third], none, none)).toMatchObject({
      kind: "food",
      key: "putih telur",
      count: 3,
      targetId: third.id,
      kcal: 104,
      items: 1,
    });
  });

  test("rows of one plate are one log of a combo; the combo is offered as the plate", () => {
    const plate = (id: string) => [
      row("nasi putih", { plateId: id, kcal: 195 }),
      row("ayam goreng", { plateId: id, kcal: 250 }),
      row("timun", { plateId: id, kcal: 10 }),
    ];
    const rows = [...plate("p1"), ...plate("p2")];
    expect(findOffer(rows, none, none)).toBeNull();
    const offer = findOffer([...rows, ...plate("p3")], none, none);
    expect(offer).toMatchObject({ kind: "plate", targetId: "p3", count: 3, kcal: 455, items: 3 });
    expect(offer?.key).toBe("ayam goreng|nasi putih|timun");
  });

  test("a combo and its single foods are separate habits", () => {
    const rows = [
      ...[1, 2, 3].map((n) => [row("nasi putih", { plateId: `p${n}` }), row("ayam goreng", { plateId: `p${n}` })]).flat(),
      row("nasi putih"),
    ];
    expect(findOffer(rows, none, none)?.kind).toBe("plate");
  });

  test("already saved or already offered habits are skipped; the next habit comes up", () => {
    const eggs = [1, 2, 3].map(() => row("putih telur"));
    const coffee = [1, 2, 3, 4].map(() => row("americano"));
    expect(findOffer([...eggs, ...coffee], none, none)?.key).toBe("americano");
    expect(findOffer([...eggs, ...coffee], new Set(["americano"]), none)?.key).toBe("putih telur");
    expect(findOffer([...eggs, ...coffee], new Set(["americano"]), new Set(["putih telur"]))).toBeNull();
  });

  test("the most frequent habit wins; a tie goes to the newest", () => {
    const a = [1, 2, 3].map(() => row("a"));
    const b = [1, 2, 3].map(() => row("b"));
    expect(findOffer([...a, ...b], none, none)?.key).toBe("b");
  });

  test("zero kcal (water) is not worth a favorite", () => {
    expect(findOffer([1, 2, 3].map(() => row("air putih", { kcal: 0 })), none, none)).toBeNull();
  });
});
