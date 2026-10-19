import { describe, expect, test } from "bun:test";

import { RECIPES } from "./catalog";
import { buyLinks, cleanQuery, grabFoodSearchUrl, GOFOOD_HOME_URL, mapsSearchUrl, MAX_QUERY_LENGTH, SHOPEEFOOD_HOME_URL, shopPlaceUrl } from "./links";

const query = (url: string, key: string) => new URL(url).searchParams.get(key);

describe("meal links: Google Maps search", () => {
  test("follows the Maps URLs search syntax with api=1", () => {
    expect(mapsSearchUrl("nasi goreng")).toBe("https://www.google.com/maps/search/?api=1&query=nasi%20goreng");
  });

  test("encodes Indonesian dish names and reserved characters, and decodes back to the name", () => {
    for (const name of ["Soto ayam & telur", "Pecel lele (porsi 1)", "Ayam geprek, sambal matah", "Mie ayam #1", "Gado-gado/lotek", "Tahu 100% krispi", "Es teh manis?", "Bubur ayam + cakwe", "Nasi uduk \"komplit\"", "Seblak ceker", "Sate ayam 'madura'", "Kwetiau goreng ‘seafood’ – pedas", "Mie goreng aceh"]) {
      const url = mapsSearchUrl(name);
      expect(url.startsWith("https://www.google.com/maps/search/?api=1&query=")).toBe(true);
      expect(query(url, "query")).toBe(name);
      expect(url.slice(url.indexOf("query=") + 6)).not.toMatch(/[ &?#"+,/]/);
      expect(new URL(url).searchParams.get("api")).toBe("1");
    }
  });

  test("keeps non-ASCII text intact", () => {
    expect(query(mapsSearchUrl("Rendang daging – porsi ½"), "query")).toBe("Rendang daging – porsi ½");
  });

  test("collapses whitespace, drops control characters and caps the length", () => {
    expect(cleanQuery("  nasi \n\t goreng  ")).toBe("nasi goreng");
    expect(cleanQuery("a\u0000b")).toBe("a b");
    expect(cleanQuery("x".repeat(500)).length).toBe(MAX_QUERY_LENGTH);
    expect(mapsSearchUrl("x".repeat(5000)).length).toBeLessThan(2048);
  });

  test("every catalog dish name makes a valid URL that decodes back", () => {
    for (const recipe of RECIPES) {
      const name = cleanQuery(recipe.name.id);
      expect(query(mapsSearchUrl(recipe.name.id), "query")).toBe(name);
      expect(query(grabFoodSearchUrl(recipe.name.id), "search")).toBe(name);
    }
  });
});

describe("meal links: shopping list", () => {
  test("market and supermarket searches", () => {
    expect(shopPlaceUrl("market")).toBe("https://www.google.com/maps/search/?api=1&query=pasar");
    expect(shopPlaceUrl("supermarket")).toBe("https://www.google.com/maps/search/?api=1&query=supermarket");
  });
});

describe("meal links: delivery apps", () => {
  test("GrabFood searches by dish name on its web search, encoded", () => {
    expect(grabFoodSearchUrl("nasi goreng")).toBe("https://food.grab.com/id/id/restaurants?search=nasi%20goreng");
    expect(query(grabFoodSearchUrl("Soto ayam & telur"), "search")).toBe("Soto ayam & telur");
  });

  test("buyLinks lists maps, GoFood, GrabFood, ShopeeFood in order, https only", () => {
    const links = buyLinks("Pecel lele");
    expect(links.map((l) => l.app)).toEqual(["maps", "gofood", "grabfood", "shopeefood"]);
    for (const l of links) expect(l.url.startsWith("https://")).toBe(true);
    expect(links[0]?.url).toBe(mapsSearchUrl("Pecel lele"));
  });

  test("apps without a search link open their home and ask to copy the dish name", () => {
    const byApp = Object.fromEntries(buyLinks("Pecel lele").map((l) => [l.app, l]));
    expect(byApp.gofood).toEqual({ app: "gofood", url: GOFOOD_HOME_URL, copyName: true });
    expect(byApp.shopeefood).toEqual({ app: "shopeefood", url: SHOPEEFOOD_HOME_URL, copyName: true });
    expect(byApp.maps?.copyName).toBe(false);
    expect(byApp.grabfood?.copyName).toBe(false);
  });
});
