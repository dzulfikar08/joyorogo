// Stiker piring: background-removed dish cutouts (the plate-diary gimmick),
// one per detected item, cut from the photo with the vision model's box.
// The original photo is kept privately per user (photos/<userId>/<id>.jpg)
// once the meal is saved; scans that are never saved store nothing.

/** 32 hex chars — unguessable capability id, also the R2 object key. */
export const SCAN_ID_RE = /^[a-f0-9]{32}$/;

export function newScanId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function stickerKey(scanId: string): string {
  return `scans/${scanId}.png`;
}

/** Original photos are private: the key embeds the owner, the route checks it. */
export function photoKey(userId: string, photoId: string): string {
  return `photos/${userId}/${photoId}.jpg`;
}

/**
 * Pending-scan originals kept server-side for "Hitung ulang" (re-analyze):
 * the retry sends only the id, never the photo again. Keys embed the owner
 * (a privacy wipe lists them) and are ext-less — the mime rides in the
 * object's httpMetadata. Short-lived by design: point a bucket lifecycle
 * rule at the scan-src/ prefix (1 day is plenty) so abandoned scans expire.
 */
export function scanSrcKey(userId: string, photoId: string): string {
  return `scan-src/${userId}/${photoId}`;
}

export function scanSrcPrefix(userId: string): string {
  return `scan-src/${userId}/`;
}

export function photoPrefix(userId: string): string {
  return `photos/${userId}/`;
}

/** VAR perut photos are private the same way: the key embeds the owner. */
export function varPhotoKey(userId: string, photoId: string): string {
  return `var/${userId}/${photoId}.jpg`;
}

export function varPhotoPrefix(userId: string): string {
  return `var/${userId}/`;
}

type ImagesTransformer = {
  transform(options: Record<string, unknown>): ImagesTransformer;
  output(options: Record<string, unknown>): Promise<{ response(): Response }>;
};

// Minimal shape of the Workers `images` binding (info + transform + output).
export type ImagesBinding = {
  info(value: ReadableStream): Promise<{ width?: number; height?: number }>;
  input(value: ArrayBuffer | ReadableStream): ImagesTransformer;
};

export type CropRect = { left: number; top: number; width: number; height: number };

/**
 * Pixel crop for a [ymin, xmin, ymax, xmax] 0-1000 box, padded a little so
 * the segmentation has some background to separate from, clamped to the photo.
 * Null when the box covers too few pixels to make a useful sticker.
 */
export function cropRect(
  box: readonly [number, number, number, number],
  width: number,
  height: number,
  /** Padding on the same 0-1000 grid (20 = 2% of the photo per side). */
  pad = 20,
): CropRect | null {
  const [y0, x0, y1, x1] = box;
  // Integer grid math: 0.82 * 1000 is 820.0000000000001 in floats.
  const left = Math.max(0, Math.floor(((x0 - pad) * width) / 1000));
  const top = Math.max(0, Math.floor(((y0 - pad) * height) / 1000));
  const right = Math.min(width, Math.ceil(((x1 + pad) * width) / 1000));
  const bottom = Math.min(height, Math.ceil(((y1 + pad) * height) / 1000));
  if (right - left < 24 || bottom - top < 24) return null;
  return { left, top, width: right - left, height: bottom - top };
}

export type StickersBucket = {
  put(
    key: string,
    value: ArrayBuffer | ReadableStream | string,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  get(key: string): Promise<{
    body: ReadableStream;
    size: number;
    arrayBuffer(): Promise<ArrayBuffer>;
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  } | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options: {
    prefix: string;
    cursor?: string;
  }): Promise<{ objects: Array<{ key: string }>; truncated: boolean; cursor?: string }>;
};

/**
 * Runs BiRefNet saliency segmentation via the Images binding and returns the
 * cutout PNG bytes, or null when the binding is missing or the transform
 * fails — the scan itself must never fail because of the gimmick. With a
 * crop, only that region of the photo is segmented (one sticker per item).
 */
export async function makeSticker(
  images: ImagesBinding | undefined,
  bytes: ArrayBuffer,
  crop?: CropRect,
): Promise<ArrayBuffer | null> {
  if (!images) return null;
  try {
    const source = images.input(bytes);
    const result = await (crop ? source.transform({ trim: crop }) : source)
      .transform({ width: crop ? 480 : 720, segment: "foreground" })
      .output({ format: "image/png" });
    const response = result.response();
    if (!response.ok) return null;
    return await response.arrayBuffer();
  } catch {
    return null;
  }
}

export type StickerJob = { scanId: string; box?: readonly [number, number, number, number] };

/**
 * Background work after a scan is saved: one cutout per item, in parallel.
 * Boxed items are cropped first; an unboxed job segments the whole photo.
 * Failures leave that sticker missing; the diary falls back to an icon.
 */
export async function storeStickers(
  images: ImagesBinding | undefined,
  bucket: StickersBucket,
  bytes: ArrayBuffer,
  jobs: readonly StickerJob[],
): Promise<void> {
  if (!images || jobs.length === 0) return;
  let size: { width?: number; height?: number } = {};
  if (jobs.some((job) => job.box)) {
    try {
      size = await images.info(new Blob([bytes]).stream());
    } catch {
      size = {};
    }
  }
  await Promise.all(
    jobs.map(async (job) => {
      const crop =
        job.box && size.width && size.height ? cropRect(job.box, size.width, size.height) : null;
      // A boxed item whose crop is unusable gets no sticker rather than the whole plate.
      if (job.box && !crop) return;
      const png = await makeSticker(images, bytes, crop ?? undefined);
      if (!png) return;
      try {
        await bucket.put(stickerKey(job.scanId), png, {
          httpMetadata: { contentType: "image/png" },
        });
      } catch {
        // missing sticker is harmless
      }
    }),
  );
}

export function base64ToBytes(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Inverse of base64ToBytes, chunked so large photos cannot blow the stack. */
export function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
