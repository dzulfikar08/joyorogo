import { describe, expect, test } from "bun:test";

import { toSvg } from "./emit-svg";
import { isAvailable, resolve } from "./resolve";
import { flat, makeTemplate, sceneOf, TEST_BRAND, TEST_CTX, TEST_FONTS, texts } from "./test-kit";

const text = (id: string, value: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "text",
  value,
  size: 40,
  box: { x: 100, y: 100, w: 400 },
  ...extra,
});

describe("bindings", () => {
  test("a layer with a missing binding is hidden; onMissing keep uses the fallback", () => {
    const scene = sceneOf([text("a", "{x}"), text("b", "{x}", { onMissing: "keep", fallback: "n/a" })]);
    expect(texts(scene).map((t) => t.text)).toEqual(["n/a"]);
  });

  test("when conditions switch variants", () => {
    const layers = [
      text("up", "naik", { when: { bind: "dir", eq: "up" } }),
      text("down", "turun", { when: { bind: "dir", eq: "down" } }),
    ];
    expect(texts(sceneOf(layers, { data: { dir: "down" } })).map((t) => t.text)).toEqual(["turun"]);
    expect(texts(sceneOf(layers, { data: {} }))).toHaveLength(0);
  });

  test("opt.*, app.* and user.* are injected; user.name needs showName", () => {
    const layers = [text("a", "{app.name} {app.link}"), text("b", "{user.name}"), text("c", "{opt.hideNumbers}")];
    const hidden = texts(sceneOf(layers, { data: { user: { name: "Rani" } } }));
    expect(hidden.map((t) => t.text)).toEqual(["TestApp test.app", "false"]);
    const shown = texts(sceneOf(layers, { data: { user: { name: "Rani" } }, options: { showName: true, hideNumbers: true } }));
    expect(shown.map((t) => t.text)).toEqual(["TestApp test.app", "Rani", "true"]);
  });

  test("the subject date is bound as {date}", () => {
    const layers = [text("a", "{date|date:medium}"), text("b", "{date|date:weekday}")];
    const scene = sceneOf(layers, { date: "2026-10-18", data: {} });
    expect(texts(scene).map((t) => t.text)).toEqual(["18 Okt 2026", "Minggu"]);
    expect(texts(sceneOf(layers, { data: {} }))).toHaveLength(0);
  });

  test("garbage data never throws", () => {
    const layers = [
      text("a", "{a.b.c|int}"),
      { id: "r", type: "ring", progress: { bind: "p" }, box: { x: 0, y: 0, w: 100, h: 100 } },
      { id: "c", type: "chart", kind: "bars", series: { bind: "s" }, box: { x: 0, y: 0, w: 100, h: 100 } },
      { id: "t", type: "route", points: { bind: "route" }, box: { x: 0, y: 0, w: 100, h: 100 } },
    ];
    for (const data of [{}, { a: null, p: "x", s: "y", route: 5 }, { a: { b: [] }, p: [], s: [null, "z", {}], route: [[1], "x"] }]) {
      expect(() => sceneOf(layers, { data })).not.toThrow();
    }
  });
});

describe("text layout", () => {
  test("long names shrink to the floor, then ellipsize, within the box", () => {
    const scene = sceneOf([text("a", "{n}", { size: 100, box: { x: 0, y: 0, w: 300 } })], { data: { n: "Nasi goreng kampung spesial komplit" } });
    const [t] = texts(scene);
    expect(t!.size).toBeLessThan(100);
    expect(t!.size).toBeGreaterThanOrEqual(22);
    expect(t!.text.endsWith("\u2026")).toBe(true);
  });

  test("emoji in user text is stripped, never painted", () => {
    const scene = sceneOf([text("a", "{n}")], { data: { n: "Sate \u{1F356} madura" } });
    expect(texts(scene)[0]!.text).toBe("Sate madura");
  });

  test("sizes under the minimum are raised and reported", () => {
    const scene = sceneOf([text("a", "x", { size: 10 })]);
    expect(texts(scene)[0]!.size).toBe(22);
    expect(scene.issues.some((i) => i.code === "text-too-small")).toBe(true);
  });

  test("alignment anchors the baseline x", () => {
    const scene = sceneOf([
      text("l", "ab", { align: "left" }),
      text("c", "ab", { align: "center" }),
      text("r", "ab", { align: "right" }),
    ]);
    const [l, c, r] = texts(scene);
    expect([l!.anchor, c!.anchor, r!.anchor]).toEqual(["start", "middle", "end"]);
    expect(l!.x).toBe(100);
    expect(c!.x).toBe(300);
    expect(r!.x).toBe(500);
  });

  test("cap trim puts the baseline at the cap height", () => {
    const scene = sceneOf([text("a", "1", { size: 100, trim: "cap", box: { x: 0, y: 50, w: 200 } })]);
    expect(texts(scene)[0]!.y).toBeCloseTo(50 + 0.7 * 100);
  });

  test("shadow adds two dark copies below the text", () => {
    const scene = sceneOf([text("a", "hi", { shadow: true })]);
    expect(texts(scene)).toHaveLength(3);
    expect(texts(scene)[2]!.fill).toBe("#ffffff");
  });

  test("shadow is skipped for dark ink", () => {
    const scene = sceneOf([text("a", "hi", { shadow: true, color: "#101010" })]);
    expect(texts(scene)).toHaveLength(1);
  });

  test("wrap mode emits one text node per line", () => {
    const scene = sceneOf([text("a", "satu dua tiga empat lima enam", { fit: { mode: "wrap", maxLines: 3 }, box: { x: 0, y: 0, w: 300 } })]);
    expect(texts(scene).length).toBeGreaterThan(1);
  });
});

