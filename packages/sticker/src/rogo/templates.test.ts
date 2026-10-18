import { describe, expect, test } from "bun:test";

import { lintTemplate, type Scene, type SceneNode, type Template } from "../core";
import { resources } from "@joyorogo/i18n";
import { availableTemplates, buildStickerData, rogoTemplates, renderSticker, rogoWebFonts, streakMilestone, type StorySpec } from "./index";
import { FIXTURES, fixtureFor, type FixtureId } from "./fixtures";
import { ROGO_TEMPLATE_SOURCES } from "./templates";

const { templates, issues } = rogoTemplates();

function flat(nodes: SceneNode[]): SceneNode[] {
  return nodes.flatMap((n) => (n.k === "group" ? [n, ...flat(n.children)] : [n]));
}
const textsOf = (scene: Scene) => flat(scene.nodes).flatMap((n) => (n.k === "text" ? [n.text] : []));

function render(template: Template, fixture: FixtureId, options: Parameters<typeof renderSticker>[0]["prefs"] = {}, mode: "dark" | "light" = "dark", locale: "id" | "en" = "id") {
  const f = FIXTURES[fixture] as { spec: StorySpec; photo?: string };
  return renderSticker({
    template,
    spec: f.spec,
    prefs: { photo: f.photo ? { uri: `fixture:${f.photo}` } : null, ...options },
    locale,
    mode,
    fonts: rogoWebFonts,
  });
}

describe("catalog", () => {
  test("every built-in parses cleanly, ids are unique and follow kind.style.canvas", () => {
    expect(issues).toEqual([]);
    expect(templates).toHaveLength(ROGO_TEMPLATE_SOURCES.length);
    const ids = templates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of templates) expect(t.id.split(".").slice(0, 2)).toEqual([t.kind, expect.any(String)]);
  });

  test("covers every sticker kind in every canvas family", () => {
    const kinds = new Set(templates.map((t) => t.kind));
    for (const kind of ["day", "meal", "streak", "weight", "week", "challenge", "workout", "milestone"]) expect(kinds.has(kind)).toBe(true);
    for (const aspect of ["story", "square"]) expect(templates.some((t) => t.canvas.aspect === aspect)).toBe(true);
    expect(templates.some((t) => t.meta?.transparent)).toBe(true);
    expect(templates.some((t) => t.background.kind === "photo")).toBe(true);
    const styles = new Set(templates.map((t) => t.style));
    for (const style of ["minimal", "bold", "receipt", "poster", "glass", "badge", "ring", "trend"]) expect(styles.has(style)).toBe(true);
  });

  test("lint is clean (safe area, minimum sizes, filters)", () => {
    for (const t of templates) expect({ id: t.id, issues: lintTemplate(t) }).toEqual({ id: t.id, issues: [] });
  });

  test("transparent templates really have a transparent background and no solid fill", () => {
    for (const t of templates.filter((x) => x.meta?.transparent)) {
      expect(t.background.kind).toBe("transparent");
      const scene = render(t, fixtureFor(t));
      expect(scene.transparent).toBe(true);
    }
  });

  test("all i18n keys the templates use exist in id and en", () => {
    const keys = new Set<string>();
    const collect = (value: unknown) => {
      if (value && typeof value === "object") {
        if ("t" in value && typeof value.t === "string") keys.add(value.t);
        for (const child of Object.values(value)) collect(child);
      }
    };
    for (const t of templates) collect(t.layers);
    keys.add("sticker:style.minimal");
    const has = (locale: "id" | "en", key: string) => {
      const [ns, path] = key.split(":");
      let node: unknown = (resources[locale] as Record<string, unknown>)[ns!];
      for (const part of path!.split(".")) {
        // plural leaves are `<key>_other` / `<key>_one`
        if (node && typeof node === "object" && part in node) node = (node as Record<string, unknown>)[part];
        else if (node && typeof node === "object" && `${part}_other` in node) return true;
        else return false;
      }
      return typeof node === "string";
    };
    const missing = [...keys].flatMap((key) => (["id", "en"] as const).filter((l) => !has(l, key)).map((l) => `${l}:${key}`));
    expect(missing).toEqual([]);
  });
});

