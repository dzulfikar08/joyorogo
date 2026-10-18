import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { coreHash } from "./core-hash";

// core/ is shared byte-for-byte with JoyoFit. After an intentional change run
// `bun scripts/core-hash.ts` to refresh core.sha256, and copy core/ + core.sha256 to the other repo.
test("core/ matches the pinned hash", () => {
  const pinned = readFileSync(join(import.meta.dir, "core.sha256"), "utf8").trim();
  expect(coreHash(join(import.meta.dir, "core"))).toBe(pinned);
});
