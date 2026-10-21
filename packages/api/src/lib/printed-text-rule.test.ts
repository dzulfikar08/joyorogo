import { describe, expect, test } from "bun:test";
import { PRINTED_TEXT_RULE, visionPrompt } from "./vision";

describe("printed-text rule", () => {
  test("every scan prompt tells the model to trust printed text over appearance", () => {
    expect(visionPrompt()).toContain(PRINTED_TEXT_RULE);
    expect(visionPrompt("en")).toContain(PRINTED_TEXT_RULE);
    expect(PRINTED_TEXT_RULE).toContain("Americano ICE");
    expect(PRINTED_TEXT_RULE).toContain("NASI KEBULI");
    expect(PRINTED_TEXT_RULE).toContain("Tempe vs tahu");
  });
});
