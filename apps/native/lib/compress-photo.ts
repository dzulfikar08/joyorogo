import type * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import { i18n } from "@joyorogo/i18n";

const LONG_EDGE = 1600;

export type PendingPhoto = { localUri: string; base64: string };

/**
 * Kompres satu foto ke sisi panjang ~1600px JPEG kualitas 0.8; balikin
 * base64 untuk unggahan. Menyimpan ulang lewat manipulator membuang EXIF
 * (lokasi, waktu) dari berkas aslinya.
 */
export async function compressPhoto(asset: ImagePicker.ImagePickerAsset): Promise<PendingPhoto> {
  const scale = Math.min(1, LONG_EDGE / Math.max(asset.width, asset.height));
  const width = Math.max(1, Math.round(asset.width * scale));
  const height = Math.max(1, Math.round(asset.height * scale));
  const rendered = await ImageManipulator.manipulate(asset.uri)
    .resize({ width, height })
    .renderAsync();
  const out = await rendered.saveAsync({
    base64: true,
    compress: 0.8,
    format: SaveFormat.JPEG,
  });
  if (!out.base64) throw new Error(i18n.t("feed:composer.error.emptyPhoto"));
  return { localUri: out.uri, base64: out.base64 };
}
