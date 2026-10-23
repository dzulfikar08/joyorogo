import { describe, expect, test } from "bun:test";

import { lintTemplate, type Scene, type SceneNode, type Template } from "../core";
import { resources } from "@joyorogo/i18n";
import {
  availableTemplates,
  buildStickerData,
  canvasOf,
  rogoTemplates,
  renderSlides,
  renderSticker,
  rogoWebFonts,
  selectTemplates,
  streakMilestone,
  templateShowsName,
  type StorySpec,
} from "./index";
import { FIXTURES, fixtureFor, type FixtureId } from "./fixtures";
import { ROGO_DARK } from "./kit";
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
        for (const unit of nodes.filter((n) => /^(g|kg|kcal|kkal|hari|menit|set|jam)$/.test(n.text))) {
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

  test("a meal with a plate sticker and a photo offers both kinds of card, each with its own image", () => {
    const { spec } = FIXTURES["meal-plate"];
    const photo = { uri: "fixture:meal.jpg" };
    const data = buildStickerData({ ...spec, photoUri: photo.uri }, {});
    expect(data.assets?.cutout?.uri).toBe("fixture:cutout.png");
    expect(data.assets?.photo?.uri).toBe("fixture:meal.jpg");
    const offered = availableTemplates({ ...spec, photoUri: photo.uri }, {}).map((t) => t.id);
    expect(offered).toContain("meal.cutout.story");
    expect(offered).toContain("meal.photo.story");
    // The plate sticker beats a cutout passed as the photo, so the plate shows once.
    const both = buildStickerData({ ...spec, photoUri: "fixture:component.png", photoCutout: true }, {});
    expect(both.assets?.cutout?.uri).toBe("fixture:cutout.png");
    expect(both.assets?.photo).toBeUndefined();
  });
});

describe("share sheet selection", () => {
  const all = templates;

  test("a format switch never changes the kind", () => {
    for (const kind of new Set(all.map((t) => t.kind))) {
      const own = all.filter((t) => t.kind === kind);
      for (const canvas of ["story", "square", "sticker"] as const) {
        const sel = selectTemplates(own, { kind, canvas });
        expect(sel.activeKind).toBe(kind);
        expect(sel.styles.every((t) => t.kind === kind)).toBe(true);
      }
    }
  });

  test("offered formats and styles belong to the active kind", () => {
    const sel = selectTemplates(all, { kind: "streak", canvas: "square" });
    expect(sel.activeKind).toBe("streak");
    expect(sel.canvases).toEqual(["story", "square", "sticker"]);
    expect(sel.styles.map((t) => t.id)).toEqual(["streak.poster.square"]);
    const meal = selectTemplates(all, { kind: "meal", canvas: "story" });
    expect(meal.canvases).toContain("sticker");
  });

  test("switching kind keeps the format when the new kind has it, else its first", () => {
    const keep = selectTemplates(all, { kind: "weight", canvas: "sticker" });
    expect(keep.activeCanvas).toBe("sticker");
    const fallback = selectTemplates(all.filter((t) => t.kind !== "weight" || canvasOf(t) !== "sticker"), { kind: "weight", canvas: "sticker" });
    expect(fallback.activeKind).toBe("weight");
    expect(fallback.activeCanvas).toBe(fallback.canvases[0]!);
  });

  test("unknown picks fall back, kinds can be restricted", () => {
    const sel = selectTemplates(all, { kind: "nope", canvas: "square", templateId: "ghost" });
    expect(sel.activeKind).toBe(sel.kinds[0]!);
    expect(sel.active).not.toBeNull();
    const only = selectTemplates(all, { kind: "day" }, ["weight"]);
    expect(only.kinds).toEqual(["weight"]);
    expect(only.activeKind).toBe("weight");
  });

  test("within a kind and format every style label is unique", () => {
    for (const kind of new Set(all.map((t) => t.kind))) {
      for (const canvas of ["story", "square", "sticker"] as const) {
        const styles = selectTemplates(all, { kind, canvas }).styles.map((t) => t.style);
        expect({ kind, canvas, styles }).toEqual({ kind, canvas, styles: [...new Set(styles)] });
      }
    }
  });
});

