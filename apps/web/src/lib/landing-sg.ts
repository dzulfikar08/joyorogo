// Copy for the Singapore landing (/sg), English as written in Singapore (kcal, "queue", "hawker centre"). Plain data
// on purpose: blog/pages.ts imports it at build time (FAQ structured data, no-JS fallback), so nothing here may touch
// React or the DOM. Facts mirror the Indonesian landing (routes/index.tsx) and the Malaysian one (landing-ms.ts);
// prices and quotas are never typed here, they come from /api/config (see components/landing/sg-pricing.tsx).

import { CONTACT_EMAIL, WHATSAPP_DISPLAY, WHATSAPP_MESSAGE_EN, whatsappUrl } from "./contact.ts";

/** Static FAQ: also the FAQPage structured data on /sg. Config-dependent answers live in sg-pricing.tsx. */
export const FAQ_SG = [
  {
    q: "Does JoyoRogo know hawker dishes, and where do the kcal come from?",
    a: "Yes. When you are in Singapore, the app tells the AI how to count a hawker plate: chicken rice, char kway teow, laksa, nasi lemak, roti prata, kaya toast, kopi, teh and bubble tea. The kcal is then looked up first in a dish table built from the Health Promotion Board's Singapore Food Insights Database (SG FoodID), which measures dishes as sold in Singapore, and then in TKPI 2019 (Indonesia). Not every dish is in the table and the AI can be wrong, so a result is an estimate. Before you save, you can change the portion, delete a wrong item or add one that is missing.",
  },
  {
    q: "A scan is wrong. Can I correct it?",
    a: "Yes. On the scan result, type the correction, for example \"half the rice\" or \"only 2\" for food counted per piece. The list updates and a correction can be undone. A packaged product that is not in the barcode database? Photograph its nutrition panel, the numbers are read automatically and you check them before saving.",
  },
  {
    q: "Is my photo stored?",
    a: "No. The photo is used for the analysis and then discarded. Only the food name and the numbers you confirm are kept, and you can delete all of it from the Profile page.",
  },
  {
    q: "Is it kcal or Calories?",
    a: "The same thing. The Calories on a food label and in a diet are kilocalories, written kcal. JoyoRogo writes kcal so it matches the Singapore label.",
  },
  {
    q: "Does JoyoRogo certify or label food as halal?",
    a: "No. JoyoRogo only estimates calories and nutrients. It does not check, certify or label whether a dish or product is halal. For halal status, look for the official certification at the stall or on the pack.",
  },
  {
    q: "What about privacy?",
    a: "Photos are discarded after analysis, there are no ads, and one button deletes all of your data. The privacy notice in English is at /my/privacy. It was written for the Malaysian Personal Data Protection Act 2010 and describes who runs JoyoRogo, what is collected and why, the processors that receive data, where it is processed, your rights and how to contact us. A Singapore-specific notice for the Personal Data Protection Act 2012 has not been written yet, and this page does not claim compliance with either law.",
  },
  {
    q: "Which phones work?",
    a: "Android 8 and above through the Google Play closed test: join the Google testers group first, then install from the Play Store. iPhone with iOS 16.4 and above through TestFlight (public beta), and App Store version 1.0 is waiting for Apple's review. Or open joyorogo.com in your browser and choose Add to Home Screen: JoyoRogo appears as an icon and opens full screen, with the same account and data.",
  },
  {
    q: "Is the app in English?",
    a: "Yes. The app, this page and the privacy notice are in English. The app is also available in Bahasa Indonesia and Bahasa Melayu.",
  },
  {
    q: "Is this medical advice?",
    a: "No. Calories and daily targets are estimates, not a substitute for advice from a doctor or dietitian. JoyoRogo is not suitable for anyone with a history of eating disorders, anyone under 18, or anyone who needs a diet under medical supervision.",
  },
  {
    q: "Is JoyoRogo open source?",
    a: "Yes. The code is open on GitHub under AGPL-3.0: how calories are counted, the data used, even what is kept from your photo. Spotted a mistake? Open an issue or send a fix.",
  },
] as const;

export const FEATURE_LIST_SG = [
  "Food photos analysed by AI and calories estimated",
  "Describe a meal in text",
  "Three daily numbers: what you can eat, what to burn, how long to sleep",
  "Steps, workouts and sleep from Health Connect and Apple Health",
  "Scan results can be edited before saving",
  "The original photo is not kept unless the user chooses to keep it",
] as const;