describe("stat", () => {
  test("value and unit share a baseline and shrink together to the box", () => {
    const scene = sceneOf([{ id: "s", type: "stat", value: "{v}", unit: "kcal", label: "Energi", valueSize: 200, box: { x: 0, y: 0, w: 400 } }], { data: { v: "12345" } });
    const ts = texts(scene);
    expect(ts).toHaveLength(3);
    const value = ts.find((t) => t.text === "12345")!;
    const unit = ts.find((t) => t.text === "kcal")!;
    expect(value.size).toBeLessThan(200);
    expect(unit.y).toBe(value.y);
    expect(unit.x).toBeLessThanOrEqual(400);
  });

  test("missing label or unit just drop out; missing value hides the stat", () => {
    const base = { id: "s", type: "stat", value: "{v}", unit: "{u}", label: "{l}", box: { x: 0, y: 0, w: 400 } };
    expect(texts(sceneOf([base], { data: { v: 5 } })).map((t) => t.text)).toEqual(["5"]);
    expect(texts(sceneOf([base], { data: {} }))).toHaveLength(0);
  });
});

describe("stacks", () => {
  const row = (children: unknown[], extra: Record<string, unknown> = {}) => ({
    id: "g",
    type: "group",
    box: { x: 0, y: 0, w: 600, h: "auto" },
    layout: { kind: "stack", dir: "row", gap: 10, align: "start", ...extra },
    children,
  });
  const rect = (id: string, w: number, extra: Record<string, unknown> = {}) => ({
    id,
    type: "shape",
    shape: "rect",
    fill: "#ffffff",
    box: { x: 0, y: 0, w, h: 20 },
    ...extra,
  });

  const xs = (scene: ReturnType<typeof sceneOf>) => flat(scene.nodes).flatMap((n) => (n.k === "rect" ? [n.x] : []));

  test("lays children out with gap and reflows when one is hidden", () => {
    const children = [rect("a", 100), rect("b", 100, { when: { bind: "show", eq: true } }), rect("c", 100)];
    expect(xs(sceneOf([row(children)], { data: { show: true } }))).toEqual([0, 110, 220]);
    expect(xs(sceneOf([row(children)], { data: {} }))).toEqual([0, 110]);
  });

  test("fill children share the leftover main-axis space", () => {
    const scene = sceneOf([row([rect("a", 100), rect("f", 0, { box: { x: 0, y: 0, w: "fill", h: 20 } })])]);
    const rects = flat(scene.nodes).flatMap((n) => (n.k === "rect" ? [n] : []));
    expect(rects[1]!.w).toBe(490);
  });

  test("justify between and cross alignment", () => {
    const scene = sceneOf([row([rect("a", 100), rect("b", 100)], { justify: "between" })]);
    expect(xs(scene)).toEqual([0, 500]);
    const centered = sceneOf([row([rect("a", 100), { ...rect("b", 100), box: { x: 0, y: 0, w: 100, h: 60 } }], { align: "center" })]);
    const ys = flat(centered.nodes).flatMap((n) => (n.k === "rect" ? [n.y] : []));
    expect(ys).toEqual([20, 0]);
  });

  test("an empty group with no panel disappears; with a panel it stays", () => {
    const empty = { id: "g", type: "group", box: { x: 0, y: 0, w: 100, h: 100 }, children: [text("a", "{nope}")] };
    expect(sceneOf([empty, text("keep", "ok")]).nodes).toHaveLength(1);
    const panel = { ...empty, fill: "#ffffff", radius: 10 };
    expect(flat(sceneOf([panel]).nodes).some((n) => n.k === "rect")).toBe(true);
  });
});

