// Refreshes src/core.sha256 after an intentional change to src/core.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { coreHash } from "../src/core-hash";

const hash = coreHash(join(import.meta.dir, "../src/core"));
writeFileSync(join(import.meta.dir, "../src/core.sha256"), `${hash}\n`);
console.log(hash);