/** No-JS content for /sg (blog/pages.ts pageFallback): headings and paragraphs only. */
export const FALLBACK_SG = {
  paragraphs: [
    "JoyoRogo estimates the calories of every item on your plate from one photo, from chicken rice and char kway teow to kopi and bubble tea. You can edit the result before saving, and the photo is not stored.",
    "Every day you get three numbers: how many kcal you can eat, how many to burn, and how many hours of sleep you need.",
    "This page needs JavaScript to show the sample scan, prices and the full FAQ.",
  ],
  links: [
    { href: "/", label: "Bahasa Indonesia" },
    { href: "/my", label: "Bahasa Melayu" },
    { href: "/my/privacy", label: "Privacy notice (English)" },
    { href: "/my/terms", label: "Terms (English)" },
    { href: `mailto:${CONTACT_EMAIL}`, label: "Email" },
    { href: whatsappUrl(WHATSAPP_MESSAGE_EN), label: `WhatsApp ${WHATSAPP_DISPLAY}` },
  ],
} as const;

/** The three daily numbers, as on the other landings. The figures are the landing's own illustration. */
export const THREE_NUMBERS = [
  {
    metric: "makan",
    value: 1240,
    max: 1650,
    center: "1,650",
    unit: "kcal",
    title: "Can eat",
    body: "Your daily energy need (BMR times the activity level you pick) minus a deficit that suits your weight goal and date. Data from a watch or phone only adds to the budget, never takes from it.",
  },
  {
    metric: "bakar",
    value: 120,
    max: 300,
    center: "300",
    unit: "kcal",
    title: "To burn",
    body: "From steps and workouts. Read automatically from Health Connect on Android and Apple Health on iPhone. You can also log by hand.",
  },
  {
    metric: "tidur",
    value: 7.5,
    max: 8,
    center: "8",
    unit: "hours",
    title: "To sleep",
    body: "Your sleep target each night. Your sleep is also read from Health Connect on Android or Apple Health on iPhone.",
  },
] as const;

/** What the text story example says on the page. */
export const STORY_EXAMPLE = "had chicken rice and a kopi peng for lunch";

/** How the scan counts a Singapore plate: what the region prompt tells the AI (packages/api/src/lib/region-prompt.ts). */
export const HOW_WE_COUNT = [
  {
    dish: "Chicken rice",
    rule: "One plate is one item: the oiled rice, chicken, cucumber and chilli sauce. Steamed, roasted and soya sauce chicken are named as they look. An extra egg or vegetable is its own item.",
  },
  {
    dish: "Nasi lemak",
    rule: "Coconut rice with sambal, egg, ikan bilis and peanuts is one item. A fried chicken wing or otah beside it is its own item.",
  },
  {
    dish: "Economy rice",
    rule: "White rice is one item, and every dish and vegetable on top is its own item.",
  },
  {
    dish: "Roti prata",
    rule: "Counted per piece (plain, egg, cheese), and the curry is its own item.",
  },
  {
    dish: "Kaya toast",
    rule: "Counted per slice or per set, with the soft-boiled eggs as their own item.",
  },
  {
    dish: "Char kway teow, laksa, wanton mee",
    rule: "One plate or one bowl is one item.",
  },
  {
    dish: "Satay",
    rule: "Counted per stick, and the peanut sauce is its own item.",
  },
  {
    dish: "Kopi, teh, bubble tea",
    rule: "The condensed milk, evaporated milk and sugar are already in the drink's kcal. \"Siew dai\" means less sugar, \"kosong\" no sugar, \"peng\" iced.",
  },
] as const;

/** Privacy promises, the other landings' three. Icons are chosen in the component. */
export const PROMISES = [
  {
    key: "foto",
    title: "Photos are not kept",
    body: "A photo is analysed and discarded. It is kept only if you choose to.",
  },
  {
    key: "iklan",
    title: "No ads",
    body: "No ads and no endless feed. Log it, close it, get on with your day.",
  },
  {
    key: "padam",
    title: "Delete anytime",
    body: "One button on the Profile page deletes all of your data, permanently.",
  },
] as const;

export const ANDROID_STEPS = [
  "Join the Google group joyorogo-testers with the Google account you use on the Play Store. The group is what opens access to the closed test.",
  "Open the test page on Play, then tap Become a tester. If the page does not open yet, wait a few minutes and try again.",
  "Install JoyoRogo from the Play Store and sign in with the same Google account as on the web. Your diary comes with you.",
] as const;

export const IOS_STEPS = [
  "Install TestFlight from the App Store if it is not on your iPhone yet.",
  "Open the JoyoRogo TestFlight link on your iPhone and tap Accept.",
  "Tap Install in TestFlight, then sign in with the same account as on the web. Your diary comes with you. On iPhone, JoyoRogo reads Apple Health.",
] as const;

/** The dishes shown on the page and the names Singapore calls them. Keys are rows of the dish table. */
export const SG_DISH_LABEL: Record<string, string> = {
  "nasi ayam": "Chicken rice (steamed)",
  "nasi lemak": "Nasi lemak",
  "char kuey teow": "Char kway teow",
  laksa: "Laksa",
  "roti canai": "Plain prata",
  "roti bakar kaya": "Kaya toast",
  "hokkien mee": "Hokkien mee",
  "satay ayam": "Chicken satay",
  kopi: "Kopi",
  teh: "Teh",
  "bubble tea": "Bubble tea",
};
