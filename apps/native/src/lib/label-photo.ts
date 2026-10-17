import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

/** Longest side of a label photo sent to the reader; the server accepts up to 8 MB of base64. */
const LABEL_MAX_SIDE = 1280;
const LABEL_JPEG_QUALITY = 0.8;

export type EncodedPhoto = { imageBase64: string; mimeType: "image/jpeg" };

/**
 * Downscales a captured or picked photo so its longest side is at most 1280 px
 * and encodes it once as a JPEG (quality 0.8), the same resize + single encode
 * the plate scan does. Returns plain base64, no data: prefix; null when the
 * encoder yields nothing.
 */
export async function encodeLabelPhoto(
  uri: string,
  width: number,
  height: number,
): Promise<EncodedPhoto | null> {
  let context = ImageManipulator.manipulate(uri);
  if (Math.max(width, height) > LABEL_MAX_SIDE) {
    context =
      height >= width
        ? context.resize({ height: LABEL_MAX_SIDE })
        : context.resize({ width: LABEL_MAX_SIDE });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    compress: LABEL_JPEG_QUALITY,
    format: SaveFormat.JPEG,
    base64: true,
  });
  if (!saved.base64) return null;
  return { imageBase64: saved.base64, mimeType: "image/jpeg" };
}
