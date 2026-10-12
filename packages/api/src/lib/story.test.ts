import { describe, expect, test } from "bun:test";

import {
  STORY_EMPTY_ERROR,
  STORY_FAILED_ERROR,
  VOICE_EMPTY_ERROR,
  parseFoodStory,
  storyItemsFromText,
  transcribeStory,
  type StoryContext,
} from "./story";
import type { AiRunner } from "./vision";

const CTX: StoryContext = {
  today: "2026-10-12",
  referenceDate: "2026-10-12",
  slots: ["sarapan", "makan_siang", "makan_malam", "snack"],
  nowMeal: "makan_malam",
};

const answer = (items: unknown[]) => JSON.stringify({ items });

function chatRunner(content: string): AiRunner {
  return { run: async () => ({ choices: [{ message: { content } }] }) };
}

describe("storyItemsFromText", () => {
  test("places items on the day and slot the story names", () => {
    const items = storyItemsFromText(
      answer([
        { name: "Nasi kuning", kcal: 350, meal: "sarapan", day: -1 },
        { name: "Rendang daging", kcal: 250, meal: "makan_siang", day: -1 },
        { name: "Es teh manis", kcal: 80, meal: "makan_malam", day: 0 },
      ]),
      CTX,
    );
    expect(items.map((i) => [i.name, i.meal, i.date])).toEqual([
      ["Nasi kuning", "sarapan", "2026-10-11"],
      ["Rendang daging", "makan_siang", "2026-10-11"],
      ["Es teh manis", "makan_malam", "2026-10-12"],
    ]);
  });

  test("a story without day words lands on the day being viewed", () => {
    const [item] = storyItemsFromText(
      answer([{ name: "Bakso", kcal: 400, meal: "makan_siang", day: null }]),
      {
        ...CTX,
        referenceDate: "2026-10-09",
      },
    );
    expect(item?.date).toBe("2026-10-09");
  });

  test("future days clamp to today and far-past days clamp to the window", () => {
    const items = storyItemsFromText(
      answer([
        { name: "Sate", kcal: 300, meal: "makan_malam", day: 2 },
        { name: "Soto", kcal: 300, meal: "makan_siang", day: -30 },
      ]),
      CTX,
    );
    expect(items[0]?.date).toBe("2026-10-12");
    expect(items[1]?.date).toBe("2026-10-05");
  });

  test("an unknown or inactive slot falls back to the caller's meal, then the clock", () => {
    const withDefault = storyItemsFromText(
      answer([{ name: "Kurma", kcal: 70, meal: "berbuka", day: 0 }]),
      { ...CTX, defaultMeal: "snack" },
    );
    expect(withDefault[0]?.meal).toBe("snack");
    const noDefault = storyItemsFromText(
      answer([{ name: "Kopi susu", kcal: 150, meal: "siang" }]),
      CTX,
    );
    expect(noDefault[0]?.meal).toBe("makan_malam");
  });

  test("survives mangled keys and numeric strings from the model", () => {
    const [item] = storyItemsFromText(
      answer([
        {
          name: "Udang keju",
          "kcal ": "280",
          "protein thick": 10,
          carbs: 15,
          fat: 18,
          meal: "sarapan",
          day: 0,
        },
      ]),
      CTX,
    );
    expect(item?.kcal).toBeGreaterThan(0);
    expect(item?.protein).toBe(10);
  });

  test("drops items without a name or calories, keeps the rest", () => {
    const items = storyItemsFromText(
      answer([
        { name: "", kcal: 100 },
        { name: "Air putih", kcal: 0 },
        { name: "Tempe goreng", kcal: 120, meal: "snack", day: 0 },
        "garbage",
      ]),
      CTX,
    );
    expect(items.map((i) => i.name)).toEqual(["Tempe goreng"]);
  });

  test("the same dish at two meals stays two entries", () => {
    const items = storyItemsFromText(
      answer([
        { name: "Nasi putih", kcal: 200, meal: "makan_siang", day: 0 },
        { name: "Nasi putih", kcal: 200, meal: "makan_malam", day: 0 },
      ]),
      CTX,
    );
    expect(items).toHaveLength(2);
  });
});

describe("parseFoodStory", () => {
  const NOW = new Date("2026-10-12T11:05:00Z"); // 18:05 WIB

  test("returns placed items from a chat-shaped answer", async () => {
    const result = await parseFoodStory(
      chatRunner(answer([{ name: "Mie Gacoan", kcal: 550, meal: "sarapan", day: null }])),
      { text: "mie gacoan 1 porsi", slots: CTX.slots, defaultMeal: "sarapan", now: NOW },
    );
    expect(result.items[0]).toMatchObject({
      name: "Mie Gacoan",
      meal: "sarapan",
      date: "2026-10-12",
    });
  });

  test("a story with no food is the empty error, not a failure", async () => {
    await expect(
      parseFoodStory(chatRunner('{"items":[]}'), { text: "halo", slots: CTX.slots, now: NOW }),
    ).rejects.toThrow(STORY_EMPTY_ERROR);
  });

  test("unparseable answers and transport errors are the friendly failure", async () => {
    await expect(
      parseFoodStory(chatRunner("maaf saya tidak paham"), {
        text: "x y",
        slots: CTX.slots,
        now: NOW,
      }),
    ).rejects.toThrow(STORY_FAILED_ERROR);
    const broken: AiRunner = { run: async () => Promise.reject(new Error("503")) };
    await expect(
      parseFoodStory(broken, { text: "x y", slots: CTX.slots, now: NOW }),
    ).rejects.toThrow(STORY_FAILED_ERROR);
  });

  test("a reference date in the future is ignored", async () => {
    const result = await parseFoodStory(
      chatRunner(answer([{ name: "Bubur ayam", kcal: 350, meal: "sarapan", day: null }])),
      { text: "bubur ayam", slots: CTX.slots, referenceDate: "2026-12-01", now: NOW },
    );
    expect(result.items[0]?.date).toBe("2026-10-12");
  });
});

describe("transcribeStory", () => {
  test("returns the trimmed transcript", async () => {
    const ai: AiRunner = { run: async () => ({ text: "  nasi goreng satu piring " }) };
    expect((await transcribeStory(ai, "AAAA")).text).toBe("nasi goreng satu piring");
  });

  test("silence is the voice error", async () => {
    const ai: AiRunner = { run: async () => ({ text: " " }) };
    await expect(transcribeStory(ai, "AAAA")).rejects.toThrow(VOICE_EMPTY_ERROR);
  });
});
