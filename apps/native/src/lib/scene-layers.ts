import type { ImageNode, SceneNode } from "@joyorogo/sticker";

/**
 * react-native-svg's Image reports neither failures nor (reliably, on Android) loads, so
 * top-level image nodes are painted by React Native's own Image, whose onLoad/onError are
 * dependable. Everything between two images stays in one Svg, so paint order is kept:
 * [svg, image, svg, ...] stacked back to front.
 */
export type SceneLayer = { kind: "svg"; nodes: SceneNode[] } | { kind: "image"; node: ImageNode };

export function splitSceneLayers(nodes: SceneNode[]): SceneLayer[] {
  const layers: SceneLayer[] = [];
  let run: SceneNode[] = [];
  for (const node of nodes) {
    if (node.k === "image") {
      if (run.length) layers.push({ kind: "svg", nodes: run });
      run = [];
      layers.push({ kind: "image", node });
    } else {
      run.push(node);
    }
  }
  if (run.length) layers.push({ kind: "svg", nodes: run });
  return layers;
}

/** Image URIs drawn inside groups (clip, rotation, opacity); these stay in the Svg and cannot be observed. */
export function nestedImageUris(nodes: SceneNode[]): string[] {
  const out: string[] = [];
  const walk = (list: SceneNode[], inGroup: boolean) => {
    for (const node of list) {
      if (node.k === "group") walk(node.children, true);
      else if (node.k === "image" && inGroup) out.push(node.uri);
    }
  };
  walk(nodes, false);
  return out;
}
