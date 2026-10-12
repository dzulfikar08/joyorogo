import { deleteAllUserData } from "../lib/privacy";

import { protectedProcedure } from "../index";

export const privacyRouter = {
  // Native app entry (web uses the REST route); both share lib/privacy.
  deleteMyData: protectedProcedure.handler(async ({ context }) => {
    await deleteAllUserData(context.db, context.session.user.id);
    return { deleted: true };
  }),
};
