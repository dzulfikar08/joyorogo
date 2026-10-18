import { afterEach, describe, expect, test } from "bun:test";

import { matchLocale, setActiveLocale } from "@joyorogo/i18n";

import { MEAL_LABELS, mealLabel, relativeDayLabel, storySlotLabel } from "./engine";
import { dayReminders } from "./fasting";
import { serverT } from "./messages";
import { storyItemsFromText, storyPrompt } from "./story";
import { correctionPrompt } from "./scan-correct";
import { DRINK_RULE, VISION_PROMPT, parseAnswer, visionPrompt } from "./vision";

afterEach(() => setActiveLocale("id"));

describe("server messages", () => {
  test("errors follow the requested locale, with plurals", () => {
    expect(serverT("id", "errors")("profile.onboardingRequired")).toBe(
      "Lengkapi onboarding dulu ya.",
    );
    expect(serverT("en", "errors")("profile.onboardingRequired")).toBe(
      "Please finish setting up your profile first.",
    );
    expect(serverT("en", "errors")("ai.retriesExhausted", { count: 1 })).toContain(
      "1 recalculation",
    );
    expect(serverT("en", "errors")("ai.retriesExhausted", { count: 2 })).toContain("all 2");
    expect(serverT("id", "errors")("ai.retriesExhausted", { count: 2 })).toBe(
      "Batas hitung ulang foto ini habis (2 kali). Foto ulang saja ya.",
    );
  });

  test("two locales never leak into each other", () => {
    const id = serverT("id", "errors");
    const en = serverT("en", "errors");
    expect(id("ai.unavailable")).toContain("Layanan AI");
    expect(en("ai.unavailable")).toContain("AI service");
    expect(id("ai.unavailable")).toContain("Layanan AI");
  });
});

describe("label tables follow the active language", () => {
  test("meal labels and day labels", () => {
    expect(MEAL_LABELS.makan_siang).toBe("Makan Siang");
    setActiveLocale("en");
    expect(MEAL_LABELS.makan_siang).toBe("Lunch");
    expect(relativeDayLabel("2026-10-17", "2026-10-17")).toBe("Today");
    expect(storySlotLabel("2026-10-16", "sarapan", "2026-10-17")).toBe("Yesterday · Breakfast");
  });

  test("an explicit locale wins over the active one (server)", () => {
    setActiveLocale("id");
    expect(mealLabel("berbuka", "en")).toBe("Iftar");
    expect(mealLabel("berbuka", "id")).toBe("Berbuka");
  });
});

describe("fasting reminders", () => {
  const input = {
    pattern: "16:8",
    windowStart: "12:00",
    dateKey: "2026-10-13",
    remainingKcal: 1450,
  } as const;

  test("default is Indonesian", () => {
    expect(dayReminders(input)[0]).toMatchObject({
      title: "Jendela makan buka",
      body: "Saatnya makan pertama. Sisa 1.450 kcal untuk hari ini.",
    });
  });

  test("English is written for the recipient", () => {
    const drafts = dayReminders({ ...input, locale: "en" });
    expect(drafts[0]).toMatchObject({
      title: "Your eating window is open",
      body: "Time for your first meal. 1,450 kcal left for today.",
    });
    expect(drafts.at(-1)!.title).toBe("Time for your last meal");
    expect(drafts.at(-1)!.body).toContain("closes in 30 minutes");
  });
});

