import { isKnownFilter, parseTemplateString, type Expr } from "./expr";
import type { Issue } from "./scene";
import { DEFAULT_STORY_SAFE, type Layer, type Template } from "./schema";

/** Authoring checks that are too opinionated for `resolve`: safe area, sizes, filters, requires. */

function exprs(layer: Layer): Expr[] {
  switch (layer.type) {
    case "text":
      return [layer.value];
    case "stat":
      return [layer.value, ...(layer.unit ? [layer.unit] : []), ...(layer.label ? [layer.label] : [])];
    default:
      return [];
  }
}

export function lintTemplate(template: Template): Issue[] {
  const issues: Issue[] = [];
  // Posters bleed: giant numerals and color fields run to the edge on purpose.
  const safe = template.style === "poster" ? undefined : (template.safe ?? (template.canvas.aspect === "story" ? DEFAULT_STORY_SAFE : undefined));
  const { width, height } = template.canvas;
  const minFont = template.constraints.minFontSize;
  const visit = (layers: Layer[], ox: number, oy: number, absolute: boolean) => {
    for (const layer of layers) {
      const x = ox + (absolute ? layer.box.x : 0);
      const y = oy + (absolute ? layer.box.y : 0);
      const w = typeof layer.box.w === "number" ? layer.box.w : 0;
      const h = typeof layer.box.h === "number" ? layer.box.h : 0;
      if (safe && !template.meta?.transparent && layer.role !== "watermark" && layer.type !== "group" && absolute) {
        if (x < safe.left - 0.5 || y < safe.top - 0.5 || x + w > width - safe.right + 0.5 || y + h > height - safe.bottom + 0.5) {
          issues.push({ code: "outside-safe", message: `${layer.id} leaves the safe area`, layerId: layer.id });
        }
      }
      if (layer.type === "text" && layer.size < minFont) {
        issues.push({ code: "text-too-small", message: `${layer.id} size ${layer.size} < ${minFont}`, layerId: layer.id });
      }
      for (const e of exprs(layer)) {
        if (typeof e === "string") {
          for (const part of parseTemplateString(e)) {
            if (typeof part === "string") continue;
            for (const f of part.filters) {
              if (!isKnownFilter(f.name)) issues.push({ code: "unknown-filter", message: `${layer.id}: ${f.name}`, layerId: layer.id });
            }
          }
        }
      }
      if (layer.type === "group") visit(layer.children, x, y, !layer.layout);
    }
  };
  visit(template.layers, 0, 0, true);
  return issues;
}
