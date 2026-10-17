import type { Hono } from "hono";

import { DATASET_PREFIX } from "@joyorogo/api/lib/dataset";
import { FEEDBACK_PREFIX } from "@joyorogo/api/lib/feedback-keep";
import type { StickersBucket } from "@joyorogo/api/lib/sticker";

type Deps = {
  getBucket: () => StickersBucket | undefined;
  /** The AI_BENCH_KEY secret; unset = routes answer 404. */
  key: string | undefined;
};

// Read-only access to the accuracy datasets in R2, for scripts/dataset-export.ts:
// the owner's internal dataset (dataset/...) and the photos users opted in to
// keep with a negative rating (feedback/...). Gated by the same X-Bench-Key
// secret as /ai/bench; nothing outside those two prefixes is reachable.
const EXPORT_PREFIXES: readonly string[] = [DATASET_PREFIX, FEEDBACK_PREFIX];

export function registerDatasetExportRoutes(app: Hono, deps: Deps) {
  const allowed = (header: string | undefined) => !!deps.key && header === deps.key;

  // GET /ai/dataset/list?prefix=dataset/|feedback/&cursor=  ->  { keys: string[], cursor?: string }
  // prefix defaults to dataset/; any other value is a 404.
  app.get("/ai/dataset/list", async (c) => {
    if (!allowed(c.req.header("X-Bench-Key"))) return c.text("Not Found", 404);
    const bucket = deps.getBucket();
    if (!bucket) return c.json({ error: "bucket unavailable" }, 503);
    const prefix = c.req.query("prefix") || DATASET_PREFIX;
    if (!EXPORT_PREFIXES.includes(prefix)) return c.text("Not Found", 404);
    const page = await bucket.list({
      prefix,
      cursor: c.req.query("cursor") || undefined,
    });
    return c.json({
      keys: page.objects.map((object) => object.key),
      ...(page.truncated && page.cursor ? { cursor: page.cursor } : {}),
    });
  });

  // GET /ai/dataset/object?key=dataset/<userId>/<scanId>/photo.jpg
  //                        or feedback/<userId>/<photoId>/photo.jpg
  app.get("/ai/dataset/object", async (c) => {
    if (!allowed(c.req.header("X-Bench-Key"))) return c.text("Not Found", 404);
    const bucket = deps.getBucket();
    if (!bucket) return c.json({ error: "bucket unavailable" }, 503);
    const key = c.req.query("key") ?? "";
    if (!EXPORT_PREFIXES.some((p) => key.startsWith(p)) || key.includes("..")) {
      return c.text("Not Found", 404);
    }
    const object = await bucket.get(key);
    if (!object) return c.text("Not Found", 404);
    return new Response(object.body as unknown as BodyInit, {
      headers: {
        "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
        "cache-control": "no-store",
      },
    });
  });
}
