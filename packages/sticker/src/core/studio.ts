import { cloneJson } from "./migrate";
import { LAYER_SCHEMAS, SCHEMA_VERSION, templateHeader, type Background, type Layer, type Template } from "./schema";

/**
 * Sticker Studio data model. There is no editor UI yet; this is what it will edit:
 * user templates, pure editor ops and an undo history. Every op re-validates the
 * layer it touched, so an invalid edit is rejected and the old template kept.
 */

export type SyncState = "local" | "cloud-pending" | "cloud";

export type UserTemplate = {
  id: string;
  schemaVersion: number;
  name: string;
  baseId?: string;
  kind: string;
  template: Template;
  createdAt: number;
  updatedAt: number;
  sync: SyncState;
};

export type TemplateStore = {
  list(): Promise<UserTemplate[]>;
  get(id: string): Promise<UserTemplate | undefined>;
  put(template: UserTemplate): Promise<void>;
  remove(id: string): Promise<void>;
};

export function createUserTemplate(
  base: Template,
  name: string,
  now: number,
  randomId: () => string,
): UserTemplate {
  const id = `u-${randomId()}`;
  return {
    id,
    schemaVersion: SCHEMA_VERSION,
    name,
    baseId: base.id,
    kind: base.kind,
    template: { ...cloneJson(base), id, name },
    createdAt: now,
    updatedAt: now,
    sync: "local",
  };
}

export type Op =
  | { op: "addLayer"; layer: unknown; parentId?: string; index?: number }
  | { op: "removeLayer"; id: string }
  | { op: "moveLayer"; id: string; x: number; y: number }
  | { op: "resizeLayer"; id: string; w: number | "auto" | "fill"; h: number | "auto" | "fill" }
  | { op: "reorderLayer"; id: string; index: number }
  | { op: "rebind"; id: string; field: string; value: unknown }
  | { op: "restyle"; id: string; patch: Record<string, unknown> }
  | { op: "setBackground"; background: unknown }
  | { op: "setTheme"; mode: "dark" | "light"; colors: Record<string, string> }
  | { op: "setCanvas"; height: number; aspect: Template["canvas"]["aspect"] };

export type OpResult = { ok: true; template: Template } | { ok: false; reason: string };

type Located = { siblings: Layer[]; index: number; layer: Layer };

function locate(layers: Layer[], id: string): Located | null {
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]!;
    if (layer.id === id) return { siblings: layers, index: i, layer };
    if (layer.type === "group") {
      const hit = locate(layer.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

function allIds(layers: Layer[], out: Set<string> = new Set()): Set<string> {
  for (const layer of layers) {
    out.add(layer.id);
    if (layer.type === "group") allIds(layer.children, out);
  }
  return out;
}

/** Re-validates one layer (children of a group are kept as they are). */
function revalidate(layer: Layer): Layer | string {
  const schema = LAYER_SCHEMAS[layer.type];
  const input = layer.type === "group" ? { ...layer, children: [] } : layer;
  const result = schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    return `${first?.path.join(".") ?? ""}: ${first?.message ?? "invalid"}`;
  }
  const next = result.data as Layer;
  if (next.type === "group" && layer.type === "group") next.children = layer.children;
  return next;
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function applyOp(current: Template, op: Op): OpResult {
  const template = cloneJson(current);
  const fail = (reason: string): OpResult => ({ ok: false, reason });
  switch (op.op) {
    case "addLayer": {
      if (op.layer === null || typeof op.layer !== "object" || !("type" in op.layer)) return fail("unknown layer type");
      const type = op.layer.type;
      if (typeof type !== "string" || !Object.hasOwn(LAYER_SCHEMAS, type)) return fail("unknown layer type");
      const parsed = LAYER_SCHEMAS[type as Layer["type"]].safeParse({ ...op.layer, children: [] });
      if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid layer");
      const layer = parsed.data as Layer;
      if (layer.type === "group") layer.children = [];
      const ids = allIds(template.layers);
      layer.id = uniqueId(layer.id, ids);
      if (ids.size >= template.constraints.maxLayers) return fail("too many layers");
      let siblings = template.layers;
      if (op.parentId !== undefined) {
        const parent = locate(template.layers, op.parentId);
        if (!parent || parent.layer.type !== "group") return fail("parent is not a group");
        siblings = parent.layer.children;
      }
      siblings.splice(Math.min(op.index ?? siblings.length, siblings.length), 0, layer);
      return { ok: true, template };
    }
    case "removeLayer": {
      const hit = locate(template.layers, op.id);
      if (!hit) return fail("layer not found");
      if (hit.siblings === template.layers && template.layers.length === 1) return fail("last layer");
      hit.siblings.splice(hit.index, 1);
      return { ok: true, template };
    }
    case "reorderLayer": {
      const hit = locate(template.layers, op.id);
      if (!hit) return fail("layer not found");
      hit.siblings.splice(hit.index, 1);
      hit.siblings.splice(Math.max(0, Math.min(op.index, hit.siblings.length)), 0, hit.layer);
      return { ok: true, template };
    }
    case "moveLayer":
    case "resizeLayer":
    case "rebind":
    case "restyle": {
      const hit = locate(template.layers, op.id);
      if (!hit) return fail("layer not found");
      const draft: Record<string, unknown> = { ...hit.layer };
      if (op.op === "moveLayer") draft.box = { ...hit.layer.box, x: op.x, y: op.y };
      else if (op.op === "resizeLayer") draft.box = { ...hit.layer.box, w: op.w, h: op.h };
      else if (op.op === "rebind") draft[op.field] = op.value;
      else {
        if ("id" in op.patch || "type" in op.patch || "children" in op.patch) return fail("id, type and children are not restylable");
        Object.assign(draft, op.patch);
      }
      const next = revalidate(draft as Layer);
      if (typeof next === "string") return fail(next);
      hit.siblings[hit.index] = next;
      return { ok: true, template };
    }
    case "setBackground": {
      const parsed = templateHeader.shape.background.safeParse(op.background);
      if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid background");
      template.background = parsed.data as Background;
      return { ok: true, template };
    }
    case "setTheme": {
      const header = templateHeader.safeParse({
        ...template,
        themes: { ...template.themes, [op.mode]: { colors: { ...template.themes[op.mode].colors, ...op.colors } } },
      });
      if (!header.success) return fail(header.error.issues[0]?.message ?? "invalid theme");
      template.themes = header.data.themes;
      return { ok: true, template };
    }
    case "setCanvas": {
      const header = templateHeader.safeParse({ ...template, canvas: { ...template.canvas, height: op.height, aspect: op.aspect } });
      if (!header.success) return fail(header.error.issues[0]?.message ?? "invalid canvas");
      template.canvas = header.data.canvas;
      return { ok: true, template };
    }
  }
}

export const HISTORY_LIMIT = 100;

export type History = { past: Template[]; present: Template; future: Template[] };

export const createHistory = (present: Template): History => ({ past: [], present, future: [] });

/** Applies `op`; the history is unchanged when the op is rejected. */
export function pushOp(history: History, op: Op): { history: History; result: OpResult } {
  const result = applyOp(history.present, op);
  if (!result.ok) return { history, result };
  const past = [...history.past, history.present].slice(-HISTORY_LIMIT);
  return { history: { past, present: result.template, future: [] }, result };
}

export function undo(history: History): History {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redo(history: History): History {
  const next = history.future[0];
  if (!next) return history;
  return { past: [...history.past, history.present], present: next, future: history.future.slice(1) };
}
