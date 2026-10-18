import type { BrandMarks, ResolveCtx, StickerData } from "./resolve";
import { createMonoMetrics, type FontMap } from "./text";
import { parseTemplate } from "./parse";
import { resolve } from "./resolve";
import type { Scene, SceneNode } from "./scene";
import type { Template, TemplateInput } from "./schema";

/** Shared fixtures for core tests: a monospace test font (0.6 em), no real fonts needed. */

const metrics = createMonoMetrics(0.6, { asc: 0.9, desc: 0.2, cap: 0.7, xh: 0.5 });

export const TEST_FONTS: FontMap = {
  metrics: () => metrics,
  paint: (role, weight) => ({ family: `test-${role}`, weight }),
};

export const TEST_BRAND: BrandMarks = {
  name: "TestApp",
  link: "test.app",
  logo: () => ({ viewBox: [0, 0, 100, 100], items: [{ d: "M0 0L100 0L100 100Z", fill: "#ffffff" }] }),
};

export const TEST_CTX: ResolveCtx = {
  locale: "id",
  mode: "dark",
  t: (key, args) => `${key}(${Object.entries(args).map(([k, v]) => `${k}=${v}`).join(",")})`,
  fonts: TEST_FONTS,
  brand: TEST_BRAND,
};

export function makeTemplate(layers: unknown[], overrides: Partial<TemplateInput> = {}): Template {
  const result = parseTemplate({
    schemaVersion: 1,
    id: "test.template",
    name: "Test",
    kind: "test",
    style: "minimal",
    canvas: { width: 1080, height: 1080, aspect: "square" },
    background: { kind: "transparent" },
    themes: { dark: { colors: {} }, light: { colors: {} } },
    layers,
    ...overrides,
  });
  if (result.degraded) throw new Error(`test template degraded: ${JSON.stringify(result.issues)}`);
  return result.template;
}

export function sceneOf(layers: unknown[], data: StickerData = { data: {} }, overrides: Partial<TemplateInput> = {}): Scene {
  return resolve(makeTemplate(layers, overrides), data, TEST_CTX);
}

export function flat(nodes: SceneNode[]): SceneNode[] {
  return nodes.flatMap((n) => (n.k === "group" ? [n, ...flat(n.children)] : [n]));
}

export const texts = (scene: Scene) => flat(scene.nodes).flatMap((n) => (n.k === "text" ? [n] : []));
