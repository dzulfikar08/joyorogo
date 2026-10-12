/** [ymin, xmin, ymax, xmax] on a 0-1000 grid, as ai.analyzeFood returns it. */
export type ItemBox = readonly [number, number, number, number];

/**
 * Cuts each boxed item out of the local photo for the review screen. The
 * server makes the background-removed stickers after saving; this is the
 * instant preview, so it never waits on the network. Unboxed items map to null.
 */
export async function cropItems(
  photoUrl: string,
  boxes: ReadonlyArray<ItemBox | undefined | null>,
): Promise<Array<string | null>> {
  const img = new Image();
  img.src = photoUrl;
  await img.decode();
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  return boxes.map((box) => {
    if (!box) return null;
    const [y0, x0, y1, x1] = box;
    const left = Math.floor((x0 * W) / 1000);
    const top = Math.floor((y0 * H) / 1000);
    const width = Math.ceil(((x1 - x0) * W) / 1000);
    const height = Math.ceil(((y1 - y0) * H) / 1000);
    if (width < 8 || height < 8) return null;
    // Thumbnails only: cap the long side so 8 crops stay light.
    const scale = Math.min(1, 320 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, left, top, width, height, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  });
}