describe("layers that need data", () => {
  test("ring without progress, chart with too few points, route with a short track are hidden", () => {
    const layers = [
      { id: "r", type: "ring", progress: { bind: "p" }, box: { x: 0, y: 0, w: 100, h: 100 } },
      { id: "l", type: "chart", kind: "line", series: { bind: "s" }, box: { x: 0, y: 0, w: 100, h: 100 } },
      { id: "b", type: "chart", kind: "bars", series: { bind: "none" }, box: { x: 0, y: 0, w: 100, h: 100 } },
      { id: "t", type: "route", points: { bind: "route" }, box: { x: 0, y: 0, w: 100, h: 100 } },
    ];
    const scene = sceneOf(layers, { data: { s: [1], route: [[-6.2, 106.8], [-6.2005, 106.8]] } });
    expect(scene.nodes).toHaveLength(0);
  });

  test("ring draws a track and an arc; progress above 1 adds an overflow lap", () => {
    const ring = (p: number) => sceneOf([{ id: "r", type: "ring", progress: { bind: "p" }, thickness: 20, box: { x: 0, y: 0, w: 200, h: 200 } }], { data: { p } });
    expect(ring(0.5).nodes).toHaveLength(2);
    expect(ring(1.4).nodes).toHaveLength(3);
    expect(ring(0).nodes).toHaveLength(1);
  });

  test("ring segments draw in order and cap at a full turn", () => {
    const scene = sceneOf(
      [{ id: "r", type: "ring", segments: [{ value: { bind: "a" }, color: "#ff0000" }, { value: { bind: "b" }, color: "#00ff00" }, { value: 5, color: "#0000ff" }], box: { x: 0, y: 0, w: 200, h: 200 } }],
      { data: { a: 0.3, b: 0.4 } },
    );
    expect(scene.nodes).toHaveLength(4);
  });

  test("route is trimmed by the privacy option and hidden when it leaves nothing", () => {
    const route = Array.from({ length: 21 }, (_, i) => [-6.2 + i * 0.001, 106.8]);
    const layer = { id: "t", type: "route", points: { bind: "route" }, box: { x: 0, y: 0, w: 400, h: 400 } };
    const full = sceneOf([layer], { data: { route }, options: { privacy: { routeTrimMeters: 0 } } });
    const trimmed = sceneOf([layer], { data: { route } });
    const longest = (s: typeof full) => Math.max(...flat(s.nodes).flatMap((n) => (n.k === "path" ? [n.d.length] : [])));
    expect(full.nodes.length).toBeGreaterThan(0);
    expect(trimmed.nodes.length).toBeGreaterThan(0);
    expect(longest(trimmed)).toBeLessThanOrEqual(longest(full));
    const short = sceneOf([layer], { data: { route: route.slice(0, 5) } });
    expect(short.nodes).toHaveLength(0);
  });

  test("bars: zero days draw a stub, null days are gaps, highlight picks the max", () => {
    const scene = sceneOf(
      [{ id: "c", type: "chart", kind: "bars", series: { bind: "s" }, highlight: "max", color: "#ff0000", color2: "#00ff00", box: { x: 0, y: 0, w: 300, h: 100 } }],
      { data: { s: [10, 0, null, 30, 20] } },
    );
    const bars = flat(scene.nodes).flatMap((n) => (n.k === "rect" ? [n] : []));
    expect(bars).toHaveLength(5);
    expect(bars.find((b) => b.fill === "#ff0000")!.h).toBe(100);
  });

  test("stack chart is clipped to a pill", () => {
    const scene = sceneOf([{ id: "c", type: "chart", kind: "stack", segments: [{ value: 1, color: "#ff0000" }, { value: 3, color: "#00ff00" }], barRadius: 30, box: { x: 0, y: 0, w: 400, h: 40 } }]);
    const group = scene.nodes[0]!;
    expect(group.k === "group" && group.clip?.rx).toBe(20);
  });
});

