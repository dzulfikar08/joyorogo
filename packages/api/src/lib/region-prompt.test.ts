import { describe, expect, test } from "bun:test";

import { localNameRule } from "./ai-locale";
import { storyPrompt } from "./story";
import { visionPrompt } from "./vision";

describe("region context in the scan prompts", () => {
  test("Indonesia's photo prompt carries no regional text", () => {
    expect(visionPrompt("id")).toBe(visionPrompt("id", "ID"));
    expect(visionPrompt("id")).toContain("fokus masakan Indonesia");
    expect(visionPrompt("id")).not.toContain("Malaysia");
    expect(visionPrompt("en")).toBe(visionPrompt("en", "ID"));
  });

  test("Malaysia swaps the focus and adds dish names and mamak/hawker defaults", () => {
    const prompt = visionPrompt("ms", "MY");
    expect(prompt).not.toContain("fokus masakan Indonesia");
    expect(prompt).toContain("fokus masakan Malaysia");
    for (const word of ["nasi lemak", "roti canai", "teh tarik", "mee goreng mamak", "char kuey teow", "nasi kandar", "laksa", "satay", "kuih", "milo ais"]) {
      expect(prompt).toContain(word);
    }
    expect(prompt).toContain("kedai mamak");
    expect(prompt).toContain("Malay");
  });

  test("Singapore swaps the focus and adds hawker names and defaults", () => {
    const prompt = visionPrompt("en", "SG");
    expect(prompt).not.toContain("fokus masakan Indonesia");
    expect(prompt).not.toContain("fokus masakan Malaysia");
    expect(prompt).toContain("fokus masakan Singapura");
    for (const word of ["chicken rice", "char kway teow", "laksa", "nasi lemak", "roti prata", "kaya toast", "kopi", "teh", "bubble tea", "hawker centre"]) {
      expect(prompt).toContain(word);
    }
    expect(prompt).toContain("jangan memberi label halal atau haram");
  });

  test("the Singapore story prompt follows the same rule", () => {
    const base = { text: "had chicken rice", today: "2026-10-21", clock: "08.00", slots: ["sarapan"] as const };
    expect(storyPrompt({ ...base, region: "SG", locale: "en" })).toContain("Konteks Singapura");
    expect(storyPrompt({ ...base, region: "SG", locale: "en" })).not.toContain("Konteks Malaysia");
  });

  test("the prompt never asks the model for a halal verdict", () => {
    const prompt = visionPrompt("ms", "MY");
    expect(prompt).toContain("jangan memberi label halal atau haram");
  });

  test("the story prompt follows the same rule", () => {
    const base = { text: "tadi makan nasi lemak", today: "2026-10-21", clock: "08.00", slots: ["sarapan"] as const };
    expect(storyPrompt(base)).not.toContain("Malaysia");
    expect(storyPrompt({ ...base, region: "MY", locale: "ms" })).toContain("Konteks Malaysia");
  });

  test("the Malay output rule names Malay, with Malay examples", () => {
    const rule = localNameRule("ms");
    expect(rule).toContain("Malay");
    expect(rule).toContain("Teh ais manis");
    expect(rule).not.toContain("Iced sweet tea");
  });
});
