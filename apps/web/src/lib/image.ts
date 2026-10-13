// Client-side image prep for AI scans: downscale to <= maxSide and encode
// JPEG base64 once, so uploads stay in the ~0.2-0.5 MB range the server
// accepts (mirrors the native app's ImageManipulator pass).

export type PreparedImage = {
  base64: string;
  mimeType: "image/jpeg";
};

function canvasToJpeg(canvas: HTMLCanvasElement): PreparedImage {
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), mimeType: "image/jpeg" };
}

/** Longest side clamped to maxSide; never upscales. */
function scaledSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  const scale = longest > maxSide ? maxSide / longest : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function drawCanvas(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxSide: number,
): HTMLCanvasElement {
  const { width, height } = scaledSize(sourceWidth, sourceHeight, maxSide);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Kanvas tidak tersedia di browser ini.");
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

/** File input / drag-drop path. */
export async function prepareImageFile(file: File, maxSide = 1024): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    return canvasToJpeg(drawCanvas(bitmap, bitmap.width, bitmap.height, maxSide));
  } finally {
    bitmap.close();
  }
}

/** Live camera path: grab the current frame of a playing <video>. */
export function prepareVideoFrame(video: HTMLVideoElement, maxSide = 1024): PreparedImage {
  if (video.videoWidth === 0 || video.videoHeight === 0) {
    throw new Error("Kamera belum siap. Coba lagi sebentar.");
  }
  return canvasToJpeg(drawCanvas(video, video.videoWidth, video.videoHeight, maxSide));
}
