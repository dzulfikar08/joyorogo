import { i18n } from "@joyorogo/i18n";

const LONG_EDGE = 1600;

export type PendingPhoto = { localUrl: string; base64: string; mimeType: "image/jpeg" };

/**
 * Kompres ke sisi panjang ~1600px JPEG kualitas 0.8 lewat canvas; balikin
 * base64 murni (tanpa prefiks data URL) untuk unggahan. Menggambar ulang ke
 * canvas membuang EXIF (lokasi, waktu) dan menerapkan orientasinya.
 */
export async function compressImage(file: File): Promise<PendingPhoto> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, LONG_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(i18n.t("feed:composer.error.noCanvas"));
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return { localUrl: dataUrl, base64, mimeType: "image/jpeg" };
}
