import { describe, expect, it } from "bun:test";

import {
  DEFAULT_HOME_CARDS,
  HOME_CARD_IDS,
  homeCardsFor,
  isDefaultHomeCards,
  moveHomeCard,
  normalizeHomeCards,
  parseHomeCards,
  serializeHomeCards,
  setHomeCardHidden,
  visibleHomeCards,
} from "./home-cards";

describe("default order", () => {
  it("lists every card once, the daily report before the secondary cards", () => {
    expect(new Set(HOME_CARD_IDS).size).toBe(HOME_CARD_IDS.length);
    const at = (id: (typeof HOME_CARD_IDS)[number]) => HOME_CARD_IDS.indexOf(id);
    for (const report of ["calorie", "stats", "meals"] as const) {
      for (const secondary of ["weight", "fasting", "mealplan", "ideas", "joyofit", "tips", "recap", "extras", "promo"] as const) {
        expect(at(report)).toBeLessThan(at(secondary));
      }
    }
  });

  it("shows everything when nothing is stored", () => {
    expect(parseHomeCards(null)).toBe(DEFAULT_HOME_CARDS);
    expect(visibleHomeCards(DEFAULT_HOME_CARDS)).toEqual([...HOME_CARD_IDS]);
    expect(isDefaultHomeCards(DEFAULT_HOME_CARDS)).toBe(true);
  });

  it("leaves out the cards a platform does not have", () => {
    expect(homeCardsFor("native")).not.toContain("waist");
    expect(homeCardsFor("web")).not.toContain("belanja");
    expect(homeCardsFor("web")).toContain("waist");
  });
});

describe("normalising what was stored", () => {
  it("keeps the chosen order and drops unknown and repeated ids", () => {
    const prefs = normalizeHomeCards(["tips", "nope", "stats", "tips", 7], ["nope", "stats", "stats"]);
    expect(prefs.order.slice(0, 2)).toEqual(["tips", "stats"]);
    expect(prefs.hidden).toEqual(["stats"]);
    expect(new Set(prefs.order).size).toBe(HOME_CARD_IDS.length);
  });

  it("puts cards a later release adds at the end, shown", () => {
    // Stored by a build that only knew three cards, with one hidden.
    const prefs = normalizeHomeCards(["meals", "calorie", "stats"], ["calorie"]);
    expect(prefs.order.slice(0, 3)).toEqual(["meals", "calorie", "stats"]);
    expect(prefs.order.slice(3)).toEqual(HOME_CARD_IDS.filter((id) => !["meals", "calorie", "stats"].includes(id)));
    expect(visibleHomeCards(prefs)).not.toContain("calorie");
    expect(visibleHomeCards(prefs)).toContain(HOME_CARD_IDS.at(-1)!);
  });

  it("treats anything that is not a list as unset", () => {
    expect(normalizeHomeCards("x", { a: 1 })).toEqual(DEFAULT_HOME_CARDS);
  });
});

describe("storage text", () => {
  it("round-trips", () => {
    const moved = moveHomeCard(setHomeCardHidden(DEFAULT_HOME_CARDS, "tips", true), "promo", -3);
    expect(parseHomeCards(serializeHomeCards(moved))).toEqual(moved);
  });

  it.each([null, undefined, "", "not json", "[1,2]", "7", "null", '{"order":5}'])("falls back to defaults for %p", (raw) => {
    expect(parseHomeCards(raw)).toEqual(DEFAULT_HOME_CARDS);
  });
});

describe("changing the arrangement", () => {
  it("hides and shows, returning the same object when nothing changes", () => {
    const hidden = setHomeCardHidden(DEFAULT_HOME_CARDS, "meals", true);
    expect(visibleHomeCards(hidden)).not.toContain("meals");
    expect(setHomeCardHidden(hidden, "meals", true)).toBe(hidden);
    expect(setHomeCardHidden(DEFAULT_HOME_CARDS, "meals", false)).toBe(DEFAULT_HOME_CARDS);
    expect(setHomeCardHidden(hidden, "meals", false).hidden).toEqual([]);
  });

  it("moves a card up and down, and stops at the ends", () => {
    const down = moveHomeCard(DEFAULT_HOME_CARDS, "calorie", 1);
    expect(down.order.slice(0, 2)).toEqual(["stats", "calorie"]);
    expect(moveHomeCard(down, "calorie", -1).order).toEqual([...HOME_CARD_IDS]);
    expect(moveHomeCard(DEFAULT_HOME_CARDS, "calorie", -1)).toBe(DEFAULT_HOME_CARDS);
    expect(moveHomeCard(DEFAULT_HOME_CARDS, "promo", 1)).toBe(DEFAULT_HOME_CARDS);
  });

  it("moves past a card the platform does not list", () => {
    const among = homeCardsFor("native");
    const up = moveHomeCard(DEFAULT_HOME_CARDS, "fasting", -1, among);
    // "waist" sits right above "fasting" but native has no waist card: fasting lands above "weight".
    expect(up.order.indexOf("fasting")).toBeLessThan(up.order.indexOf("weight"));
    expect(up.order.indexOf("fasting") + 1).toBe(up.order.indexOf("weight"));
    expect(new Set(up.order).size).toBe(HOME_CARD_IDS.length);
  });

  it("keeps hidden cards in place in the order", () => {
    const hidden = setHomeCardHidden(DEFAULT_HOME_CARDS, "stats", true);
    const moved = moveHomeCard(hidden, "calorie", 1);
    expect(moved.hidden).toEqual(["stats"]);
    expect(moved.order.slice(0, 3)).toEqual(["stats", "calorie", "meals"]);
  });

  it("recognises the default arrangement", () => {
    expect(isDefaultHomeCards(moveHomeCard(DEFAULT_HOME_CARDS, "calorie", 1))).toBe(false);
    expect(isDefaultHomeCards(setHomeCardHidden(DEFAULT_HOME_CARDS, "tips", true))).toBe(false);
  });
});
