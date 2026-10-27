import { describe, expect, test } from "bun:test";

import { PRIORITY_SUPPORT, PRO_BENEFITS, PRO_BENEFIT_GROUPS } from "./pro-benefits";
import { resources } from "./resources";

const billing = resources.id.billing;
const items = billing.pro.items as Record<string, string>;

describe("Pro benefit list", () => {
  test("every group and item has Indonesian text", () => {
    for (const group of PRO_BENEFIT_GROUPS) {
      expect(billing.pro.groups[group.id].length).toBeGreaterThan(0);
    }
    for (const item of PRO_BENEFITS) {
      // `scans` carries the live cap and reads `benefits.scansUnlimited` / `benefits.scansCapped`.
      if (item === "scans") continue;
      const text = items[item] ?? items[`${item}_other`];
      expect(text?.length ?? 0).toBeGreaterThan(0);
    }
  });

  test("no item is listed twice and no text is left without an item", () => {
    expect(new Set(PRO_BENEFITS).size).toBe(PRO_BENEFITS.length);
    const texts = Object.keys(items).map((key) => key.replace(/_other$/, ""));
    expect(texts.sort()).toEqual(PRO_BENEFITS.filter((item) => item !== "scans").sort());
  });

  test("the support promise is one working day and points at the Threads profile", () => {
    expect(PRIORITY_SUPPORT.replyWorkdays).toBe(1);
    expect(PRIORITY_SUPPORT.threadsUrl).toBe(`https://www.threads.com/${PRIORITY_SUPPORT.handle}`);
  });
});