describe("AI output language", () => {
  test("Indonesian prompt is unchanged and asks for no localName", () => {
    expect(visionPrompt("id")).toBe(VISION_PROMPT);
    expect(VISION_PROMPT).not.toContain("localName");
  });

  test("English prompt adds localName, keeps the Indonesian name for TKPI", () => {
    const prompt = visionPrompt("en");
    expect(prompt).toContain('"localName":"name in English"');
    expect(prompt).toContain("database gizi");
    expect(
      storyPrompt({
        text: "x",
        today: "2026-10-17",
        clock: "08:00",
        slots: ["sarapan"],
        locale: "en",
      }),
    ).toContain('"localName"');
  });

  // Prod 2026-10-18: scans sent with x-locale en came back as "Corn rice" /
  // "Fried tempeh" while the owner's saved language is id. The name language is
  // decided by this instruction alone, so both prompts must carry theirs.
  describe("every AI prompt states its output language", () => {
    const story = (locale: "id" | "en") =>
      storyPrompt({ text: "x", today: "2026-10-17", clock: "08:00", slots: ["sarapan"], locale });
    const correction = (locale: "id" | "en") =>
      correctionPrompt([{ name: "nasi putih", kcal: 195 }], "bukan nasi", locale);

    test("id: names stay Indonesian, no English instruction, no localName", () => {
      for (const prompt of [visionPrompt("id"), story("id"), correction("id")]) {
        expect(prompt).toContain("Bahasa Indonesia");
        expect(prompt).not.toContain("localName");
        expect(prompt).not.toContain("User language");
        expect(prompt).not.toContain("English");
      }
      expect(visionPrompt("id")).toContain("name dalam Bahasa Indonesia tanpa terjemahan");
    });

    test("en: asks for an English localName and portion, name stays Indonesian", () => {
      for (const prompt of [visionPrompt("en"), story("en"), correction("en")]) {
        expect(prompt).toContain("User language: English");
        expect(prompt).toContain('"localName"');
        expect(prompt).toContain('"portion" juga dalam English');
      }
    });

    test("the drink rule does not touch the language rule in either locale", () => {
      for (const locale of ["id", "en"] as const) {
        const prompt = visionPrompt(locale);
        expect(prompt).toContain(DRINK_RULE);
        expect(prompt).toContain("name dalam Bahasa Indonesia tanpa terjemahan");
      }
      expect(DRINK_RULE).not.toMatch(/English|inggris|translate|terjemah/i);
    });

    test("the locale a request carries is the one that picks the prompt", () => {
      expect(matchLocale("en")).toBe("en");
      expect(matchLocale("en-US")).toBe("en");
      expect(matchLocale("id")).toBe("id");
      expect(matchLocale("in")).toBe("id");
      // No header (clients before i18n) is Indonesian, never English.
      expect(matchLocale(undefined) ?? "id").toBe("id");
    });
  });

  const answer = JSON.stringify({
    items: [
      {
        name: "nasi goreng",
        localName: "Fried rice",
        kind: "makanan",
        portion: "1 plate",
        grams: 250,
        kcal: 420,
        protein: 10,
        carbs: 60,
        fat: 12,
        confidence: 0.8,
      },
    ],
  });

  test("scan: matching uses the Indonesian name, the user sees theirs", () => {
    const en = parseAnswer(answer, "stop", "en").items[0]!;
    expect(en.name).toBe("Fried rice");
    expect(en.matched).toBe(true);
    const id = parseAnswer(answer, "stop").items[0]!;
    expect(id.name).toBe("nasi goreng");
    expect(id.matched).toBe(true);
  });

  test("scan: a missing localName falls back to the Indonesian name", () => {
    const text = answer.replace('"localName":"Fried rice",', "");
    expect(parseAnswer(text, "stop", "en").items[0]!.name).toBe("nasi goreng");
  });

  test("story: same swap", () => {
    const text = JSON.stringify({
      items: [{ name: "Nasi goreng", localName: "Fried rice", kcal: 400, meal: "sarapan", day: 0 }],
    });
    const ctx = {
      today: "2026-10-17",
      referenceDate: "2026-10-17",
      slots: ["sarapan"] as const,
      nowMeal: "sarapan" as const,
    };
    expect(storyItemsFromText(text, { ...ctx, locale: "en" })[0]!.name).toBe("Fried rice");
    expect(storyItemsFromText(text, ctx)[0]!.name).toBe("Nasi goreng");
  });
});
