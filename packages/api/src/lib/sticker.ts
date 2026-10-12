// Stiker piring: background-removed dish cutouts (the plate-diary gimmick).
// The raw upload is passed straight into the Images binding transform and
// never persisted — only the transparent PNG cutout lands in R2.

/** 32 hex chars — unguessable capability id, also the R2 object key. */
export const SCAN_ID_RE = /^[a-f0-9]{32}$/;

export function newScanId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function stickerKey(scanId: string): string {
  return `scans/${scanId}.png`;
}

// Minimal shape of the Workers `images` binding (transform + output only).
export type ImagesBinding = {
  input(value: ArrayBuffer): {
    transform(options: Record<string, unknown>): {
      output(options: Record<string, unknown>): Promise<{ response(): Response }>;
    };
  };
};

export type StickersBucket = {
  put(
    key: string,
    value: ArrayBuffer | ReadableStream | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; size: number } | null>;
  delete(key: string): Promise<void>;
};

/**
 * Runs BiRefNet saliency segmentation via the Images binding and returns the
 * cutout PNG bytes, or null when the binding is missing or the transform
 * fails — the scan itself must never fail because of the gimmick.
 */
export async function makeSticker(
  images: ImagesBinding | undefined,
  bytes: ArrayBuffer,
): Promise<ArrayBuffer | null> {
  if (!images) return null;
  try {
    const result = await images
      .input(bytes)
      .transform({ width: 720, segment: "foreground" })
      .output({ format: "image/png" });
    const response = result.response();
    if (!response.ok) return null;
    return await response.arrayBuffer();
  } catch {
    return null;
  }
}

export function base64ToBytes(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
