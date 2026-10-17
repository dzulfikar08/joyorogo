import type { Hono } from "hono";

import { z } from "zod";

import { correctScanItems, correctionItemSchema } from "@joyorogo/api/lib/scan-correct";
import { analyzeFoodPhoto, DEFAULT_VISION_MODEL } from "@joyorogo/api/lib/vision";

type AiRunner = { run(model: string, input: unknown): Promise<unknown> };

type BenchCase = {
  url: string;
  expectKcalMin: number;
  expectKcalMax: number;
  dish: string;
};

const benchCorrectSchema = z.object({
  items: z.array(correctionItemSchema).min(1).max(15),
  texts: z.array(z.string().min(2).max(300)).min(1).max(20),
  model: z.string().optional(),
  locale: z.enum(["id", "en"]).optional(),
});

type Deps = {
  ai: AiRunner | undefined;
  benchKey: string | undefined;
  model?: string;
};

// Blind accuracy benchmark: POST /ai/bench with X-Bench-Key. Unmeasured on
// purpose — no ai_usage rows, no quota; the key gate is the only protection.
export function registerBenchRoutes(app: Hono, deps: Deps) {
  app.post("/ai/bench", async (c) => {
    if (!deps.benchKey || c.req.header("X-Bench-Key") !== deps.benchKey) {
      return c.text("Not Found", 404);
    }
    const ai = deps.ai;
    if (!ai) {
      return c.json({ error: "AI binding unavailable" }, 503);
    }
    const body = (await c.req.json().catch(() => null)) as {
      images?: BenchCase[];
      model?: string;
    } | null;
    const cases = body?.images;
    if (!Array.isArray(cases) || cases.length === 0) {
      return c.json({ error: "images[] required" }, 400);
    }

    const results = [] as {
      dish: string;
      ok: boolean;
      totalKcal?: number;
      inRange: boolean;
      latencyMs: number;
      error?: string;
    }[];

    for (const bench of cases) {
      const started = Date.now();
      try {
        const res = await fetchImage(bench.url);
        const buf = await res.arrayBuffer();
        const mime = res.headers.get("content-type") ?? "image/jpeg";
        const { items } = await analyzeFoodPhoto(ai, {
          model: body?.model || deps.model || DEFAULT_VISION_MODEL,
          imageBase64: toBase64(new Uint8Array(buf)),
          mimeType: mime,
        });
        const totalKcal = items.reduce((sum, item) => sum + item.kcal, 0);
        results.push({
          dish: bench.dish,
          ok: true,
          totalKcal,
          inRange: totalKcal >= bench.expectKcalMin && totalKcal <= bench.expectKcalMax,
          latencyMs: Date.now() - started,
        });
      } catch (error) {
        results.push({
          dish: bench.dish,
          ok: false,
          inRange: false,
          latencyMs: Date.now() - started,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const hits = results.filter((r) => r.inRange).length;
    const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
    const median = latencies.length ? latencies[Math.floor((latencies.length - 1) / 2)] : 0;
    return c.json({
      results,
      summary: {
        n: results.length,
        hits,
        hitRate: results.length ? hits / results.length : 0,
        medianLatencyMs: median,
      },
    });
  });

  // Correction latency on the real AI binding: POST /ai/bench-correct with
  // X-Bench-Key and { items, texts: string[], model?, locale? }. Runs the
  // production path (prompt, ops, patch, TKPI calibration) once per text.
  app.post("/ai/bench-correct", async (c) => {
    if (!deps.benchKey || c.req.header("X-Bench-Key") !== deps.benchKey) {
      return c.text("Not Found", 404);
    }
    if (!deps.ai) return c.json({ error: "AI binding unavailable" }, 503);
    const parsed = benchCorrectSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "items[] and texts[] required" }, 400);
    const { items, texts, model, locale } = parsed.data;
    const results = [];
    for (const text of texts) {
      const started = Date.now();
      try {
        const run = await correctScanItems(deps.ai, { items, text, model, locale });
        results.push({ text, ok: true, ms: Date.now() - started, model: run.model, patch: run.patch });
      } catch (error) {
        results.push({
          text,
          ok: false,
          ms: Date.now() - started,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return c.json({ results });
  });
}

/** Bounded manual redirect follow — undici's recursive follow overflows
 * the stack on Wikimedia thumb redirect chains. */
async function fetchImage(url: string): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(current, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; JoyorogoBench/1.0; +https://joyorogo.com)",
      },
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`redirect ${res.status} without location`);
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    return res;
  }
  throw new Error("too many redirects");
}

/** Chunked byte->binary-string so btoa never sees a spread overflow. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
