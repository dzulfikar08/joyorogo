import { eq } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { profile } from "@joyorogo/db/schema/fitness";
import { DEFAULT_LOCALE, getT, isLocale } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

/**
 * Translator for user-facing server text (API errors, push, email, AI copy).
 *
 *   const t = serverT(context.locale, "errors");
 *   throw new ORPCError("NOT_FOUND", { message: t("profile.onboardingRequired") });
 *
 * Never use a module-level or shared "current language": a Worker serves every
 * language at once, so the locale always travels with the request or the user.
 */
export const serverT = getT;

/**
 * The language to write to a user who is not the caller (push to a recipient,
 * cron email): their saved choice, else `id`. One indexed lookup.
 */
export async function userLocale(db: Database, userId: string): Promise<Locale> {
  const [row] = await db
    .select({ locale: profile.locale })
    .from(profile)
    .where(eq(profile.userId, userId))
    .limit(1);
  return isLocale(row?.locale) ? row.locale : DEFAULT_LOCALE;
}
