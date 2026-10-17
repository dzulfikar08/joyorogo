import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { StickersBucket } from "@joyorogo/api/lib/sticker";

import { registerDatasetExportRoutes } from "./dataset-export";

const objects = new Map<string, string>([
  ["dataset/u1/s1/meta.json", "{}"],
  ["dataset/u1/s1/photo.jpg", "jpg"],
  ["feedback/u2/p1/meta.json", "{}"],
  ["feedback/u2/p1/photo.jpg", "jpg"],
  ["scans/x.png", "png"],
  ["scan-src/u1/p1", "src"],
]);

const bucket = {
  get: async (key: string) => {
    const body = objects.get(key);
    return body === undefined ? null : { body: new Response(body).body, httpMetadata: {} };
  },
  list: async ({ prefix }: { prefix?: string }) => ({
    objects: [...objects.keys()].filter((k) => k.startsWith(prefix ?? "")).map((key) => ({ key })),
    truncated: false,
  }),
} as unknown as StickersBucket;

const app = new Hono();
registerDatasetExportRoutes(app, { getBucket: () => bucket, key: "k" });

const call = (path: string, key: string | null = "k") =>
  app.request(path, key === null ? {} : { headers: { "X-Bench-Key": key } });

describe("dataset export routes", () => {
  test("list defaults to the owner dataset", async () => {
    const res = await call("/ai/dataset/list");
    expect((await res.json()) as { keys: string[] }).toEqual({
      keys: ["dataset/u1/s1/meta.json", "dataset/u1/s1/photo.jpg"],
    });
  });

  test("list with prefix=feedback/ returns the consented photos only", async () => {
    const res = await call("/ai/dataset/list?prefix=feedback%2F");
    expect((await res.json()) as { keys: string[] }).toEqual({
      keys: ["feedback/u2/p1/meta.json", "feedback/u2/p1/photo.jpg"],
    });
  });

  test.each(["scans/", "scan-src/", "dataset/u1/", "feedback", ""])(
    "list refuses prefix %p unless it is one of the two roots",
    async (prefix) => {
      const res = await call(`/ai/dataset/list?prefix=${encodeURIComponent(prefix)}`);
      // "" falls back to the default; everything else is a 404.
      expect(res.status).toBe(prefix === "" ? 200 : 404);
    },
  );

  test("object serves both prefixes", async () => {
    expect(await (await call("/ai/dataset/object?key=dataset/u1/s1/photo.jpg")).text()).toBe("jpg");
    expect(await (await call("/ai/dataset/object?key=feedback/u2/p1/photo.jpg")).text()).toBe("jpg");
  });

  test.each(["scans/x.png", "scan-src/u1/p1", "feedback/../scans/x.png", "dataset/gone/meta.json"])(
    "object 404s for %s",
    async (key) => {
      expect((await call(`/ai/dataset/object?key=${encodeURIComponent(key)}`)).status).toBe(404);
    },
  );

  test("the key gate answers 404 for both routes", async () => {
    for (const path of ["/ai/dataset/list", "/ai/dataset/list?prefix=feedback%2F", "/ai/dataset/object?key=feedback/u2/p1/photo.jpg"]) {
      expect((await call(path, "wrong")).status).toBe(404);
      expect((await call(path, null)).status).toBe(404);
    }
  });
});