describe("images reach the native painter as top-level nodes", () => {
  // React Native's own Image paints top-level image nodes and reports their load; an image buried in a
  // group would be drawn by react-native-svg, which cannot report it (this broke the meal photo styles).
  test("no template nests an image inside a group", () => {
    const nested = (nodes: SceneNode[], inGroup: boolean): string[] =>
      nodes.flatMap((n) => (n.k === "group" ? nested(n.children, true) : n.k === "image" && inGroup ? [n.uri] : []));
    for (const [fid, f] of Object.entries(FIXTURES) as Array<[FixtureId, (typeof FIXTURES)[FixtureId]]>) {
      const photo = (f as { photo?: string }).photo ? { uri: `fixture:${(f as { photo?: string }).photo}` } : null;
      for (const t of availableTemplates(f.spec, { photo })) {
        expect({ t: t.id, fid, nested: nested(render(t, fid).nodes, false) }).toEqual({ t: t.id, fid, nested: [] });
      }
    }
  });

  test("a photo-less meal is not offered the full-bleed photo style, a cutout meal gets the cutout styles", () => {
    const plain = availableTemplates(FIXTURES["meal-plain"].spec, {}).map((t) => t.id);
    expect(plain).not.toContain("meal.photo.story");
    const cutout = availableTemplates(FIXTURES["meal-cutout"].spec, {}).map((t) => t.id);
    expect(cutout).not.toContain("meal.photo.story");
    expect(cutout).toContain("meal.cutout.story");
    const withPhoto = availableTemplates(FIXTURES["meal-photo"].spec, { photo: { uri: "fixture:meal.jpg" } }).map((t) => t.id);
    expect(withPhoto).toContain("meal.photo.story");
  });

  test("a meal with a private original photo and a cutout fills both slots", () => {
    const data = buildStickerData(FIXTURES["meal-cutout"].spec, { photo: { uri: "file:///cache/photo-1.jpg" } });
    expect(data.assets?.photo?.uri).toBe("file:///cache/photo-1.jpg");
    expect(data.assets?.cutout?.uri).toBe("fixture:cutout.png");
  });

  test("name toggle: styles that bind the name show it, the sticker mark chip carries it", () => {
    const showers = templates.filter((t) => templateShowsName(t));
    expect(showers.length).toBeGreaterThanOrEqual(templates.length - 2);
    for (const t of showers) {
      const withName = textsOf(render(t, fixtureFor(t), { userName: "Rani", options: { showName: true } })).join(" ");
      expect({ id: t.id, shown: /rani/i.test(withName) }).toEqual({ id: t.id, shown: true });
    }
  });
});

describe("entry points offer every format", () => {
  // A plain progress story as the Beranda builds it, without any of the optional server extras.
  const plain: StorySpec = {
    kind: "progress",
    eatenKcal: 1394,
    targetKcal: 1885,
    proteinG: 50,
    proteinTargetG: 100,
    streakDays: 7,
    weightGoalProgress: 0.4,
    weekTrend: [
      { date: "2026-10-12", weightKg: 80 },
      { date: "2026-10-18", weightKg: 78.7 },
    ],
  };

  test("streak and weight come in story, square and sticker", () => {
    const sel = (kind: string) => selectTemplates(availableTemplates(plain, {}), { kind }).canvases;
    expect(sel("streak")).toEqual(["story", "square", "sticker"]);
    expect(sel("weight")).toEqual(["story", "square", "sticker"]);
  });

  test("without goal progress the weight kind loses its sticker and square, so entry points must derive it", () => {
    const { weightGoalProgress: _drop, ...noGoal } = plain as Extract<StorySpec, { kind: "progress" }>;
    expect(selectTemplates(availableTemplates(noGoal, {}), { kind: "weight" }).canvases).toEqual(["story"]);
  });
});

