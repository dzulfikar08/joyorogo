import { eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { user } from "@joyorogo/db/schema/auth";

import {
  avatarExt,
  avatarFallbackImage,
  avatarKey,
  avatarPublicUrl,
  customAvatarKey,
} from "../lib/avatar";
import { serverT } from "../lib/messages";
import { base64ToBytes, newScanId } from "../lib/sticker";

import type { Context } from "../context";

import { protectedProcedure } from "../index";

// Bawaan klien: sisi klien memampatkan ke persegi ~512px sebelum mengunggah,
// jadi batas ini hanya pagar untuk unggahan mentah (~5 MB biner, base64 +4/3).
const AVATAR_INPUT_MAX = 6_990_000;

async function currentUserImage(db: Context["db"], userId: string): Promise<string | null> {
  const [row] = await db.select({ image: user.image }).from(user).where(eq(user.id, userId)).limit(1);
  return row?.image ?? null;
}

export const avatarRouter = {
  // Ganti foto profil: simpan objek baru, arahkan user.image ke URL publiknya,
  // lalu hapus objek lama supaya tidak menumpuk. Metadata objek membawa foto
  // Google sebelumnya (customMetadata.g) untuk tombol "Hapus foto".
  upload: protectedProcedure
    .input(
      z.object({
        imageBase64: z.base64().min(50).max(AVATAR_INPUT_MAX),
        mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const t = serverT(context.locale, "errors");
      const bucket = context.env.STICKERS;
      if (!bucket) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: t("ai.storageUnavailable") });
      }
      const ext = avatarExt(input.mimeType);
      if (!ext) {
        throw new ORPCError("BAD_REQUEST", { message: t("misc.avatar.formatUnsupported") });
      }
      const previousImage = await currentUserImage(context.db, userId);
      // Foto Google terakhir: diwariskan dari metadata avatar lama, atau
      // diambil langsung kalau yang sekarang masih foto Google.
      const googleImage = await avatarFallbackImage(bucket, previousImage);
      const id = newScanId();
      try {
        await bucket.put(avatarKey(userId, id, ext), base64ToBytes(input.imageBase64), {
          httpMetadata: { contentType: input.mimeType },
          customMetadata: { g: googleImage ?? "" },
        });
      } catch {
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: t("misc.avatar.saveFailed") });
      }
      await context.db
        .update(user)
        .set({ image: avatarPublicUrl(userId, id, ext) })
        .where(eq(user.id, userId));
      const previousKey = customAvatarKey(previousImage);
      if (previousKey) {
        try {
          await bucket.delete(previousKey);
        } catch {
          // orphaned object; user.image sudah menunjuk yang baru
        }
      }
      return { image: avatarPublicUrl(userId, id, ext) };
    }),

  // "Hapus foto": kembali ke foto Google kalau masih tersimpan di metadata,
  // kalau tidak (atau tidak ada) jadi null — tampilan inisial nama.
  remove: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const previousImage = await currentUserImage(context.db, userId);
    const previousKey = customAvatarKey(previousImage);
    if (!previousKey) {
      return { image: previousImage };
    }
    const bucket = context.env.STICKERS;
    if (!bucket) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: serverT(context.locale, "errors")("ai.storageUnavailable"),
      });
    }
    const old = await bucket.get(previousKey);
    const googleImage = old?.customMetadata?.g || null;
    try {
      await bucket.delete(previousKey);
    } catch {
      // tetap lanjut: image di-reset, objek yatim ikut wipe privasi
    }
    await context.db.update(user).set({ image: googleImage }).where(eq(user.id, userId));
    return { image: googleImage };
  }),
};