describe("background, options, brand", () => {
  test("transparent stays transparent; colors and gradients paint the canvas", () => {
    expect(sceneOf([text("a", "x")]).transparent).toBe(true);
    const colored = sceneOf([text("a", "x")], { data: {} }, { background: { kind: "color", color: "$bg" } });
    expect(colored.transparent).toBe(false);
    expect(colored.nodes[0]!.k).toBe("rect");
  });

  test("photo background uses the asset, falls back when it is missing", () => {
    const bg = { kind: "photo", scrim: { side: "bottom", color: "#000000", opacity: 0.5 }, fallback: { kind: "color", color: "#112233" } } as const;
    const withPhoto = sceneOf([text("a", "x")], { data: {}, assets: { photo: { uri: "file:///p.jpg" } } }, { background: bg });
    expect(withPhoto.needsImages).toEqual(["file:///p.jpg"]);
    expect(withPhoto.nodes.filter((n) => n.k === "rect")).toHaveLength(1);
    const without = sceneOf([text("a", "x")], { data: {} }, { background: bg });
    expect(without.needsImages).toEqual([]);
    expect(without.transparent).toBe(false);
  });

  test("watermark layers vanish when the option is off; attribution never does", () => {
    const layers = [text("w", "wm", { role: "watermark" }), text("a", "attr", { role: "attribution" })];
    expect(texts(sceneOf(layers, { data: {} })).map((t) => t.text)).toEqual(["wm", "attr"]);
    expect(texts(sceneOf(layers, { data: {}, options: { watermark: false } })).map((t) => t.text)).toEqual(["attr"]);
  });

  test("brand marks: logo paths, wordmark, link", () => {
    const scene = sceneOf([
      { id: "l", type: "brand", mark: "lockup", size: 50, box: { x: 0, y: 0 } },
      { id: "k", type: "brand", mark: "link", box: { x: 0, y: 100 } },
    ]);
    expect(flat(scene.nodes).some((n) => n.k === "path")).toBe(true);
    expect(texts(scene).map((t) => t.text)).toEqual(["TestApp", "test.app"]);
  });

  test("image layers need a bound image; missing means hidden", () => {
    const layer = { id: "i", type: "image", src: { bind: "photo" }, mask: "circle", box: { x: 0, y: 0, w: 200, h: 200 } };
    expect(sceneOf([layer]).nodes).toHaveLength(0);
    const scene = sceneOf([layer], { data: {}, assets: { photo: { uri: "x://y" } } });
    const img = scene.nodes[0]!;
    expect(img.k === "image" && img.rx).toBe(100);
  });

  test("rotation and opacity wrap the layer in a group", () => {
    const scene = sceneOf([text("a", "x", { rotation: -4, opacity: 0.5 })]);
    const group = scene.nodes[0]!;
    expect(group.k === "group" && group.opacity).toBe(0.5);
    expect(group.k === "group" && group.rotate?.deg).toBe(-4);
  });

  test("light and dark pick their own tokens", () => {
    const layers = [text("a", "x", { color: "$fg" })];
    const t = makeTemplate(layers, { themes: { dark: { colors: { fg: "#ffffff" } }, light: { colors: { fg: "#101010" } } } });
    const dark = resolve(t, { data: {} }, { ...TEST_CTX, mode: "dark" });
    const light = resolve(t, { data: {} }, { ...TEST_CTX, mode: "light" });
    expect(texts(dark)[0]!.fill).toBe("#ffffff");
    expect(texts(light)[0]!.fill).toBe("#101010");
  });
});

describe("availability", () => {
  test("requires and needsPhoto gate a template", () => {
    const t = makeTemplate([text("a", "x")], { requires: ["day.kcal"], meta: { needsPhoto: true } });
    expect(isAvailable(t, { data: { day: { kcal: 1 } } }, TEST_BRAND)).toBe(false);
    expect(isAvailable(t, { data: { day: { kcal: 1 } }, assets: { photo: { uri: "x" } } }, TEST_BRAND)).toBe(true);
    expect(isAvailable(t, { data: {}, assets: { photo: { uri: "x" } } }, TEST_BRAND)).toBe(false);
  });
});

describe("svg emitter", () => {
  test("escapes text, splits alpha, defines gradients", () => {
    const scene = sceneOf(
      [text("a", "{n}", { color: "$fg/50" })],
      { data: { n: "a < b & \"c\"" } },
      { background: { kind: "gradient", angle: 90, stops: [{ at: 0, color: "#000000" }, { at: 1, color: "#ffffff80" }] } },
    );
    const svg = toSvg(scene, { fonts: TEST_FONTS });
    expect(svg).toContain("a &lt; b &amp; &quot;c&quot;");
    expect(svg).toContain('fill-opacity="0.502"');
    expect(svg).toContain("<linearGradient");
    expect(svg).toContain('stop-opacity="0.502"');
    expect(svg.startsWith("<svg")).toBe(true);
  });
});