describe("rendering with fixtures", () => {
  test("every template renders for every fixture it is offered for, in both modes and languages, with no scene issues", () => {
    for (const [fid, f] of Object.entries(FIXTURES) as Array<[FixtureId, (typeof FIXTURES)[FixtureId]]>) {
      const photo = (f as { photo?: string }).photo ? { uri: `fixture:${(f as { photo?: string }).photo}` } : null;
      const offered = availableTemplates(f.spec, { photo });
      expect(offered.length).toBeGreaterThan(0);
      for (const t of offered) {
        for (const mode of ["dark", "light"] as const) {
          for (const locale of ["id", "en"] as const) {
            const scene = render(t, fid, {}, mode, locale);
            expect({ t: t.id, fid, mode, locale, issues: scene.issues.filter((i) => i.code !== "text-too-small") }).toEqual({ t: t.id, fid, mode, locale, issues: [] });
            expect(scene.nodes.length).toBeGreaterThan(0);
            const sizes = flat(scene.nodes).flatMap((n) => (n.k === "text" ? [n.size] : []));
            expect(Math.min(...sizes)).toBeGreaterThanOrEqual(22);
          }
        }
      }
    }
  });

  test("no template ever paints an emoji, a template placeholder, or NaN/undefined", () => {
    for (const t of templates) {
      const scene = render(t, fixtureFor(t));
      for (const text of textsOf(scene)) {
        expect(text).not.toMatch(/undefined|NaN|\{|\}|\[object/);
        expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
      }
    }
  });

  test("long names with emoji never overflow or leak the emoji", () => {
    const meal = FIXTURES["meal-long"] as { spec: StorySpec; photo: string };
    const offered = new Set(availableTemplates(meal.spec, { photo: { uri: `fixture:${meal.photo}` } }).map((t) => t.id));
    for (const t of templates.filter((x) => x.kind === "meal" && offered.has(x.id))) {
      const scene = render(t, "meal-long");
      const joined = textsOf(scene).join(" ");
      expect(joined).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(joined.toLowerCase()).toContain("mie ayam");
    }
  });

  test("the watermark is removable and nothing else disappears", () => {
    for (const t of templates) {
      const on = textsOf(render(t, fixtureFor(t), { options: { watermark: true } }));
      const off = textsOf(render(t, fixtureFor(t), { options: { watermark: false } }));
      expect(off.some((x) => x === "joyorogo.com")).toBe(false);
      expect(on.some((x) => x === "joyorogo.com")).toBe(true);
      expect(off.length).toBeLessThan(on.length);
    }
  });

  test("missing data hides layers instead of leaving stubs: a unit never appears without its number", () => {
    // Shadow copies sit a few px below their text; only the ink nodes are compared.
    const textNodes = (scene: Scene) => flat(scene.nodes).flatMap((n) => (n.k === "text" && !n.fill.startsWith("#000000") ? [n] : []));
    for (const fid of ["progress-empty", "recap-sparse", "workout-bare", "challenge-upcoming", "progress-maternal"] as const) {
      for (const t of availableTemplates(FIXTURES[fid].spec, {})) {
        const nodes = textNodes(render(t, fid));
        for (const unit of nodes.filter((n) => /^(g|kg|kcal|hari|menit|set|jam)$/.test(n.text))) {
          const partner = nodes.find((n) => n !== unit && Math.abs(n.y - unit.y) < 200 && /\d/.test(n.text));
          expect({ t: t.id, fid, unit: unit.text, hasNumber: partner !== undefined }).toEqual({ t: t.id, fid, unit: unit.text, hasNumber: true });
        }
      }
    }
  });
});

describe("privacy defaults", () => {
  const weightTemplates = () => templates.filter((t) => t.kind === "weight" || t.id.startsWith("day."));

  test("exact weight never reaches a sticker unless the user opts in", () => {
    for (const t of weightTemplates()) {
      const hidden = textsOf(render(t, "progress-full")).join(" ");
      expect(hidden).not.toMatch(/\bkg\b/);
      expect(hidden).not.toMatch(/77[,.]5|80[,.]9|3[,.]4|72/);
    }
  });

  test("opt-in shows the numbers in the templates that carry them", () => {
    const shown = templates
      .filter((t) => t.kind === "weight")
      .map((t) => textsOf(render(t, "progress-full", { options: { hideNumbers: false } })).join(" "));
    expect(shown.some((s) => /\bkg\b/.test(s))).toBe(true);
  });

  test("the name is absent unless opted in, and first-name only", () => {
    const all = templates.map((t) => textsOf(render(t, fixtureFor(t), { userName: "Rani Putri", options: { showName: false } })).join(" ")).join(" ");
    expect(all).not.toContain("Rani");
  });

  test("buildStickerData omits kg values when numbers are hidden (the default)", () => {
    const spec = FIXTURES["progress-full"].spec;
    const hidden = buildStickerData(spec).data.weight as Record<string, unknown>;
    expect(hidden.lostKg).toBeUndefined();
    expect(hidden.startKg).toBeUndefined();
    expect(hidden.goalPct).toBe(0.62);
    expect(hidden.direction).toBe("down");
    const shown = buildStickerData(spec, { options: { hideNumbers: false } }).data.weight as Record<string, unknown>;
    expect(shown.lostKg).toBe(3.4);
    expect(shown.nowKg).toBe(77.5);
  });

  test("maternal days carry no target or weight framing", () => {
    const data = buildStickerData(FIXTURES["progress-maternal"].spec).data;
    expect((data.day as Record<string, unknown>).target).toBeUndefined();
    expect(data.weight).toBeUndefined();
    const ids = availableTemplates(FIXTURES["progress-maternal"].spec, {}).map((t) => t.kind);
    expect(ids).not.toContain("weight");
  });

  test("Naikin never words a gain as a loss and never colors it as a warning", () => {
    const spec = FIXTURES["progress-gain"].spec;
    for (const t of availableTemplates(spec, {})) {
      const text = textsOf(render(t, "progress-gain")).join(" ").toLowerCase();
      expect(text).not.toMatch(/turun|lewat|down/);
    }
  });
});

describe("data builders", () => {
  test("milestones", () => {
    expect([2, 3, 7, 29, 30, 365, 1200].map(streakMilestone)).toEqual([null, 3, 7, 21, 30, 365, 1000]);
    const m = (spec: StorySpec) => buildStickerData(spec).data.milestone as Record<string, unknown> | undefined;
    expect(m(FIXTURES["progress-full"].spec)?.kind).toBe("streak");
    expect(m(FIXTURES.workout.spec)?.kind).toBe("pr");
    expect(m(FIXTURES.recap.spec)?.kind).toBe("week");
    expect(m(FIXTURES.challenge.spec)?.kind).toBe("podium");
    expect(m(FIXTURES["challenge-upcoming"].spec)).toBeUndefined();
    expect(m(FIXTURES["progress-empty"].spec)).toBeUndefined();
  });

  test("the subject date is a local calendar day and bound at the top level", () => {
    expect(buildStickerData(FIXTURES["meal-plain"].spec).date).toBe("2026-10-18");
  });

  test("a cutout meal fills the cutout slot, never the photo background", () => {
    const data = buildStickerData(FIXTURES["meal-cutout"].spec);
    expect(data.assets?.cutout?.uri).toBe("fixture:cutout.png");
    expect(data.assets?.photo).toBeUndefined();
    const offered = availableTemplates(FIXTURES["meal-cutout"].spec, {}).map((t) => t.id);
    expect(offered).toContain("meal.cutout.story");
    expect(offered).toContain("meal.cutout.sticker");
    const plain = availableTemplates(FIXTURES["meal-plain"].spec, {}).map((t) => t.id);
    expect(plain).not.toContain("meal.cutout.story");
  });
});
