// "Hitung ulang" untuk VAR perut: menjalankan ulang perbandingan AI pada foto
// yang SAMA (scan ini + scan sebelumnya di R2), lalu menimpa verdict, confidence
// dan catatan baris var_scan itu. Gratis (tidak memakai kuota scan harian);
// satu-satunya batas adalah MAX_SCAN_RETRIES per scan, dihitung di kolom
// var_scan.retries dan dijaga atomik di SQL. Verdict lama tetap utuh kalau
// percobaan gagal, dan dikembalikan ke klien supaya bisa di-undo.
import { ORPCError } from "@orpc/server";
import { and, desc, eq, lt, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import type { Locale } from "@joyorogo/i18n";
import { aiUsage, varScan } from "@joyorogo/db/schema/fitness";

import { serverT } from "./messages";
import { MAX_SCAN_RETRIES } from "./quota";
import { bytesToBase64, varPhotoKey } from "./sticker";
import type { StickersBucket } from "./sticker";
import { analyzeVarPhotos } from "./varscan";
import type { VarAnalysis, VarVerdict } from "./varscan";
import type { AiRunner } from "./vision";

export type VarVerdictSnapshot = {
  verdict: VarVerdict;
  confidence: number | null;
  note: string | null;
};

/** Sisa jatah hitung ulang untuk scan yang sudah memakai `retries`. */
export function varRetriesLeft(retries: number): number {
  return Math.max(0, MAX_SCAN_RETRIES - retries);
}

/**
 * Mengambil satu jatah hitung ulang secara atomik: `retries + 1` hanya terjadi
 * kalau masih di bawah batas, jadi dua request bersamaan tidak bisa
 * melewatinya. Mengembalikan jumlah retries sesudah klaim, null kalau habis
 * atau baris bukan milik pemanggil.
 */
async function claimRetry(db: Database, userId: string, id: string): Promise<number | null> {
  const [claimed] = await db
    .update(varScan)
    .set({ retries: sql`${varScan.retries} + 1` })
    .where(and(eq(varScan.id, id), eq(varScan.userId, userId), lt(varScan.retries, MAX_SCAN_RETRIES)))
    .returning({ retries: varScan.retries });
  return claimed?.retries ?? null;
}

/** Mengembalikan jatah yang diklaim kalau percobaan gagal: kegagalan tidak memakan batas. */
async function releaseRetry(db: Database, userId: string, id: string): Promise<void> {
  await db
    .update(varScan)
    .set({ retries: sql`max(${varScan.retries} - 1, 0)` })
    .where(and(eq(varScan.id, id), eq(varScan.userId, userId)));
}

export async function retryVarScan(
  deps: {
    db: Database;
    bucket: StickersBucket;
    ai: AiRunner;
    model?: string;
  },
  input: { userId: string; id: string; hint?: string; locale: Locale },
): Promise<{
  scan: { id: string; verdict: VarVerdict; confidence: number; note: string };
  previous: VarVerdictSnapshot;
  retriesLeft: number;
}> {
  const { db, bucket, ai } = deps;
  const { userId, id, hint, locale } = input;
  const t = serverT(locale, "varperut");

  const [row] = await db
    .select()
    .from(varScan)
    .where(and(eq(varScan.id, id), eq(varScan.userId, userId)))
    .limit(1);
  if (!row) throw new ORPCError("NOT_FOUND", { message: t("errors.scanNotFound") });

  // Pembanding = scan milik pengguna tepat sebelum scan ini, seperti saat
  // varAnalyze memilih pembanding.
  const [before] = await db
    .select()
    .from(varScan)
    .where(and(eq(varScan.userId, userId), lt(varScan.createdAt, row.createdAt)))
    .orderBy(desc(varScan.createdAt))
    .limit(1);
  if (!before) {
    throw new ORPCError("UNPROCESSABLE_CONTENT", {
      message: t("errors.noBaseline"),
    });
  }
  const claimed = await claimRetry(db, userId, id);
  if (claimed === null) {
    throw new ORPCError("FORBIDDEN", {
      message: t("errors.retriesExhausted", { count: MAX_SCAN_RETRIES }),
      data: { retriesExhausted: true },
    });
  }

  const startedAt = Date.now();
  let analysis: VarAnalysis;
  try {
    const [currentPhoto, previousPhoto] = await Promise.all([
      bucket.get(varPhotoKey(userId, row.photoId)).catch(() => null),
      bucket.get(varPhotoKey(userId, before.photoId)).catch(() => null),
    ]);
    if (!currentPhoto || !previousPhoto) {
      throw new ORPCError("NOT_FOUND", {
        message: t("errors.photoGone"),
      });
    }
    const mimeType = currentPhoto.httpMetadata?.contentType;
    analysis = await analyzeVarPhotos(ai, {
      previous: {
        imageBase64: bytesToBase64(await previousPhoto.arrayBuffer()),
        label: `scan ${before.date}`,
      },
      current: {
        imageBase64: bytesToBase64(await currentPhoto.arrayBuffer()),
        mimeType: mimeType === "image/png" || mimeType === "image/webp" ? mimeType : "image/jpeg",
        label: `scan ${row.date}`,
      },
      waistCm: row.waistCm ?? before.waistCm,
      model: deps.model || undefined,
      retry: { hint },
      locale,
    });
    const [updated] = await db
      .update(varScan)
      .set({ verdict: analysis.verdict, confidence: analysis.confidence, note: analysis.reason })
      .where(and(eq(varScan.id, id), eq(varScan.userId, userId)))
      .returning({ id: varScan.id });
    // Dihapus selagi AI berjalan: tidak ada baris yang perlu dilindungi lagi.
    if (!updated) throw new ORPCError("NOT_FOUND", { message: t("errors.scanNotFound") });
  } catch (error) {
    // Kegagalan apa pun tidak memakan jatah, dan verdict lama tidak tersentuh.
    await releaseRetry(db, userId, id).catch(() => {});
    if (error instanceof ORPCError) throw error;
    throw new ORPCError("UNPROCESSABLE_CONTENT", {
      message: error instanceof Error ? error.message : t("errors.retryFailed"),
    });
  }

  // Buku besar statistik saja: baris "retry" tidak masuk hitungan kuota harian.
  await db
    .insert(aiUsage)
    .values({
      id: crypto.randomUUID(),
      userId,
      model: analysis.model,
      scanType: "retry",
      latencyMs: Date.now() - startedAt,
      usageJson: JSON.stringify({
        kind: "var-retry",
        ...(hint ? { hint } : {}),
        ...analysis.usage,
      }),
    })
    .catch(() => {});

  return {
    scan: { id, verdict: analysis.verdict, confidence: analysis.confidence, note: analysis.reason },
    previous: { verdict: row.verdict, confidence: row.confidence, note: row.note },
    retriesLeft: varRetriesLeft(claimed),
  };
}

/** Undo "Hitung ulang": menaruh kembali verdict lama. Jatah yang terpakai tidak ikut dikembalikan. */
export async function restoreVarVerdict(
  db: Database,
  userId: string,
  id: string,
  snapshot: VarVerdictSnapshot,
  locale: Locale,
): Promise<void> {
  const [updated] = await db
    .update(varScan)
    .set({
      verdict: snapshot.verdict,
      confidence: snapshot.confidence,
      note: snapshot.note,
    })
    .where(and(eq(varScan.id, id), eq(varScan.userId, userId)))
    .returning({ id: varScan.id });
  if (!updated) {
    throw new ORPCError("NOT_FOUND", { message: serverT(locale, "varperut")("errors.scanNotFound") });
  }
}
