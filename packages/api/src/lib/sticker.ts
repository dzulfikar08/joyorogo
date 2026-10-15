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

/** Feed post photos (posts/<userId>/<photoId>.jpg), see routers/social.ts. */
export function postPhotoPrefix(userId: string): string {
  return `posts/${userId}/`;
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
  /** Output width; defaults to 480 for a cropped item and 720 for a whole photo. */
  width?: number,
): Promise<ArrayBuffer | null> {
  if (!images) return null;
  try {
    const source = images.input(bytes);
    const result = await (crop ? source.transform({ trim: crop }) : source)
      .transform({ width: width ?? (crop ? 480 : 720), segment: "foreground" })
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

/**
 * Cutout of one boxed item, made while the user is still reviewing the scan.
 * Lives under scan-src/ (bucket lifecycle expires it if the scan is never
 * saved); food.addScan copies it to scans/ on save. Same capability-id idea
 * as stickerKey; the owner rides in the object's customMetadata.
 */
export function pendingStickerKey(scanId: string): string {
  return `scan-src/stk/${scanId}.png`;
}

type StickerBox = readonly [number, number, number, number];
export type PhotoSize = { width?: number; height?: number };

/** Pixel size of a photo through the Images binding; empty when unreadable. */
export async function readPhotoSize(images: ImagesBinding, bytes: ArrayBuffer): Promise<PhotoSize> {
  try {
    return await images.info(new Blob([bytes]).stream());
  } catch {
    return {};
  }
}

/** Crops `box` out of the photo and segments it; null when unusable or failed. */
export async function makeBoxSticker(
  images: ImagesBinding,
  bytes: ArrayBuffer,
  box: StickerBox,
  /** Photo size when the caller already read it; saves one Images call per box. */
  knownSize?: PhotoSize,
): Promise<ArrayBuffer | null> {
  const size = knownSize ?? (await readPhotoSize(images, bytes));
  const crop = size.width && size.height ? cropRect(box, size.width, size.height) : null;
  return crop ? makeSticker(images, bytes, crop) : null;
}

/** One foreground segmentation of the whole photo, shared by every item's quick sticker. */
export type WholeCutout = { png: ArrayBuffer; width: number; height: number; doneAt: number };

/** The whole cutout is made at the photo's own width, never wider than this. */
const WHOLE_MAX_WIDTH = 1024;

/**
 * Segments the entire photo. Started the moment the photo arrives so it runs
 * during the vision call; the per-item quick stickers are then plain crops of
 * this PNG (no second segmentation). Null when unreadable or failed.
 */
export async function makeWholeCutout(
  images: ImagesBinding,
  bytes: ArrayBuffer,
  size: PhotoSize,
): Promise<WholeCutout | null> {
  if (!size.width || !size.height) return null;
  const width = Math.min(size.width, WHOLE_MAX_WIDTH);
  const png = await makeSticker(images, bytes, undefined, width);
  if (!png) return null;
  return { png, width, height: Math.round((size.height * width) / size.width), doneAt: Date.now() };
}

/** Crops a rectangle out of an already-segmented PNG; alpha is kept, nothing is re-segmented. */
async function cropCutout(
  images: ImagesBinding,
  png: ArrayBuffer,
  rect: CropRect,
): Promise<ArrayBuffer | null> {
  try {
    const result = await images.input(png).transform({ trim: rect }).output({ format: "image/png" });
    const response = result.response();
    return response.ok ? await response.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/** Stores a cutout under the expiring pending prefix; null when the write fails. */
async function storePending(
  bucket: StickersBucket,
  userId: string,
  png: ArrayBuffer,
): Promise<string | null> {
  const id = newScanId();
  try {
    await bucket.put(pendingStickerKey(id), png, {
      httpMetadata: { contentType: "image/png" },
      customMetadata: { userId },
    });
    return id;
  } catch {
    return null;
  }
}

/**
 * Per-photo ledger of cutouts, one marker object per box next to the scan
 * photo (so it expires with it). A marker is `pending` while some request is
 * cutting that box, `quick` once a crop of the whole-photo cutout is
 * available but the per-box refinement is still running, and `done` when the
 * sticker is final. `scanId` is the best sticker so far (empty when the cut
 * failed, so a hopeless box is never retried). It makes every cut idempotent
 * per photo and bounds the paid Images calls.
 */
function boxMarkerPrefix(photoKey: string): string {
  return `${photoKey}.stk/`;
}

function boxMarkerKey(photoKey: string, box: StickerBox): string {
  return `${boxMarkerPrefix(photoKey)}${box.join("-")}`;
}

/** A pending or quick marker older than this belongs to a worker that died. */
const CLAIM_STALE_MS = 30_000;
const POLL_MS = 400;

/** Records that this request is about to cut `box` (no checks; fresh photos only). */
export async function markBoxPending(
  bucket: StickersBucket,
  photoKey: string,
  box: StickerBox,
): Promise<void> {
  await bucket.put(boxMarkerKey(photoKey, box), "", {
    customMetadata: { state: "pending", at: String(Date.now()) },
  });
}

async function settleBox(
  bucket: StickersBucket,
  photoKey: string,
  box: StickerBox,
  state: "quick" | "done",
  scanId: string | null,
): Promise<void> {
  try {
    await bucket.put(boxMarkerKey(photoKey, box), "", {
      customMetadata: { state, scanId: scanId ?? "", at: String(Date.now()) },
    });
  } catch {
    // the marker goes stale and the box may be cut again
  }
}

/** What a marker says right now: the best sticker id and whether it is final. */
function readBoxState(meta: Record<string, string> | undefined): {
  state: "pending" | "quick" | "done";
  scanId: string | null;
} {
  const stale = Date.now() - Number(meta?.at ?? 0) >= CLAIM_STALE_MS;
  const scanId = meta?.scanId || null;
  if (meta?.state === "pending") return { state: stale ? "done" : "pending", scanId: null };
  if (meta?.state === "quick" && stale) return { state: "done", scanId };
  return { state: meta?.state === "quick" ? "quick" : "done", scanId };
}

export type BoxClaim =
  | { kind: "claimed" }
  | { kind: "existing"; scanId: string | null; pending: boolean; final: boolean }
  | { kind: "capped" };

/**
 * Asks to cut `box` for this photo. `claimed` means the caller now owns the
 * cut (pending marker written); `existing` means another request already did
 * or is doing it; `capped` means the photo used up its `cap` cutouts.
 */
export async function claimBoxSticker(
  bucket: StickersBucket,
  photoKey: string,
  box: StickerBox,
  cap: number,
): Promise<BoxClaim> {
  const [marker, markers] = await Promise.all([
    bucket.get(boxMarkerKey(photoKey, box)),
    bucket.list({ prefix: boxMarkerPrefix(photoKey) }),
  ]);
  if (marker) {
    const meta = marker.customMetadata;
    const current = readBoxState(meta);
    // A dead worker's pending claim (read as done without an id) is taken over.
    const deadClaim = meta?.state === "pending" && current.state === "done";
    if (!deadClaim) {
      return {
        kind: "existing",
        scanId: current.scanId,
        pending: current.state === "pending",
        final: current.state === "done",
      };
    }
    // It is already counted against the cap.
  } else if (markers.objects.length >= cap) {
    return { kind: "capped" };
  }
  await markBoxPending(bucket, photoKey, box);
  return { kind: "claimed" };
}

/** Cuts and stores the per-box sticker (the refined one); null on any failure. */
async function makeAndStoreBox(
  images: ImagesBinding,
  bucket: StickersBucket,
  userId: string,
  bytes: ArrayBuffer | null,
  box: StickerBox,
  size?: PhotoSize,
): Promise<string | null> {
  try {
    const png = bytes ? await makeBoxSticker(images, bytes, box, size) : null;
    return png ? await storePending(bucket, userId, png) : null;
  } catch {
    return null;
  }
}

/**
 * Cuts a claimed box, stores the sticker under the pending prefix and settles
 * the marker as final. Returns the sticker id, or null (no bytes, unusable
 * box, failed transform or write) — never throws.
 */
export async function cutBoxSticker(
  images: ImagesBinding,
  bucket: StickersBucket,
  userId: string,
  photoKey: string,
  bytes: ArrayBuffer | null,
  box: StickerBox,
): Promise<string | null> {
  const scanId = await makeAndStoreBox(images, bucket, userId, bytes, box);
  await settleBox(bucket, photoKey, box, "done", scanId);
  return scanId;
}

/**
 * Polls the marker of a box another request is cutting. `any` returns as soon
 * as some sticker (quick or final) exists; `final` waits for the refined one.
 * On timeout it returns the best id so far, marked not final.
 */
export async function waitBoxSticker(
  bucket: StickersBucket,
  photoKey: string,
  box: StickerBox,
  timeoutMs: number,
  until: "any" | "final" = "any",
): Promise<{ scanId: string | null; final: boolean }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const marker = await bucket.get(boxMarkerKey(photoKey, box));
    if (!marker) return { scanId: null, final: true };
    const current = readBoxState(marker.customMetadata);
    if (current.state === "done") return { scanId: current.scanId, final: true };
    if (current.state === "quick" && until === "any") return { scanId: current.scanId, final: false };
    if (Date.now() >= deadline) return { scanId: current.scanId, final: false };
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, POLL_MS);
    await promise;
  }
}

/** Milliseconds since the scan request started, per box (null = that stage produced nothing). */
export type ScanStickerTiming = {
  wholeMs: number | null;
  quickMs: Array<number | null>;
  finalMs: Array<number | null>;
};

/** The quick crop pads a little less than the refined cut: the cutout is already isolated. */
const QUICK_PAD = 10;

/**
 * Produces every box's sticker for a fresh scan. Each box gets a quick sticker
 * (a crop of the whole-photo cutout, ready as soon as that cutout is) and,
 * unless `refine` is off, a refined sticker segmented from the box itself that
 * replaces it. The marker moves pending -> quick -> done; with refine off the
 * quick crop is final, and the per-box cut only runs when the quick one failed.
 */
export async function runScanStickers(options: {
  images: ImagesBinding;
  bucket: StickersBucket;
  userId: string;
  photoKey: string;
  bytes: ArrayBuffer;
  boxes: readonly StickerBox[];
  size: PhotoSize;
  whole: Promise<WholeCutout | null>;
  refine: boolean;
  startedAt: number;
}): Promise<ScanStickerTiming> {
  const { images, bucket, userId, photoKey, bytes, size, whole, refine, startedAt } = options;
  const timing: ScanStickerTiming = {
    wholeMs: null,
    quickMs: options.boxes.map(() => null),
    finalMs: options.boxes.map(() => null),
  };
  await Promise.all(
    options.boxes.map(async (box, index) => {
      let settled = false;
      let quickId: string | null = null;
      let quickWrite: Promise<void> = Promise.resolve();
      const quick = (async () => {
        const cutout = await whole;
        if (!cutout) return;
        timing.wholeMs = cutout.doneAt - startedAt;
        const rect = cropRect(box, cutout.width, cutout.height, QUICK_PAD);
        const png = rect ? await cropCutout(images, cutout.png, rect) : null;
        const id = png ? await storePending(bucket, userId, png) : null;
        if (!id) return;
        quickId = id;
        timing.quickMs[index] = Date.now() - startedAt;
        // A refined marker that already landed must not be overwritten.
        if (!settled) quickWrite = settleBox(bucket, photoKey, box, refine ? "quick" : "done", id);
      })();
      let finalId: string | null = null;
      if (!refine) await quick;
      if (refine || !quickId) {
        finalId = await makeAndStoreBox(images, bucket, userId, bytes, box, size);
        if (finalId) timing.finalMs[index] = Date.now() - startedAt;
      }
      settled = true;
      await quickWrite;
      await quick;
      // Written last on purpose: it is the one that must win.
      if (refine || !quickId) await settleBox(bucket, photoKey, box, "done", finalId ?? quickId);
    }),
  );
  return timing;
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
