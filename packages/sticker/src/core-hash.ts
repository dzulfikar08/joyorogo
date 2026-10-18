import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** SHA-256 over every non-test file of core/ (sorted by name), pinned in core.sha256 so both apps copy it byte-identical. */
export function coreHash(dir: string): string {
  const hash = createHash("sha256");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .sort();
  for (const file of files) {
    hash.update(`${file}\n`);
    hash.update(readFileSync(join(dir, file)));
    hash.update("\n");
  }
  return hash.digest("hex");
}
