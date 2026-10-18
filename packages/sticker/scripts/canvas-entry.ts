// Bundled for the browser by the harness: exposes the Canvas painter on window.
import { paintScene, type Canvas2D } from "../src/core/emit-canvas";
import type { Scene } from "../src/core/scene";
import type { FontMap } from "../src/core/text";

declare global {
  interface Window {
    __paintScene(scene: Scene, fonts: Record<string, { family: string; weight?: number }>, images: Record<string, string>): Promise<void>;
  }
}

window.__paintScene = async (scene, fonts, images) => {
  document.body.innerHTML = "";
  const canvas = document.createElement("canvas");
  canvas.width = scene.width;
  canvas.height = scene.height;
  canvas.style.display = "block";
  document.body.appendChild(canvas);
  const loaded = new Map<string, HTMLImageElement>();
  await Promise.all(
    Object.entries(images).map(
      ([uri, href]) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            loaded.set(uri, img);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = href;
        }),
    ),
  );
  const fontMap: FontMap = {
    metrics: () => {
      throw new Error("metrics are not needed while painting");
    },
    paint: (role, weight) => fonts[`${role}|${weight}`] ?? { family: "sans-serif" },
  };
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  paintScene(ctx as unknown as Canvas2D, scene, {
    fonts: fontMap,
    image: (uri) => loaded.get(uri),
    path2D: (d) => new Path2D(d),
  });
};
