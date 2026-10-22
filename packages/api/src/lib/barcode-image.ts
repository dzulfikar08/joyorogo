// A product logged by barcode gets the sticker a photo scan would: the product's
// front photo from Open Food Facts, cut out like a dish, stored as the row's
// scan_id so the diary row, the portion sheet, the viewer and the share cards
// show it with no client change. The image URL comes from our own
// barcode_product cache (never from the client) and only from OFF's hosts. The
// cutout is made once per product and copied per logged row, because a row's
// sticker is deleted with the row and so cannot be shared between rows.
//
// The other way to get a sticker is opt-in: the front photo the person took in
// the label flow, cut out by the same pipeline as a dish and kept as that one
// meal's sticker (storeKeptFrontSticker). It wins over the product photo.

import { eq } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@joyorogo/db";
import { barcodeProduct } from "@joyorogo/db/schema/barcode";

import { normalizeBarcode } from "./barcode";
import {
  base64ToBytes,
  makeSticker,
  makeWholeCutout,
  newScanId,
  readPhotoSize,
  stickerKey,
  storePendingPlateSticker,
} from "./sticker";
import type { ImagesBinding, StickersBucket } from "./sticker";

const MAX_IMAGE_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 6_000;
const STICKER_WIDTH = 480;

const itemsJsonBarcode = z.object({ barcode: z.string() });

/** R2 key of the shared cutout of one product (not personal data, not removed with an account). */
export function productStickerKey(code: string): string {
  return `barcode-img/${code}.png`;
}

/** The barcode a barcode-source row's `itemsJson` carries ({ barcode, brand, source }), normalized; null for anything else. */
export function barcodeFromItemsJson(itemsJson: string | undefined): string | null {
  if (!itemsJson) return null;
  try {
    const parsed = itemsJsonBarcode.safeParse(JSON.parse(itemsJson));
    return parsed.success ? normalizeBarcode(parsed.data.barcode) : null;
  } catch {
    return null;
  }
}

/** Only images served by Open Food Facts themselves over https are fetched. */
export function isProductImageUrl(raw: string | null | undefined): raw is string {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && (url.hostname === "openfoodfacts.org" || url.hostname.endsWith(".openfoodfacts.org"));
  } catch {
    return false;
  }
}

/** The front photo of a product we know, or null when we have none or it is not one we may fetch. */
export async function productImageUrl(db: Database, code: string): Promise<string | null> {
  const [row] = await db
    .select({ imageUrl: barcodeProduct.imageUrl })
    .from(barcodeProduct)
    .where(eq(barcodeProduct.code, code))
    .limit(1);
  return isProductImageUrl(row?.imageUrl) ? row.imageUrl : null;
}

async function fetchProductImage(url: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) return null;
    const bytes = await response.arrayBuffer();
    return bytes.byteLength > 0 && bytes.byteLength <= MAX_IMAGE_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

/** The photo as a plain PNG when it cannot be segmented: a product is still better shown than missing. */
async function plainPng(images: ImagesBinding, bytes: ArrayBuffer): Promise<ArrayBuffer | null> {
  try {
    const result = await images.input(bytes).transform({ width: STICKER_WIDTH }).output({ format: "image/png" });
    const response = result.response();
    return response.ok ? await response.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/**
 * Writes `scans/<scanId>.png` for a logged product: a copy of the product's
 * shared cutout, which is cut from the front photo the first time anyone logs
 * it. Never throws; a failure leaves the row without a sticker, as before.
 */
export async function storeProductSticker(
  images: ImagesBinding,
  bucket: StickersBucket,
  code: string,
  imageUrl: string,
  scanId: string,
): Promise<void> {
  try {
    const shared = await bucket.get(productStickerKey(code));
    let png = shared ? await shared.arrayBuffer() : null;
    if (!png) {
      const bytes = await fetchProductImage(imageUrl);
      if (!bytes) return;
      png = (await makeSticker(images, bytes, undefined, STICKER_WIDTH)) ?? (await plainPng(images, bytes));
      if (!png) return;
      await bucket.put(productStickerKey(code), png, { httpMetadata: { contentType: "image/png" } });
    }
    await bucket.put(stickerKey(scanId), png, { httpMetadata: { contentType: "image/png" } });
  } catch {
    // the row keeps its icon
  }
}

/**
 * The opt-in path: cuts the front-of-pack photo the person took while reading a
 * label and parks the cutout under the expiring pending prefix for them. The
 * photo itself is never stored. `food.add` promotes the cutout when the meal is
 * logged (a barcode meal's `scanId` must be one of these). Resolves the pending
 * id, or null when the cut or the write failed (the meal then falls back to the
 * product photo, or none). Never throws.
 */
export async function storeKeptFrontSticker(
  images: ImagesBinding,
  bucket: StickersBucket,
  userId: string,
  imageBase64: string,
): Promise<string | null> {
  try {
    const bytes = base64ToBytes(imageBase64);
    const id = newScanId();
    const whole = makeWholeCutout(images, bytes, await readPhotoSize(images, bytes));
    return (await storePendingPlateSticker(images, bucket, userId, id, whole)) ? id : null;
  } catch {
    return null;
  }
}
