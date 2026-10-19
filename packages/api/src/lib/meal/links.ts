// Links out of the meal plan: find a dish nearby, order it in a delivery app, or find a market for the shopping list.
// Pure and shared by the web and native clients. Every link is a plain https URL, so a phone opens the matching app
// when it is installed (Android App Links, iOS Universal Links) and no client needs a custom-scheme allow-list.
//
// Sources (checked 2026-10):
//  * Google Maps: official "Maps URLs" search action, https://developers.google.com/maps/documentation/urls/get-started
//    (`https://www.google.com/maps/search/?api=1&query=<url-encoded>`, no API key; without a location in the query Maps
//    searches near the user).
//  * GrabFood: UNOFFICIAL. `https://food.grab.com/id/id/restaurants?search=<q>` is the search page of GrabFood web (its page
//    title echoes the query). food.grab.com is a registered app-link domain of the Grab app (assetlinks.json lists
//    com.grabtaxi.passenger; the iOS AASA lists `/*/*/restaurants`), so a phone with Grab opens it there. Grab documents no
//    search parameter; the web page needs the person's location, and whether the app honours `search` is not documented.
//  * GoFood: UNOFFICIAL. `https://gofood.co.id/id/search?query=<q>` is GoFood web's search page (checked 2026-10-19: the
//    page echoes the query). gofood.co.id is a registered app-link domain of the Gojek app (assetlinks.json lists
//    com.gojek.app), so a phone with Gojek may open the app instead; whether the app honours `query` is not documented,
//    so the dish name is still copied for the search box.
//  * ShopeeFood: lives inside the Shopee app. `https://shopee.co.id/m/shopeefood` is Shopee's ShopeeFood landing page;
//    shopee.co.id is a registered app-link domain of the Shopee app (assetlinks.json com.shopee.id; AASA `*`). No search URL is
//    documented, so the dish name is copied too.

export type BuyApp = "maps" | "gofood" | "grabfood" | "shopeefood";

export type BuyLink = {
  app: BuyApp;
  url: string;
  /** the link cannot carry the dish name: copy it so the person can paste it in the app's search box */
  copyName: boolean;
};

export const MAX_QUERY_LENGTH = 120;

/** A search term safe for a URL: control characters out, whitespace collapsed, capped. */
export function cleanQuery(query: string): string {
  // eslint-disable-next-line no-control-regex
  return query.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH).trim();
}

const enc = (query: string): string => encodeURIComponent(cleanQuery(query));

/** Google Maps search for `query` near the person. */
export function mapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${enc(query)}`;
}

/** Places to buy the ingredients of a shopping list. */
export const SHOP_PLACE_QUERIES = { market: "pasar", supermarket: "supermarket" } as const;
export type ShopPlace = keyof typeof SHOP_PLACE_QUERIES;

export function shopPlaceUrl(place: ShopPlace): string {
  return mapsSearchUrl(SHOP_PLACE_QUERIES[place]);
}

export function goFoodSearchUrl(query: string): string {
  return `https://gofood.co.id/id/search?query=${enc(query)}`;
}
export const SHOPEEFOOD_HOME_URL = "https://shopee.co.id/m/shopeefood";

export function grabFoodSearchUrl(query: string): string {
  return `https://food.grab.com/id/id/restaurants?search=${enc(query)}`;
}

/** The four ways to get `dish` ready-made, in the order the sheet shows them. */
export function buyLinks(dish: string): BuyLink[] {
  return [
    { app: "maps", url: mapsSearchUrl(dish), copyName: false },
    { app: "gofood", url: goFoodSearchUrl(dish), copyName: true },
    { app: "grabfood", url: grabFoodSearchUrl(dish), copyName: false },
    { app: "shopeefood", url: SHOPEEFOOD_HOME_URL, copyName: true },
  ];
}
