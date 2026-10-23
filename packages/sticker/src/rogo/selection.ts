import type { Template } from "../core/schema";

export type CanvasKind = "story" | "square" | "sticker" | "carousel";

export const CANVAS_ORDER: readonly CanvasKind[] = ["story", "square", "sticker", "carousel"];

/** Tags on a template: `carousel` = one entry of the "Carousel" format, `slide` = a page only the carousel draws. */
export const CAROUSEL_TAG = "carousel";
export const SLIDE_TAG = "slide";

export function canvasOf(template: Template): CanvasKind {
  if (template.meta?.tags?.includes(CAROUSEL_TAG)) return "carousel";
  if (template.meta?.transparent) return "sticker";
  return template.canvas.aspect === "square" ? "square" : "story";
}

export type Selection = {
  kinds: string[];
  activeKind: string;
  /** Formats the active kind comes in. */
  canvases: CanvasKind[];
  activeCanvas: CanvasKind;
  /** Styles of the active kind in the active format. */
  styles: Template[];
  active: Template | null;
};

/**
 * What the share sheet shows for a set of available templates and the user's picks:
 * kind first, then the format that kind comes in, then its styles. A pick that no longer
 * exists falls back inside the same level: a different format never changes the kind,
 * and a different kind keeps the format when it has it.
 */
export function selectTemplates(
  templates: Template[],
  pick: { kind?: string | null; canvas?: CanvasKind | null; templateId?: string | null },
  onlyKinds?: readonly string[],
): Selection {
  const kinds = [...new Set(templates.map((t) => t.kind))].filter((k) => !onlyKinds || onlyKinds.includes(k));
  const activeKind = pick.kind != null && kinds.includes(pick.kind) ? pick.kind : (kinds[0] ?? "");
  const ofKind = templates.filter((t) => t.kind === activeKind);
  const canvases = CANVAS_ORDER.filter((c) => ofKind.some((t) => canvasOf(t) === c));
  const activeCanvas =
    pick.canvas != null && canvases.includes(pick.canvas) ? pick.canvas : (canvases[0] ?? "story");
  const styles = ofKind.filter((t) => canvasOf(t) === activeCanvas);
  const active = styles.find((t) => t.id === pick.templateId) ?? styles[0] ?? null;
  return { kinds, activeKind, canvases, activeCanvas, styles, active };
}
