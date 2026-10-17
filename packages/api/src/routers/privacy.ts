import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { account, user } from "@joyorogo/db/schema/auth";

import { appleRevokeConfig, revokeAppleAuthorization } from "../lib/apple-revoke";
import { customAvatarKey } from "../lib/avatar";

import { deleteAllUserData, deleteUserMedia, deleteUserSocialData, userStickerKeys } from "../lib/privacy";
import { revokeGrant } from "../lib/strava-grant";

import { serverT } from "../lib/messages";

import { protectedProcedure } from "../index";

export const privacyRouter = {
  // Native app entry (web uses the REST route); both share lib/privacy.
  deleteMyData: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    await deleteUserSocialData(context.db, userId);
    await revokeGrant(context.db, context.env, userId);
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
  deleteMyAccount: protectedProcedure
    .input(
      z
        .object({
          appleAuthorizationCode: z.string().min(1).optional(),
          // Bundle id of the app that asked for the code (JoyoFit); default is JoyoRogo.
          appleClientId: z.string().min(1).optional(),
        })
        .optional(),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;

      // Apple 5.1.1(v): revoke the Sign in with Apple token before anything is
      // deleted, so a failure leaves the account intact and retryable.
      const [appleLink] = await context.db
        .select({ id: account.id })
        .from(account)
        .where(and(eq(account.userId, userId), eq(account.providerId, "apple")))
        .limit(1);
      if (appleLink) {
        const code = input?.appleAuthorizationCode;
        if (!code) {
          throw new ORPCError("BAD_REQUEST", {
            message: serverT(context.locale, "errors")("auth.appleReauth"),
          });
        }
        const config = appleRevokeConfig(context.env, input?.appleClientId);
        if (!config) {
          console.error(
            "[privacy] APPLE_SIWA_KEY_ID / APPLE_SIWA_PRIVATE_KEY not set: deleting Apple-linked account WITHOUT revoking the Sign in with Apple token",
          );
        } else {
          try {
            await revokeAppleAuthorization(config, code);
          } catch (error) {
            console.error("[privacy] apple revoke failed", error);
            throw new ORPCError("BAD_GATEWAY", {
              message: serverT(context.locale, "errors")("auth.appleRevokeFailed"),
            });
          }
        }
      }

      const stickerKeys = await userStickerKeys(context.db, userId);
      await deleteUserSocialData(context.db, userId);
      await revokeGrant(context.db, context.env, userId);
      await deleteAllUserData(context.db, userId);
      const bucket = context.env.STICKERS;
      if (bucket) {
        try {
          await deleteUserMedia(bucket, userId, stickerKeys);
        } catch (error) {
          console.error("[privacy] media wipe failed", error);
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: serverT(context.locale, "errors")("auth.mediaDeleteFailed"),
          });
        }
      }
      await context.db.delete(user).where(eq(user.id, userId));
      return { deleted: true };
    }),
};
