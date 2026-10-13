import { eq } from "drizzle-orm";

import { user } from "@joyorogo/db/schema/auth";

import { customAvatarKey } from "../lib/avatar";

import { deleteAllUserData, deleteUserSocialData } from "../lib/privacy";

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
};
