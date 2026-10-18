import { describe, expect, test } from "bun:test";

import { fallbackTemplate, parseTemplate } from "./parse";
import { migrate } from "./migrate";
import { makeTemplate } from "./test-kit";

const text = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "text",
  value: "hi",
  box: { x: 0, y: 0, w: 200 },
  ...extra,
});

const header = {
  schemaVersion: 1,
  id: "t.one",
  name: "T",
  kind: "test",
  style: "minimal",
  canvas: { width: 1080, height: 1080, aspect: "square" },
  background: { kind: "transparent" },
  themes: { dark: { colors: {} }, light: { colors: {} } },
};

describe("parseTemplate", () => {
  test("fills defaults and keeps valid layers", () => {
    const t = makeTemplate([text("a")]);
    expect(t.layers).toHaveLength(1);
    const layer = t.layers[0]!;
    expect(layer.type === "text" && layer.size).toBe(40);
    expect(t.constraints.minFontSize).toBe(22);
  });

  test("drops unknown and invalid layers with an issue each, keeps the rest", () => {
    const result = parseTemplate({
      ...header,
      layers: [
        text("ok"),
        { id: "w", type: "hologram", box: { x: 0, y: 0 } },
        text("bad-color", { color: "not-a-color" }),
        { id: "icon", type: "icon", name: "no-such-icon", box: { x: 0, y: 0 } },
        text("bad-box", { box: { x: 0, y: 0, w: -4 } }),
        "garbage",
        null,
      ],
    });
    expect(result.degraded).toBe(false);
    expect(result.template.layers.map((l) => l.id)).toEqual(["ok"]);
    expect(result.issues.map((i) => i.code).sort()).toEqual([
      "invalid-layer",
      "invalid-layer",
      "unknown-icon",
      "unknown-layer",
      "unknown-layer",
      "unknown-layer",
    ]);
  });

  test("a bad child never kills its group", () => {
    const result = parseTemplate({
      ...header,
      layers: [{ id: "g", type: "group", box: { x: 0, y: 0 }, children: [text("c1"), { type: "nope" }, text("c2")] }],
    });
    const group = result.template.layers[0]!;
    expect(group.type === "group" && group.children.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(result.issues).toHaveLength(1);
  });

  test("falls back when the header is invalid, never throws", () => {
    for (const raw of [null, undefined, 42, "x", [], {}, { ...header, canvas: { width: 500, height: 1080, aspect: "square" } }, { ...header, id: "Bad Id" }]) {
      const result = parseTemplate(raw);
      expect(result.degraded).toBe(true);
      expect(result.template.id).toBe(fallbackTemplate().id);
      expect(result.template.layers.length).toBeGreaterThan(0);
    }
  });

  test("rejects an aspect that disagrees with the height", () => {
    const result = parseTemplate({ ...header, canvas: { width: 1080, height: 1000, aspect: "square" }, layers: [text("a")] });
    expect(result.degraded).toBe(true);
    expect(result.issues[0]?.code).toBe("invalid-header");
  });

  test("falls back when no layer survives", () => {
    const result = parseTemplate({ ...header, layers: [{ type: "nope" }] });
    expect(result.degraded).toBe(true);
    expect(result.issues.at(-1)?.code).toBe("no-layers");
  });

  test("a newer schema version degrades with too-new", () => {
    const result = parseTemplate({ ...header, schemaVersion: 99, layers: [text("a")] });
    expect(result.degraded).toBe(true);
    expect(result.issues[0]?.code).toBe("too-new");
  });

  test("renames duplicate ids and caps the layer budget", () => {
    const result = parseTemplate({
      ...header,
      constraints: { maxLayers: 2 },
      layers: [text("a"), text("a"), text("b")],
    });
    expect(result.template.layers.map((l) => l.id)).toEqual(["a", "a-2"]);
    expect(result.issues.map((i) => i.code)).toEqual(["duplicate-id", "too-many-layers"]);
  });

  test("accepts token colors with alpha and rejects out-of-range alpha", () => {
    const ok = makeTemplate([text("a", { color: "$fg/60" })]);
    expect(ok.layers).toHaveLength(1);
    const bad = parseTemplate({ ...header, layers: [text("a"), text("b", { color: "$fg/160" })] });
    expect(bad.template.layers.map((l) => l.id)).toEqual(["a"]);
  });

  test("group nesting is capped", () => {
    let node: unknown = text("leaf");
    for (let i = 0; i < 12; i++) node = { id: `g${i}`, type: "group", box: { x: 0, y: 0 }, children: [node] };
    const result = parseTemplate({ ...header, layers: [node] });
    expect(result.degraded).toBe(false);
  });
});

describe("migrate", () => {
  const doc = (v: number) => ({ schemaVersion: v, marker: [] as string[] });

  test("runs the chain in order and stamps the version", () => {
    const table = {
      1: (raw: Record<string, unknown>) => ({ ...raw, marker: [...(raw.marker as string[]), "1to2"] }),
      2: (raw: Record<string, unknown>) => ({ ...raw, marker: [...(raw.marker as string[]), "2to3"] }),
    };
    const result = migrate(doc(1), table, 3);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.raw.schemaVersion).toBe(3);
      expect(result.raw.marker).toEqual(["1to2", "2to3"]);
      expect(result.from).toBe(1);
    }
  });

  test("does not mutate its input", () => {
    const input = doc(1);
    migrate(input, { 1: (raw) => ({ ...raw, marker: ["x"] }) }, 2);
    expect(input.marker).toEqual([]);
  });

  test("missing step, throwing step, too-new and invalid input are reported, not thrown", () => {
    expect(migrate(doc(1), {}, 2).status).toBe("failed");
    const thrown = migrate(doc(1), { 1: () => { throw new Error("boom"); } }, 2);
    expect(thrown.status).toBe("failed");
    expect(migrate(doc(5), {}, 2).status).toBe("too-new");
    for (const bad of [null, [], "x", { schemaVersion: "1" }, { schemaVersion: 0 }, { schemaVersion: 1.5 }, {}]) {
      expect(migrate(bad, {}, 1).status).toBe("invalid");
    }
  });

  test("a failing migration degrades parseTemplate to the fallback", () => {
    const result = parseTemplate({ ...header, schemaVersion: 0 }, {});
    expect(result.degraded).toBe(true);
  });
});
