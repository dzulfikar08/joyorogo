import { expect, test } from "bun:test";
import { Glob } from "bun";
import { join } from "node:path";

// Promise.withResolvers only exists from Safari 17.4. A call in the scan path threw on iOS 17.3 before the
// photo left the phone (no request, no ledger row), so the web app keeps to `new Promise`.
test("web code does not call Promise.withResolvers", async () => {
  const root = join(import.meta.dir, "..");
  const offenders: string[] = [];
  for await (const file of new Glob("**/*.{ts,tsx}").scan(root)) {
    if (file.endsWith(".test.ts") || file.endsWith(".gen.ts")) continue;
    if (/Promise\.withResolvers\s*[<(]/.test(await Bun.file(join(root, file)).text())) offenders.push(file);
  }
  expect(offenders).toEqual([]);
});
