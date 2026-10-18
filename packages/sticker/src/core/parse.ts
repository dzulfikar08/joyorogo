import { migrate, MIGRATIONS, type Migration } from "./migrate";
import type { Issue } from "./scene";
import {
  CANVAS_WIDTH,
  DEFAULT_STORY_SAFE,
  LAYER_SCHEMAS,
  SCHEMA_VERSION,
  templateHeader,
  type Layer,
  type LayerType,
  type Template,
} from "./schema";

/**
 * Lenient parsing: a header problem or a future schema version falls back to
 * FALLBACK_TEMPLATE, a bad layer is dropped (and reported). Never throws.
 */

export type ParseResult = { template: Template; issues: Issue[]; degraded: boolean };

const MAX_DEPTH = 6;

/** A plain brand card shown when a template cannot be used at all. */
export function fallbackTemplate(): Template {
  const header = templateHeader.parse({
    schemaVersion: SCHEMA_VERSION,
    id: "fallback.brand",
    name: "Fallback brand card",
    kind: "fallback",
    style: "minimal",
    canvas: { width: CANVAS_WIDTH, height: 1920, aspect: "story" },
    safe: DEFAULT_STORY_SAFE,
    background: {
      kind: "gradient",
      angle: 180,
      stops: [
        { at: 0, color: "$bg" },
        { at: 1, color: "$bg2" },
      ],
    },
    themes: {
      dark: { colors: { bg: "#0d1f12", bg2: "#16402a", fg: "#ffffff", accent: "#7fd89b" } },
      light: { colors: { bg: "#f9f6f1", bg2: "#e8efe3", fg: "#1d1a15", accent: "#137d41" } },
    },
  });
  const layers = [
    {
      id: "name",
      type: "text",
      box: { x: 72, y: 880, w: 936, h: "auto" },
      value: "{app.name?}",
      size: 120,
      weight: 800,
      align: "center",
      onMissing: "keep",
      fallback: " ",
    },
    {
      id: "link",
      type: "text",
      box: { x: 72, y: 1040, w: 936, h: "auto" },
      value: "{app.link?}",
      size: 40,
      weight: 600,
      color: "$fgMuted",
      align: "center",
      onMissing: "keep",
      fallback: " ",
    },
  ].map((l) => LAYER_SCHEMAS.text.parse(l));
  return { ...header, layers };
}

function parseLayers(
  raw: unknown,
  issues: Issue[],
  seen: Set<string>,
  budget: { left: number },
  depth: number,
): Layer[] {
  if (!Array.isArray(raw)) return [];
  const out: Layer[] = [];
  for (const item of raw) {
    const type = field(item, "type");
    const rawId = field(item, "id");
    const id = typeof rawId === "string" ? rawId : undefined;
    if (typeof type !== "string" || !Object.hasOwn(LAYER_SCHEMAS, type)) {
      issues.push({ code: "unknown-layer", message: `unknown layer type ${String(type)}`, layerId: id });
      continue;
    }
    const result = LAYER_SCHEMAS[type as LayerType].safeParse(item);
    if (!result.success) {
      const first = result.error.issues[0];
      issues.push({
        code: first?.message === "unknown icon" ? "unknown-icon" : "invalid-layer",
        message: `${first?.path.join(".") ?? ""}: ${first?.message ?? "invalid"}`,
        layerId: id,
      });
      continue;
    }
    if (budget.left <= 0) {
      issues.push({ code: "too-many-layers", message: "layer budget exhausted", layerId: id });
      continue;
    }
    budget.left--;
    // Zod output of the per-type schema is exactly one member of the Layer union.
    const layer = result.data as Layer;
    if (seen.has(layer.id)) {
      issues.push({ code: "duplicate-id", message: `duplicate layer id ${layer.id}`, layerId: layer.id });
      let n = 2;
      while (seen.has(`${layer.id}-${n}`)) n++;
      layer.id = `${layer.id}-${n}`;
    }
    seen.add(layer.id);
    if (layer.type === "group") {
      const children: unknown = field(result.data, "children");
      layer.children = depth >= MAX_DEPTH ? [] : parseLayers(children, issues, seen, budget, depth + 1);
    }
    out.push(layer);
  }
  return out;
}

function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

export function parseTemplate(
  raw: unknown,
  migrations: Record<number, Migration> = MIGRATIONS,
): ParseResult {
  try {
    const migrated = migrate(raw, migrations);
    if (migrated.status !== "ok") {
      const code =
        migrated.status === "too-new"
          ? "too-new"
          : migrated.status === "failed"
            ? "migration-failed"
            : "invalid-header";
      return degraded([{ code, message: migrated.message }]);
    }
    const header = templateHeader.safeParse(migrated.raw);
    if (!header.success) {
      const first = header.error.issues[0];
      return degraded([
        { code: "invalid-header", message: `${first?.path.join(".") ?? ""}: ${first?.message ?? "invalid"}` },
      ]);
    }
    const issues: Issue[] = [];
    const layers = parseLayers(
      migrated.raw.layers,
      issues,
      new Set(),
      { left: header.data.constraints.maxLayers },
      0,
    );
    if (layers.length === 0) {
      return degraded([...issues, { code: "no-layers", message: "no valid layers" }]);
    }
    return { template: { ...header.data, layers }, issues, degraded: false };
  } catch (error) {
    return degraded([
      { code: "invalid-header", message: error instanceof Error ? error.message : String(error) },
    ]);
  }
}

function degraded(issues: Issue[]): ParseResult {
  return { template: fallbackTemplate(), issues, degraded: true };
}
