import { eq, sql } from "drizzle-orm";
import type { Hono } from "hono";

import { serverT } from "@joyorogo/api/lib/messages";
import { withEggCount } from "@joyorogo/api/lib/egg-count";
import { scanFailMessage } from "@joyorogo/api/lib/scan-fail-message";
import { analyzeFoodPhoto, VisionError } from "@joyorogo/api/lib/vision";
import type { VisionAnalysis } from "@joyorogo/api/lib/vision";
import { aiUsage, anonScan } from "@joyorogo/db/schema/fitness";
import type { Database } from "@joyorogo/db";

import { requestLocale, requestRegion } from "./context";

const COOKIE = "jr_anon";

type AiRunner = { run(model: string, input: unknown): Promise<unknown> };

type Deps = {
  ai: AiRunner | undefined;
  getDb: () => Database;
  model?: string;
  /** Lifetime scans per device cookie (ANON_SCANS); 0 turns the demo off. */
  anonScans: number;
};

/** Landing-page engine: a few anonymous scans per device cookie, then sign-up. */
export function registerAnonScanRoutes(app: Hono, deps: Deps) {
  app.post("/ai/scan-anon", async (c) => {
    const ai = deps.ai;
    const locale = requestLocale(c);
    const t = serverT(locale, "scan");
    if (!ai) {
      return c.json({ error: t("errors.anonAiUnavailable") }, 503);
    }
    let cookieId = c.req.header("Cookie")?.match(new RegExp(`${COOKIE}=([^;]+)`))?.[1];
    let setCookie: string | undefined;
    if (!cookieId) {
      cookieId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      setCookie = `${COOKIE}=${cookieId}; Path=/; Max-Age=31536000; Secure; SameSite=Lax; HttpOnly`;
    }

    const db = deps.getDb();
    const [row] = await db
      .select({ count: anonScan.count })
      .from(anonScan)
      .where(eq(anonScan.cookieId, cookieId))
      .limit(1);
    const used = row?.count ?? 0;
    if (used >= deps.anonScans) {
      if (setCookie) c.header("Set-Cookie", setCookie);
      return c.json(
        {
          error: t("errors.anonTrialUsed"),
          paywall: true,
        },
        402,
      );
    }

    const body = (await c.req.json().catch(() => null)) as {
      imageBase64?: string;
      mimeType?: string;
    } | null;
    if (!body?.imageBase64 || body.imageBase64.length < 50) {
      return c.json({ error: t("errors.anonPhotoUnreadable") }, 400);
    }
    const mime = body.mimeType ?? "image/jpeg";
    const startedAt = Date.now();
    let analysis: VisionAnalysis;
    try {
      analysis = await analyzeFoodPhoto(ai, {
        imageBase64: body.imageBase64,
        mimeType: mime,
        model: deps.model,
        locale,
        region: requestRegion(c),
      });
    } catch (error) {
      const reason = error instanceof VisionError ? error.reason : "failed";
      return c.json({ error: scanFailMessage(reason, locale), reason }, 500);
    }
    analysis = (await withEggCount(ai, { imageBase64: body.imageBase64, mimeType: mime, model: deps.model }, analysis)).analysis;

    // Charge only successful scans.
    await db
      .insert(anonScan)
      .values({ cookieId, count: 1 })
      .onConflictDoUpdate({
        target: anonScan.cookieId,
        set: { count: sql`${anonScan.count} + 1` },
      });
    // Cost ledger: anon scans burn Neurons too.
    await db.insert(aiUsage).values({
      id: crypto.randomUUID(),
      userId: null,
      model: analysis.model,
      scanType: "anon",
      latencyMs: Date.now() - startedAt,
      usageJson: analysis.usage ? JSON.stringify(analysis.usage) : null,
    });

    if (setCookie) c.header("Set-Cookie", setCookie);
    return c.json({ items: analysis.items, remaining: deps.anonScans - (used + 1) });
  });

  // Lifetime counter — social proof for the landing page.
  app.get("/ai/scan-count", async (c) => {
    const db = deps.getDb();
    const [row] = await db.select({ total: sql<number>`sum(${anonScan.count})` }).from(anonScan);
    return c.json({ total: row?.total ?? 0 });
  });
}
