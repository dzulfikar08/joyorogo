import type { Mode } from "../core/color";
import type { Locale } from "../core/format";
import { parseTemplate } from "../core/parse";
import { isAvailable, resolve, type StickerData } from "../core/resolve";
import type { Issue, Scene } from "../core/scene";
import { exprPaths } from "../core/expr";
import type { Layer, Template } from "../core/schema";
import type { FontMap } from "../core/text";
import { rogoBrand } from "./brand";
import { buildStickerData, type StickerPrefs, type StorySpec } from "./data";
import { DAYFOOD_SLIDE_TEMPLATE, dayFoodSlides } from "./dayfood";
import { CAROUSEL_TAG, SLIDE_TAG } from "./selection";
import { rogoTranslate } from "./translate";
import { ROGO_TEMPLATE_SOURCES } from "./templates";

export * from "./data";
export * from "./dayfood";
export * from "./selection";
export { rogoBrand } from "./brand";
export { rogoNativeFonts, rogoWebFonts, NATIVE_FAMILIES, WEB_MONO_FAMILY, WEB_SANS_FAMILY } from "./fonts";
export { rogoTranslate } from "./translate";

export type RogoTemplates = { templates: Template[]; issues: Array<{ id: string; issues: Issue[] }> };

let cached: RogoTemplates | undefined;

/** Parses every built-in once. A built-in that degrades is excluded (and reported), never shown as the fallback card. */
export function rogoTemplates(): RogoTemplates {
  if (cached) return cached;
  const templates: Template[] = [];
  const issues: RogoTemplates["issues"] = [];
  for (const source of ROGO_TEMPLATE_SOURCES) {
    const result = parseTemplate(source);
    if (result.issues.length) issues.push({ id: source.id, issues: result.issues });
    if (!result.degraded) templates.push(result.template);
  }
  cached = { templates, issues };
  return cached;
}

/** Templates this story can fill, in catalog order. */
export function availableTemplates(spec: StorySpec, prefs: StickerPrefs = {}): Template[] {
  const data = buildStickerData(spec, prefs);
  return rogoTemplates().templates.filter(
    (template) =>
      !template.meta?.tags?.includes(SLIDE_TAG) &&
      isAvailable(template, data, rogoBrand) &&
      !(template.meta?.needsPhoto && !data.assets?.photo),
  );
}

function layerBindsName(layers: Layer[]): boolean {
  return layers.some((layer) => {
    if (layer.type === "group" && layerBindsName(layer.children)) return true;
    if (layer.type === "text" || layer.type === "stat") {
      const exprs = layer.type === "text" ? [layer.value] : [layer.value, ...(layer.unit ? [layer.unit] : []), ...(layer.label ? [layer.label] : [])];
      return exprs.some((e) => exprPaths(e).includes("user.name"));
    }
    return false;
  });
}

/** Whether "show my name" changes anything in this template (it binds `user.name`). */
export function templateShowsName(template: Template): boolean {
  return layerBindsName(template.layers);
}

export type RenderRequest = {
  template: Template;
  spec: StorySpec;
  prefs?: StickerPrefs;
  locale: Locale;
  mode: Mode;
  fonts: FontMap;
};

/** Spec + template -> Scene, with JoyoRogo brand and copy. */
export function renderSticker(req: RenderRequest): Scene {
  const data: StickerData = buildStickerData(req.spec, req.prefs);
  return resolve(req.template, data, {
    locale: req.locale,
    mode: req.mode,
    t: rogoTranslate(req.locale),
    fonts: req.fonts,
    brand: rogoBrand,
  });
}

/**
 * Every image a template exports: one for a card, and for a carousel template the cover, one page per meal and the
 * closing totals, each drawn by its own `slide` template from the same day.
 */
export function renderSlides(req: RenderRequest): Scene[] {
  if (req.spec.kind !== "dayfood" || !req.template.meta?.tags?.includes(CAROUSEL_TAG)) return [renderSticker(req)];
  const spec = req.spec;
  const all = rogoTemplates().templates;
  return dayFoodSlides(spec).flatMap((slide) => {
    const template = all.find((candidate) => candidate.id === DAYFOOD_SLIDE_TEMPLATE[slide.role]);
    return template ? [renderSticker({ ...req, template, spec: { ...spec, slide } })] : [];
  });
}
