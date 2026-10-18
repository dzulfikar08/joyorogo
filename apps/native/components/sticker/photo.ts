import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Image } from "react-native";

/** Longest side a photo is rendered at; a 1080 px card never needs more than 2x. */
export const PHOTO_MAX_SIDE = 2048;

function sizeOf(uri: string): Promise<{ width: number; height: number }> {
  const { promise, resolve, reject } = Promise.withResolvers<{ width: number; height: number }>();
  Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  return promise;
}

/**
 * Downscales a photo before it is mounted so a 48 MP camera shot is never decoded at
 * full size for the preview and again for the capture. Returns the original URI when it
 * is already small (and for remote or unreadable images, which the painter handles).
 */
export async function downscalePhoto(uri: string): Promise<{ uri: string; scaled: boolean }> {
  try {
    const { width, height } = await sizeOf(uri);
    if (Math.max(width, height) <= PHOTO_MAX_SIDE) return { uri, scaled: false };
    const context = ImageManipulator.manipulate(uri);
    context.resize(height >= width ? { height: PHOTO_MAX_SIDE } : { width: PHOTO_MAX_SIDE });
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ compress: 0.9, format: SaveFormat.JPEG });
    return { uri: saved.uri, scaled: true };
  } catch {
    return { uri, scaled: false };
  }
}
