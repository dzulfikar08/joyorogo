import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import en from "./locales/en/scan.json";
import id from "./locales/id/scan.json";
import ms from "./locales/ms/scan.json";

const root = join(import.meta.dir, "../../..");

describe("scan result copy", () => {
  test.each([
    ["en", en],
    ["id", id],
    ["ms", ms],
  ])("%s has no per-item confidence percent string", (_locale, scan) => {
    expect("confidenceShort" in scan.result.items).toBe(false);
    expect(scan.result.items.estimate.length).toBeGreaterThan(0);
  });

  test.each(["apps/web/src/routes/_auth/makan/ai.tsx", "apps/native/app/makan-ai.tsx"])(
    "%s shows the qualitative estimate cue, never the model's confidence number",
    (file) => {
      const source = readFileSync(join(root, file), "utf8");
      expect(source).not.toContain("confidenceShort");
      expect(source).not.toMatch(/item\.confidence\s*\*\s*100/);
      expect(source).toContain('t("result.items.estimate")');
    },
  );
});
