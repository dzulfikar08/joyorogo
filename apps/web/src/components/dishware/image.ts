const MAX_EDGE = 1024;

export type DishwareImage = { base64: string; mimeType: "image/jpeg"; previewUrl: string };

/** Registration photo: resized to <= 1024 px and encoded as JPEG (same cap as the scan photos). */
export async function fileToDishwareImage(file: File, failed: string): Promise<DishwareImage> {
  const source = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    source.close();
    throw new Error(failed);
  }
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "medium";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error(failed);
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return {
    base64: url.slice(url.indexOf(",") + 1),
    mimeType: "image/jpeg",
    previewUrl: URL.createObjectURL(blob),
  };
}
