import type { Hono } from "hono";

import { DATASET_PREFIX } from "@joyorogo/api/lib/dataset";
import type { StickersBucket } from "@joyorogo/api/lib/sticker";

type Deps = {
  getBucket: () => StickersBucket | undefined;
  /** The AI_BENCH_KEY secret; unset = routes answer 404. */
  key: string | undefined;
};

// Read-only access to the owner's internal accuracy dataset (R2 dataset/...),
// for scripts/dataset-export.ts. Gated by the same X-Bench-Key secret as
// /ai/bench; nothing outside the dataset/ prefix is reachable.
export function registerDatasetExportRoutes(app: Hono, deps: Deps) {
  const allowed = (header: string | undefined) => !!deps.key && header === deps.key;

  // GET /ai/dataset/list?cursor=  ->  { keys: string[], cursor?: string }
  app.get("/ai/dataset/list", async (c) => {
    if (!allowed(c.req.header("X-Bench-Key"))) return c.text("Not Found", 404);
    const bucket = deps.getBucket();
    if (!bucket) return c.json({ error: "bucket unavailable" }, 503);
    const page = await bucket.list({
      prefix: DATASET_PREFIX,
      cursor: c.req.query("cursor") || undefined,
    });
    return c.json({
      keys: page.objects.map((object) => object.key),
      ...(page.truncated && page.cursor ? { cursor: page.cursor } : {}),
    });
  });

  // GET /ai/dataset/object?key=dataset/<userId>/<scanId>/photo.jpg
  app.get("/ai/dataset/object", async (c) => {
    if (!allowed(c.req.header("X-Bench-Key"))) return c.text("Not Found", 404);
    const bucket = deps.getBucket();
    if (!bucket) return c.json({ error: "bucket unavailable" }, 503);
    const key = c.req.query("key") ?? "";
    if (!key.startsWith(DATASET_PREFIX) || key.includes("..")) return c.text("Not Found", 404);
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
