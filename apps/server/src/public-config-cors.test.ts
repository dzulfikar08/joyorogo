import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { registerPublicConfigCors } from "./public-config-cors";

const credentialed = ["https://joyorogo.com"];

function app() {
  const a = new Hono();
  registerPublicConfigCors(a, credentialed);
  a.use("/*", cors({ origin: credentialed, credentials: true }));
  a.get("/api/config", (c) => c.json({ ok: true }));
  a.get("/api/me", (c) => c.json({ me: true }));
  return a;
}

const get = (path: string, origin: string) => app().request(path, { headers: { Origin: origin } });

describe("public /api/config CORS", () => {
  test("lets fit.joyorogo.com read the config, without credentials", async () => {
    const res = await get("/api/config", "https://fit.joyorogo.com");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://fit.joyorogo.com");
    expect(res.headers.get("Access-Control-Allow-Credentials")).not.toBe("true");
  });

  test("leaves other endpoints closed to it", async () => {
    const res = await get("/api/me", "https://fit.joyorogo.com");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  test("ignores other origins", async () => {
    const res = await get("/api/config", "https://evil.example");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  test("keeps the credentialed answer for the app's own origins", async () => {
    const res = await get("/api/config", "https://joyorogo.com");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://joyorogo.com");
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });
});
