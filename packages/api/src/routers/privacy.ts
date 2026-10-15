import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";

import { user } from "@joyorogo/db/schema/auth";

import { customAvatarKey } from "../lib/avatar";

import { deleteAllUserData, deleteUserMedia, deleteUserSocialData, userStickerKeys } from "../lib/privacy";

import { protectedProcedure } from "../index";

export const privacyRouter = {
  // Native app entry (web uses the REST route); both share lib/privacy.
  deleteMyData: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    await deleteUserSocialData(context.db, userId);
    await deleteAllUserData(context.db, userId);
    // Foto profil ikut dihapus: reset dulu, objek R2 menyusul (best effort).
    const [current] = await context.db
      .select({ image: user.image })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    const avatarKey = customAvatarKey(current?.image ?? null);
    await context.db.update(user).set({ image: null }).where(eq(user.id, userId));
    const bucket = context.env.STICKERS;
    if (avatarKey && bucket) {
      try {
        await bucket.delete(avatarKey);
      } catch (error) {
        console.error("[privacy] avatar wipe failed", error);
      }
    }
    return { deleted: true };
  }),

  /**
   * In-app account deletion (App Store 5.1.1(v)): wipes social + diary rows
   * and R2 media, then removes the user row. Every table references user.id
   * ON DELETE CASCADE, so sessions and linked logins (Google, Apple) go too.
   * Media goes before the user row so a storage failure stays retryable.
   */
  deleteMyAccount: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const stickerKeys = await userStickerKeys(context.db, userId);
    await deleteUserSocialData(context.db, userId);
    await deleteAllUserData(context.db, userId);
    const bucket = context.env.STICKERS;
    if (bucket) {
      try {
        await deleteUserMedia(bucket, userId, stickerKeys);
      } catch (error) {
        console.error("[privacy] media wipe failed", error);
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Foto belum bisa dihapus. Coba lagi sebentar.",
        });
      }
    }
    await context.db.delete(user).where(eq(user.id, userId));
    return { deleted: true };
  }),
};
