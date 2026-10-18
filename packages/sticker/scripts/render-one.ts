// Dev loop: render one template with a fixture to PNG.
// Usage: bun scripts/render-one.ts <templateId> [fixtureId] [dark|light] [svg|canvas] [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createHarness, sceneFor } from "./harness";
import { rogoTemplates } from "../src/rogo";
import { FIXTURES, PRIMARY_FIXTURE, type FixtureId } from "../src/rogo/fixtures";

const [id, fixtureArg, modeArg = "dark", painter = "svg", outArg] = process.argv.slice(2);
const { templates, issues } = rogoTemplates();
for (const entry of issues) console.warn("issues", entry.id, entry.issues);
const template = templates.find((t) => t.id === id);
if (!template) throw new Error(`unknown template ${id}; have ${templates.map((t) => t.id).join(", ")}`);
const fixture = (fixtureArg && fixtureArg in FIXTURES ? fixtureArg : PRIMARY_FIXTURE[template.kind]) as FixtureId;
const mode = modeArg === "light" ? "light" : "dark";
const out = outArg ?? "/run/media/dzul/ioswork/stickers/joyorogo/dev";
mkdirSync(out, { recursive: true });
const scene = sceneFor({ template, fixture, mode });
if (scene.issues.length) console.warn("scene issues", scene.issues);
const harness = await createHarness();
try {
  const png = painter === "canvas" ? await harness.canvasPng(scene) : await harness.svgPng(scene);
  const file = join(out, `${template.id}.${fixture}.${mode}.${painter}.png`);
  writeFileSync(file, png);
  console.log(file, scene.nodes.length, "nodes");
} finally {
  await harness.close();
}
