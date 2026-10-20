import { describe, expect, test } from "bun:test";

import { caffeineMgFor, isAlcoholicDrink, isAlcoholName } from "./intake";

describe("intake", () => {
  test("caffeine by name", () => {
    expect(caffeineMgFor("Americano")).toBe(95);
    expect(caffeineMgFor("Es teh manis")).toBe(40);
    expect(caffeineMgFor("Decaf latte")).toBeNull();
    expect(caffeineMgFor("Nasi goreng")).toBeNull();
  });

  test("alcohol: brem is a drink, tape is a food", () => {
    expect(isAlcoholicDrink("Bir bintang")).toBe(true);
    expect(isAlcoholicDrink("Brem")).toBe(true);
    expect(isAlcoholicDrink("Tape ketan")).toBe(false);
    expect(isAlcoholicDrink("Tapai singkong")).toBe(false);
    expect(isAlcoholicDrink("Root beer")).toBe(false);
    expect(isAlcoholicDrink("Bir pletok")).toBe(false);
    expect(isAlcoholName("Tape ketan")).toBe(true);
  });
});