describe("period progress (Progres)", () => {
  const period = (fid: FixtureId) => (FIXTURES[fid] as { spec: Extract<StorySpec, { kind: "period" }> }).spec;
  const story = templates.find((t) => t.id === "period.progress.story")!;
  const square = templates.find((t) => t.id === "period.progress.square")!;
  const joined = (fid: FixtureId, template: Template, options: NonNullable<Parameters<typeof renderSticker>[0]["prefs"]>["options"] = {}, locale: "id" | "en" = "id") =>
    textsOf(render(template, fid, { options }, "dark", locale)).join(" | ");

  test("is offered in story and square for a period, and only for a period", () => {
    const sel = selectTemplates(availableTemplates(period("period-full"), {}), { kind: "period" });
    expect(sel.kinds).toEqual(["period"]);
    expect(sel.canvases).toEqual(["story", "square"]);
    for (const fid of ["progress-full", "recap", "meal-plain"] as const) {
      expect(availableTemplates((FIXTURES[fid] as { spec: StorySpec }).spec, {}).some((t) => t.kind === "period")).toBe(false);
    }
  });

  test("absolute weight, its percent and the kg axis are hidden by default and only the change shows", () => {
    for (const t of [story, square]) {
      const hidden = joined("period-full", t, { hideNumbers: true });
      expect(hidden).toContain("Turun 2,4 kg");
      expect(hidden).not.toMatch(/108|105,|2,2%/);
      expect(hidden).toContain("tanpa angka");
      const shown = joined("period-full", t, { hideNumbers: false });
      expect(shown).toContain("108,0");
      expect(shown).toContain("105,6");
      expect(shown).toContain("2,2%");
    }
    const data = buildStickerData(period("period-full"), { options: { hideNumbers: true } }).data.period as Record<string, unknown>;
    for (const key of ["startKg", "endKg", "changePct", "kgTop", "kgBottom"]) expect(data[key]).toBeUndefined();
  });

  test("the deficit, its fat estimate and its note go away together with the switch", () => {
    for (const t of [story, square]) {
      const on = joined("period-full", t);
      expect(on).toContain("Perkiraan defisit");
      expect(on).toContain("15.600");
      expect(on).toContain("sekitar 2,0 kg lemak");
      expect(on).toContain("bukan pengukuran");
      const off = textsOf(
        renderSticker({ template: t, spec: { ...period("period-full"), hideDeficit: true }, prefs: {}, locale: "id", mode: "dark", fonts: rogoWebFonts }),
      ).join(" | ");
      expect(off).not.toMatch(/defisit|15\.600|lemak|bukan pengukuran/);
      expect(off).toContain("26");
    }
  });

  test("days logged read against the finished days, with the streak only from 2 days", () => {
    const text = joined("period-full", story);
    expect(text).toContain("26");
    expect(text).toContain("dari 30 hari");
    expect(text).toContain("Beruntun 7 hari");
    expect(joined("period-weekly", story)).not.toContain("Beruntun");
  });

  test("a rising trend is worded plainly and kindly, with no fat or deficit claim", () => {
    const text = joined("period-up", story);
    expect(text).toContain("Naik 0,7 kg");
    expect(text).toContain("Naik turun itu wajar");
    expect(text).not.toMatch(/gagal|turun 0,7|lemak|defisit/i);
  });

  test("a Naikin BB period says surplus and never fat", () => {
    const text = joined("period-gain", square);
    expect(text).toContain("Naik 1,3 kg");
    expect(text).toContain("Perkiraan surplus");
    expect(text).toContain("12.400");
    expect(text).not.toMatch(/lemak|defisit|Beruntun 12 hari.*turun/);
  });

  test("a deficit without a fat estimate shows the kcal alone", () => {
    const text = joined("period-weekly", story);
    expect(text).toContain("Perkiraan defisit");
    expect(text).not.toContain("lemak");
  });

  test("without weigh-ins the days logged lead and no weight chart is drawn", () => {
    const text = joined("period-no-weight", story);
    expect(text).toContain("9 dari 14 hari tercatat");
    expect(text).not.toMatch(/Tren berat|Turun|Naik/);
    expect(text).toContain("Kalori masuk per hari");
  });

  test("without a deficit the logged days take the whole row", () => {
    const text = joined("period-up", story);
    expect(text).toContain("Hari tercatat");
    expect(text).toContain("dari 30 hari");
    expect(text).not.toMatch(/defisit|surplus|Perkiraan dari/);
  });

  test("with neither weight nor a burn estimate the headline carries the days logged and the card stays small", () => {
    const text = joined("period-sparse", square);
    expect(text).toContain("2 dari 7 hari tercatat");
    expect(text).not.toMatch(/defisit|surplus|Perkiraan dari|Hari tercatat/);
    expect(text).toContain("Batang pendek: hari tanpa catatan");
    expect(text).not.toContain("Garis putus");
  });

  test("a period with nothing to show is not offered", () => {
    const empty: StorySpec = { kind: "period", from: "2026-10-01", to: "2026-10-07", judgedDays: 7, loggedDays: 0, weight: null };
    expect(availableTemplates(empty, {}).some((t) => t.kind === "period")).toBe(false);
  });

  test("weekly bars name the week and the intake axis is labelled 0 to the top value", () => {
    const text = joined("period-weekly", story, {}, "en");
    expect(text).toContain("Average calories eaten per week");
    expect(text).toContain("2,500");
    expect(text).toMatch(/\| 0 \|/);
    expect(text).toContain("Dashed line: target 1,900 kcal");
  });
});

