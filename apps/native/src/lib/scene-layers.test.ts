import { describe, expect, test } from "bun:test";

import type { SceneNode } from "@joyorogo/sticker";

import { nestedImageUris, splitSceneLayers } from "./scene-layers";

const rect = (x: number): SceneNode => ({ k: "rect", x, y: 0, w: 10, h: 10, fill: "#ffffff" });
const image = (uri: string): SceneNode => ({ k: "image", x: 0, y: 0, w: 10, h: 10, uri, fit: "cover" });

describe("splitSceneLayers", () => {
  test("keeps paint order: svg run, image, svg run", () => {
    const layers = splitSceneLayers([rect(1), rect(2), image("a"), rect(3), image("b")]);
    expect(layers.map((l) => l.kind)).toEqual(["svg", "image", "svg", "image"]);
    expect(layers[0]).toMatchObject({ nodes: [{ x: 1 }, { x: 2 }] });
    expect(layers[1]).toMatchObject({ node: { uri: "a" } });
  });

  test("an image first or only produces no empty svg layers", () => {
    expect(splitSceneLayers([image("a")]).map((l) => l.kind)).toEqual(["image"]);
    expect(splitSceneLayers([])).toEqual([]);
    expect(splitSceneLayers([image("a"), image("b")]).map((l) => l.kind)).toEqual(["image", "image"]);
  });

  test("images inside groups stay in the svg and are reported as nested", () => {
    const nodes: SceneNode[] = [rect(1), { k: "group", children: [image("deep"), rect(2)], opacity: 0.5 }, image("top")];
    expect(splitSceneLayers(nodes).map((l) => l.kind)).toEqual(["svg", "image"]);
    expect(nestedImageUris(nodes)).toEqual(["deep"]);
  });
});
