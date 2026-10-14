// Shared daily AI-scan quota gate. Lives outside the routers so both the food
// AI (ai.ts) and the VAR perut comparison (group.ts) spend the same quota.
import { eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";

import { user } from "@joyorogo/db/schema/auth";
import type { Database } from "@joyorogo/db";

import type { AiBinding } from "../context";
import { jakartaToday } from "./engine";
import { dailyScanQuota, effectiveTier, paywallConfig, scansUsedToday } from "./tiers";
import type { PaywallEnv } from "./tiers";

export type QuotaEnv = PaywallEnv & { AI?: AiBinding };

/**
 * "Hitung ulang" re-runs the model on a photo the user already paid a scan
 * for, so a retry never spends the daily quota — the cap below is the only
 * limit, enforced per photo in the ai router. After it, the client offers a
 * fresh photo (which is billed normally).
 */
export const MAX_SCAN_RETRIES = 2;

/**
 * Every AI call (plate photo, food story, VAR perut) spends one scan of the
 * daily quota. Runs BEFORE inference so a rejected call never costs Neurons.
 * `quotaReached`: a free user's successful call now would use the last scan
 * of today — clients show the (skippable) Founder paywall after it.
 */
export async function requireAiQuota(
  db: Database,
  env: QuotaEnv,
  userId: string,
): Promise<{ ai: AiBinding; quotaReached: boolean }> {
  const ai = env.AI;
  if (!ai) {
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: "Layanan AI belum tersedia. Coba lagi nanti.",
    });
  }
  const config = paywallConfig(env);
  const [[userRow], usedToday] = await Promise.all([
    db
      .select({
        tier: user.tier,
        founderUntil: user.founderUntil,
        aiUnlimited: user.aiUnlimited,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1),
    scansUsedToday(db, userId, jakartaToday()),
  ]);
  const tier = effectiveTier(userRow);
  const quota = userRow?.aiUnlimited ? null : dailyScanQuota(tier, config);
  if (quota !== null && usedToday >= quota) {
    throw new ORPCError("FORBIDDEN", {
      message:
        tier === "founder"
          ? `Batas pengaman Founder tercapai (${quota} scan/hari). Coba lagi besok ya.`
          : `Kuota AI hari ini habis (${quota}/hari). ${
              config.founderDailyCap === null
                ? "Founder buka AI tanpa batas."
                : `Founder dapat ${config.founderDailyCap}/hari.`
            }`,
      data: { paywall: true, tier },
    });
  }
  return { ai, quotaReached: tier === "free" && quota !== null && usedToday + 1 >= quota };
}