describe("a whole day of food (Makan sehari)", () => {
  const day = (fid: FixtureId) => (FIXTURES[fid] as { spec: Extract<StorySpec, { kind: "dayfood" }> }).spec;
  const story = templates.find((t) => t.id === "dayfood.full.story")!;
  const cover = templates.find((t) => t.id === "dayfood.cover.carousel")!;
  const pages = (fid: FixtureId, locale: "id" | "en" = "id", mode: "dark" | "light" = "dark", template: Template = cover) =>
    renderSlides({ template, spec: day(fid), prefs: {}, locale, mode, fonts: rogoWebFonts });
  const storyText = (fid: FixtureId, locale: "id" | "en" = "id") => textsOf(render(story, fid, {}, "dark", locale)).join(" | ");

  test("is offered as one story and one carousel entry; the carousel's own pages are never styles", () => {
    const offered = availableTemplates(day("dayfood-full"), {});
    expect(offered.map((t) => t.id)).toEqual(["dayfood.full.story", "dayfood.cover.carousel"]);
    const sel = selectTemplates(offered, { kind: "dayfood" });
    expect(sel.kinds).toEqual(["dayfood"]);
    expect(sel.canvases).toEqual(["story", "carousel"]);
    expect(canvasOf(cover)).toBe("carousel");
    expect(canvasOf(story)).toBe("story");
    for (const fid of ["progress-full", "meal-photo", "recap"] as const) {
      expect(availableTemplates((FIXTURES[fid] as { spec: StorySpec }).spec, {}).some((t) => t.kind === "dayfood")).toBe(false);
    }
  });

  test("the story reads kcal against the target, the four macros against theirs, and every meal with its numbers", () => {
    const text = storyText("dayfood-full");
    expect(text).toContain("1.760");
    expect(text).toContain("/ 1.850 kkal");
    expect(text).toContain("Kamis, 22 Okt 2026");
    for (const part of ["122 / 110 g", "164 / 242 g", "72 / 51 g", "27 / 26 g"]) expect(text).toContain(part);
    for (const meal of ["Sarapan", "217 kkal", "Makan siang", "690 kkal", "Makan malam", "681 kkal", "Snack", "172 kkal"]) expect(text).toContain(meal);
    expect(text).toContain("Pepaya, Putih telur, Americano ice");
    expect(storyText("dayfood-full", "en")).toContain("/ 1,850 kcal");
  });

  test("reached targets are called out and nothing else is", () => {
    const text = storyText("dayfood-full");
    expect(text).toContain("Pas di target");
    expect(text).toContain("Protein tercapai");
    expect(text).toContain("Serat tercapai");
    const over = storyText("dayfood-over");
    expect(over).toContain("2.320");
    expect(over).not.toMatch(/tercapai|Pas di target/);
  });

  test("past the target is never shamed: no over wording, no warning colour, a full bar is just full", () => {
    for (const fid of ["dayfood-over", "dayfood-full"] as const) {
      for (const locale of ["id", "en"] as const) {
        const scenes = [render(story, fid, {}, "dark", locale), ...pages(fid, locale)];
        for (const scene of scenes) {
          expect(textsOf(scene).join(" ")).not.toMatch(/lewat|lebih|kelebihan|over|exceed|too much|kurang/i);
          const fills = JSON.stringify(scene.nodes);
          for (const warn of [ROGO_DARK.warn!, ROGO_DARK.bad!]) expect(fills).not.toContain(warn);
        }
      }
    }
  });

  test("a macro nobody logged shows as a dash, never as 0, and a day with none hides the macro block", () => {
    const text = storyText("dayfood-over");
    expect(text).toContain("71 / 110 g");
    expect(text).toMatch(/Lemak \| - \| Serat \| -|Lemak.*\| - \|/);
    const bare = storyText("dayfood-bare");
    expect(bare).toContain("480");
    expect(bare).not.toMatch(/Protein|Karbo|Lemak|Serat|\//);
  });

  test("without a kcal target the figure stands alone: no 'of', no bar", () => {
    const scene = render(story, "dayfood-bare");
    expect(textsOf(scene).join(" ")).not.toContain("/ ");
    const withTarget = render(story, "dayfood-full");
    expect(flat(withTarget.nodes).filter((n) => n.k === "rect").length).toBeGreaterThan(flat(scene.nodes).filter((n) => n.k === "rect").length);
  });

  test("weight never appears on any page", () => {
    for (const fid of ["dayfood-full", "dayfood-over", "dayfood-bare"] as const) {
      const text = [storyText(fid), ...pages(fid).flatMap(textsOf)].join(" ");
      expect(text).not.toMatch(/\bkg\b|berat/i);
    }
  });

  test("the carousel is a cover, one page per meal in order, and the closing totals, all 4:5", () => {
    const scenes = pages("dayfood-full");
    expect(scenes).toHaveLength(6);
    for (const scene of scenes) {
      expect(scene.width).toBe(1080);
      expect(scene.height).toBe(1350);
      expect(scene.issues).toEqual([]);
    }
    expect(textsOf(scenes[0]!).join(" | ")).toContain("Makanku sehari");
    expect(textsOf(scenes[1]!)).toContain("Sarapan");
    expect(textsOf(scenes[2]!)).toContain("Makan siang");
    expect(textsOf(scenes[3]!)).toContain("Makan malam");
    expect(textsOf(scenes[4]!)).toContain("Snack");
    expect(textsOf(scenes[5]!).join(" | ")).toContain("Total hari ini");
    expect(textsOf(scenes[1]!)).toContain("2 / 6");
    expect(textsOf(scenes[5]!)).toContain("6 / 6");
    expect(pages("dayfood-full", "en").flatMap(textsOf).join(" | ")).toContain("What I eat in a day");
  });

  test("a meal page lists every food with grams, kcal and P/K/L", () => {
    const lunch = textsOf(pages("dayfood-full")[2]!);
    for (const part of ["nasi liwet", "ayam bakar", "sambal", "sayur urap", "Putih Telur", "200", "300", "168", "690"]) expect(lunch).toContain(part);
    const snack = textsOf(pages("dayfood-full")[4]!);
    expect(snack.filter((s) => s === "Fibe mini")).toHaveLength(2);
  });

  test("a meal of more than 8 foods ends with one row that carries the rest", () => {
    const [, meal] = pages("dayfood-long");
    const texts = textsOf(meal!);
    expect(texts).toContain("Lauk 7");
    expect(texts).not.toContain("Lauk 8");
    expect(texts).toContain("+3 lainnya");
  });

  test("cutouts: the layout adapts to how many a meal has, and a meal without any still reads", () => {
    const full = render(story, "dayfood-full");
    expect(full.needsImages).toEqual(["fixture:cutout.png"]);
    const none = render(story, "dayfood-bare");
    expect(none.needsImages).toEqual([]);
    const text = textsOf(none).join(" | ");
    expect(text).toContain("Makan siang");
    expect(text).toContain("Soto ayam");
    const noStickerPage = pages("dayfood-full")[4]!;
    expect(noStickerPage.needsImages).toEqual([]);
    expect(textsOf(noStickerPage).join(" ")).toContain("Protein");
  });

  test("extra meals past the fourth are counted, not drawn", () => {
    const spec = { ...day("dayfood-full"), meals: [...day("dayfood-full").meals, { ...day("dayfood-full").meals[3]!, label: "Sahur" }] };
    const text = textsOf(renderSticker({ template: story, spec, prefs: {}, locale: "id", mode: "dark", fonts: rogoWebFonts })).join(" | ");
    expect(text).toContain("+1 waktu makan lainnya");
    expect(text).not.toContain("Sahur");
    expect(renderSlides({ template: cover, spec, prefs: {}, locale: "id", mode: "dark", fonts: rogoWebFonts })).toHaveLength(7);
  });
});

describe("calorie unit follows the locale", () => {
  test("Indonesian cards say kkal and English cards say kcal, never the other way round", () => {
    let seen = 0;
    for (const t of templates) {
      const fixture = fixtureFor(t);
      const id = textsOf(render(t, fixture, {}, "dark", "id")).join(" ");
      const en = textsOf(render(t, fixture, {}, "dark", "en")).join(" ");
      expect(id).not.toMatch(/\bkcal\b/i);
      expect(en).not.toMatch(/\bkkal\b/i);
      if (/\bkkal\b/.test(id)) {
        seen++;
        expect(en).toMatch(/\bkcal\b/);
      }
    }
    expect(seen).toBeGreaterThan(10);
  });
});
