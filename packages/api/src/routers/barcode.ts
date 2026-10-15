import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { barcodeProduct } from "@joyorogo/db/schema/barcode";

import { protectedProcedure } from "../index";
import {
  OffUnavailableError,
  classifyProduct,
  fetchOffProduct,
  normalizeBarcode,
} from "../lib/barcode";
import type { BarcodeLookup, OffProduct } from "../lib/barcode";

// Products rarely change; misses are retried sooner because anyone can add a
// product to Open Food Facts at any time.
const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 3 * 24 * 60 * 60 * 1000;

type CacheRow = typeof barcodeProduct.$inferSelect;

function rowToProduct(row: CacheRow): OffProduct | null {
  if (row.status !== "found" || !row.name) return null;
  return {
    name: row.name,
    brand: row.brand,
    quantity: row.quantity,
    servingSize: row.servingSize,
    unit: row.unit === "ml" ? "ml" : "g",
    kcal100: row.kcal100,
    protein100: row.protein100,
    carbs100: row.carbs100,
    fat100: row.fat100,
    fiber100: row.fiber100,
    imageUrl: row.imageUrl,
  };
}

function toLookup(code: string, product: OffProduct | null): BarcodeLookup {
  return product ? classifyProduct(code, product) : { status: "not_found", code };
}

export const barcodeRouter = {
  // Looks a scanned or typed code up in Open Food Facts through the shared D1
  // cache. A fresh cache row never touches OFF; when OFF is down a stale row is
  // served rather than an error, and outages are never cached as "not found".
  lookup: protectedProcedure
    .input(z.object({ code: z.string().trim().min(1).max(32) }))
    .handler(async ({ context, input }): Promise<BarcodeLookup> => {
      const code = normalizeBarcode(input.code);
      if (!code) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Nomor barcode tidak valid. Cek lagi angkanya (8, 12, atau 13 digit).",
        });
      }
      const [cached] = await context.db
        .select()
        .from(barcodeProduct)
        .where(eq(barcodeProduct.code, code))
        .limit(1);
      const age = cached ? Date.now() - cached.fetchedAt.getTime() : Infinity;
      if (cached && age < (cached.status === "found" ? FOUND_TTL_MS : MISS_TTL_MS)) {
        return toLookup(code, rowToProduct(cached));
      }
      let fetched: OffProduct | null;
      try {
        fetched = await fetchOffProduct(code);
      } catch (error) {
        if (!(error instanceof OffUnavailableError)) throw error;
        if (cached) return toLookup(code, rowToProduct(cached));
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message: "Open Food Facts lagi tidak bisa dihubungi. Coba lagi sebentar atau isi manual.",
        });
      }
      const values = {
        status: fetched ? "found" : "not_found",
        name: fetched?.name ?? null,
        brand: fetched?.brand ?? null,
        quantity: fetched?.quantity ?? null,
        servingSize: fetched?.servingSize ?? null,
        unit: fetched?.unit ?? null,
        kcal100: fetched?.kcal100 ?? null,
        protein100: fetched?.protein100 ?? null,
        carbs100: fetched?.carbs100 ?? null,
        fat100: fetched?.fat100 ?? null,
        fiber100: fetched?.fiber100 ?? null,
        imageUrl: fetched?.imageUrl ?? null,
        fetchedAt: new Date(),
      };
      await context.db
        .insert(barcodeProduct)
        .values({ code, ...values })
        .onConflictDoUpdate({ target: barcodeProduct.code, set: values });
      return toLookup(code, fetched);
    }),
};
