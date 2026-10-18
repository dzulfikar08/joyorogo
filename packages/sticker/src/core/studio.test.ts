import { describe, expect, test } from "bun:test";

import { applyOp, createHistory, createUserTemplate, HISTORY_LIMIT, pushOp, redo, undo } from "./studio";
import { makeTemplate } from "./test-kit";

const base = () =>
  makeTemplate([
    { id: "title", type: "text", value: "{a}", box: { x: 10, y: 10, w: 300 } },
    { id: "g", type: "group", box: { x: 0, y: 100 }, children: [{ id: "inner", type: "text", value: "x", box: { x: 0, y: 0, w: 100 } }] },
  ]);

describe("editor ops", () => {
  test("add / move / resize / restyle / rebind / reorder / remove", () => {
    let t = base();
    const step = (op: Parameters<typeof applyOp>[1]) => {
      const r = applyOp(t, op);
      if (!r.ok) throw new Error(r.reason);
      t = r.template;
    };
    step({ op: "addLayer", layer: { id: "title", type: "shape", shape: "rect", box: { x: 0, y: 0, w: 10, h: 10 } } });
    expect(t.layers.map((l) => l.id)).toEqual(["title", "g", "title-2"]);
    step({ op: "addLayer", parentId: "g", layer: { id: "n", type: "icon", name: "flame", box: { x: 0, y: 0, w: 40, h: 40 } }, index: 0 });
    const group = t.layers[1]!;
    expect(group.type === "group" && group.children.map((c) => c.id)).toEqual(["n", "inner"]);
    step({ op: "moveLayer", id: "inner", x: 5, y: 6 });
    step({ op: "resizeLayer", id: "title", w: 640, h: "auto" });
    step({ op: "restyle", id: "title", patch: { color: "$accent", size: 90 } });
    step({ op: "rebind", id: "title", field: "value", value: "{day.kcal|int}" });
    step({ op: "reorderLayer", id: "title-2", index: 0 });
    expect(t.layers[0]!.id).toBe("title-2");
    const title = t.layers.find((l) => l.id === "title")!;
    expect(title.type === "text" && [title.size, title.color, title.value, title.box.w]).toEqual([90, "$accent", "{day.kcal|int}", 640]);
    step({ op: "removeLayer", id: "n" });
    step({ op: "setCanvas", height: 1920, aspect: "story" });
    step({ op: "setTheme", mode: "dark", colors: { accent: "#ff8800" } });
    step({ op: "setBackground", background: { kind: "color", color: "$bg" } });
    expect(t.canvas.height).toBe(1920);
    expect(t.themes.dark.colors.accent).toBe("#ff8800");
  });

  test("invalid edits are rejected and the template is untouched", () => {
    const t = base();
    const before = JSON.stringify(t);
    const bad = [
      { op: "restyle", id: "title", patch: { color: "nope" } },
      { op: "restyle", id: "title", patch: { type: "icon" } },
      { op: "restyle", id: "ghost", patch: {} },
      { op: "rebind", id: "title", field: "value", value: 5 },
      { op: "addLayer", layer: { type: "nope" } },
      { op: "addLayer", layer: null },
      { op: "addLayer", parentId: "title", layer: { id: "x", type: "icon", name: "flame", box: { x: 0, y: 0 } } },
      { op: "moveLayer", id: "title", x: Number.NaN, y: 0 },
      { op: "setCanvas", height: 5000, aspect: "free" },
      { op: "setCanvas", height: 1000, aspect: "story" },
      { op: "setBackground", background: { kind: "photo" } },
      { op: "setTheme", mode: "dark", colors: { fg: "nope" } },
    ] as const;
    for (const op of bad) expect(applyOp(t, op as never).ok).toBe(false);
    expect(JSON.stringify(t)).toBe(before);
  });

  test("the last layer cannot be removed", () => {
    const one = makeTemplate([{ id: "a", type: "text", value: "x", box: { x: 0, y: 0, w: 10 } }]);
    expect(applyOp(one, { op: "removeLayer", id: "a" }).ok).toBe(false);
  });
});

describe("history", () => {
  test("undo and redo, redo is dropped by a new edit, rejected ops leave it unchanged", () => {
    let h = createHistory(base());
    h = pushOp(h, { op: "moveLayer", id: "title", x: 1, y: 1 }).history;
    h = pushOp(h, { op: "moveLayer", id: "title", x: 2, y: 2 }).history;
    expect(h.past).toHaveLength(2);
    h = undo(h);
    expect(h.present.layers[0]!.box.x).toBe(1);
    h = redo(h);
    expect(h.present.layers[0]!.box.x).toBe(2);
    h = undo(undo(h));
    expect(h.present.layers[0]!.box.x).toBe(10);
    expect(undo(h)).toBe(h);
    h = pushOp(h, { op: "moveLayer", id: "title", x: 99, y: 0 }).history;
    expect(h.future).toHaveLength(0);
    expect(redo(h)).toBe(h);
    const rejected = pushOp(h, { op: "removeLayer", id: "ghost" });
    expect(rejected.result.ok).toBe(false);
    expect(rejected.history).toBe(h);
  });

  test("history is capped", () => {
    let h = createHistory(base());
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) h = pushOp(h, { op: "moveLayer", id: "title", x: i, y: 0 }).history;
    expect(h.past).toHaveLength(HISTORY_LIMIT);
  });
});

describe("user templates", () => {
  test("forking keeps the base id and gets its own", () => {
    const user = createUserTemplate(base(), "Punyaku", 1000, () => "abc");
    expect(user.id).toBe("u-abc");
    expect(user.template.id).toBe("u-abc");
    expect(user.baseId).toBe("test.template");
    expect(user.sync).toBe("local");
  });
});
