import { describe, expect, test } from "bun:test";

import worker from "./index";

const env = {
  API_URL: "https://api.joyorogo.com",
  SITE_URL: "https://joyorogo.com",
  APP_URL: "https://app.joyorogo.com",
  ASSETS: {
    fetch: async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith(".js")) return new Response("js", { headers: { "Content-Type": "text/javascript" } });
      return new Response("<html></html>", { headers: { "Content-Type": "text/html" } });
    },
  },
};
const ctx = { waitUntil() {}, passThroughOnException() {} };

const call = (url: string, init?: RequestInit, override: Partial<typeof env> = {}) =>
  worker.fetch(new Request(url, init), { ...env, ...override } as never, ctx as never);

describe("joyorogo.com", () => {
  test("app paths redirect to the app host with the query untouched", async () => {
    const res = await call("https://joyorogo.com/login?redirect=%2Fgabung%2FABCD2345");
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("https://app.joyorogo.com/login?redirect=%2Fgabung%2FABCD2345");
  });

  test("the old installed PWA start URL lands on the app host", async () => {
    const res = await call("https://joyorogo.com/beranda");
    expect(res.headers.get("Location")).toBe("https://app.joyorogo.com/beranda");
  });

  test("HEAD redirects too, other methods pass through", async () => {
    expect((await call("https://joyorogo.com/makan", { method: "HEAD" })).status).toBe(301);
    expect((await call("https://joyorogo.com/makan", { method: "POST", body: "x" })).status).toBe(200);
  });

  test("marketing pages are served, without a noindex header", async () => {
    for (const path of ["/", "/harga", "/panduan/ai", "/blog/", "/privasi", "/syarat"]) {
      const res = await call(`https://joyorogo.com${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("X-Robots-Tag")).toBeNull();
    }
  });
});

describe("app.joyorogo.com", () => {
  test("root goes to the app home", async () => {
    const res = await call("https://app.joyorogo.com/?utm_source=x");
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("https://app.joyorogo.com/beranda?utm_source=x");
  });

  test("marketing pages go back to the site", async () => {
    const res = await call("https://app.joyorogo.com/harga");
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("https://joyorogo.com/harga");
  });

  test("app pages are served and kept out of search", async () => {
    const res = await call("https://app.joyorogo.com/beranda");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
  });

  test("scripts are passed through untouched", async () => {
    const res = await call("https://app.joyorogo.com/assets/index-abc.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Robots-Tag")).toBeNull();
  });

  test("robots.txt allows crawling, so crawlers see the noindex header", async () => {
    const res = await call("https://app.joyorogo.com/robots.txt");
    expect(await res.text()).toBe("User-agent: *\nAllow: /\n");
  });
});

describe("without a split", () => {
  test("workers.dev serves every path", async () => {
    for (const path of ["/", "/beranda", "/harga", "/login"]) {
      expect((await call(`https://joyorogo-web.example.workers.dev${path}`)).status).toBe(200);
    }
  });

  test("no APP_URL means one host serves everything", async () => {
    const res = await call("https://joyorogo.com/beranda", undefined, { APP_URL: undefined });
    expect(res.status).toBe(200);
  });
});

describe("videos", () => {
  const bytes = new Uint8Array(100).map((_, i) => i);
  const videoEnv = {
    ASSETS: {
      fetch: async () => new Response(bytes, { headers: { "Content-Type": "video/mp4", "Content-Length": "100" } }),
    },
  };
  const get = (range?: string) =>
    call("https://joyorogo.com/landing/demo/scan-16x9.mp4", range ? { headers: { Range: range } } : undefined, videoEnv as never);

  test("a byte range answers 206 with Content-Range (Safari needs it to play)", async () => {
    const res = await get("bytes=0-1");
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 0-1/100");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([0, 1]);
  });

  test("open-ended and suffix ranges", async () => {
    expect((await get("bytes=90-")).headers.get("Content-Range")).toBe("bytes 90-99/100");
    const tail = await get("bytes=-5");
    expect(tail.headers.get("Content-Range")).toBe("bytes 95-99/100");
    expect(tail.headers.get("Content-Length")).toBe("5");
  });

  test("no range is the whole file, an impossible one is 416", async () => {
    const full = await get();
    expect(full.status).toBe(200);
    expect(full.headers.get("Accept-Ranges")).toBe("bytes");
    expect((await full.arrayBuffer()).byteLength).toBe(100);
    expect((await get("bytes=200-300")).status).toBe(416);
  });
});
