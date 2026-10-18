import { paintScene, rogoWebFonts, WEB_MONO_FAMILY, WEB_SANS_FAMILY, type Canvas2D, type Scene } from "@joyorogo/sticker";

/**
 * Web painter glue: wait for fonts, load images (downscaled), draw a Scene onto a
 * canvas at its fixed design size (1080 wide), independent of the screen.
 */

/** Longest side a photo is decoded at; a 1080 px card never needs more than 2x. */
export const PHOTO_MAX_SIDE = 2048;

export async function ensureStickerFonts(): Promise<void> {
  const loads = [
    ...[500, 600, 700, 800].map((w) => `${w} 40px "${WEB_SANS_FAMILY}"`),
    ...[400, 500, 700].map((w) => `${w} 40px "${WEB_MONO_FAMILY}"`),
  ];
  const results = await Promise.all(loads.map((font) => document.fonts.load(font).then((f) => f.length > 0, () => false)));
  if (results.includes(false)) throw new Error("fonts not available");
}

/** Fetches (with the session cookie, photos are private) and decodes; large photos are shrunk before they are kept. */
export async function loadBitmap(src: string): Promise<ImageBitmap> {
  const res = await fetch(src, { credentials: "include" });
  if (!res.ok) throw new Error(`image ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob());
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= PHOTO_MAX_SIDE) return bitmap;
  const k = PHOTO_MAX_SIDE / longest;
  const small = document.createElement("canvas");
  small.width = Math.round(bitmap.width * k);
  small.height = Math.round(bitmap.height * k);
  const ctx = small.getContext("2d");
  if (!ctx) return bitmap;
  ctx.drawImage(bitmap, 0, 0, small.width, small.height);
  bitmap.close();
  return createImageBitmap(small);
}

export type SceneImages = Map<string, ImageBitmap>;

/** Loads every image the scene draws; one failing image rejects (the sheet shows a retry). */
export async function loadSceneImages(scene: Scene, cache: SceneImages): Promise<SceneImages> {
  await Promise.all(
    scene.needsImages.map(async (uri) => {
      if (!cache.has(uri)) cache.set(uri, await loadBitmap(uri));
    }),
  );
  return cache;
}

/** Draws the scene onto `canvas` (resized to the scene) and resolves when done. */
export function drawScene(canvas: HTMLCanvasElement, scene: Scene, images: SceneImages): void {
  canvas.width = scene.width;
  canvas.height = scene.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");
  ctx.clearRect(0, 0, scene.width, scene.height);
  paintScene(ctx as unknown as Canvas2D, scene, {
    fonts: rogoWebFonts,
    image: (uri) => images.get(uri),
    path2D: (d) => new Path2D(d),
  });
}
