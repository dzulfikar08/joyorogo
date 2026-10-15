import { describe, expect, test } from "bun:test";

import { analyticsTag } from "../../blog/render.ts";
import { REVKLIK_GUARD } from "../../blog/revklik.ts";
import { shareUrl } from "./share-links";

const TRACK = "https://app.revklik.com/api/track";

type Item = { t: string; p?: string; n?: string; pr?: Record<string, unknown>; r?: string };

/** The guard exactly as the page runs it, on a fake window whose fetch records what leaves. */
function page() {
  const sent: { url: unknown; init?: RequestInit }[] = [];
  const win = {
    fetch: async (url: unknown, init?: RequestInit) => {
      sent.push({ url, init });
      return new Response("{}");
    },
  };
  new Function("window", "location", REVKLIK_GUARD)(win, new URL("https://joyorogo.com/makan"));
  const track = (batch: Item[], init: RequestInit = {}) =>
    win.fetch(TRACK, { method: "POST", keepalive: true, ...init, body: JSON.stringify(batch) });
  const leftWith = () => sent.map((s) => JSON.parse(String(s.init?.body)) as Item[]);
  return { win, sent, track, leftWith };
}

describe("Revklik guard", () => {
  test("drops in-app pageviews, events and heartbeats before they leave the page", async () => {
    const { track, sent } = page();
    const res = await track([
      { t: "p", p: "/makan" },
      { t: "e", n: "heartbeat", p: "/makan", pr: { seconds: 9 } },
      { t: "p", p: "/beranda" },
      { t: "e", n: "click", p: "/profil" },
      { t: "p", p: "/gabung/KURUNG23" },
      { t: "e", n: "scroll" },
    ]);
    expect(sent).toHaveLength(0);
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({});
  });

  test("lets the marketing funnel and public community pages through", async () => {
    const { track, leftWith } = page();
    const paths = [
      "/",
      "/harga",
      "/login",
      "/pembayaran",
      "/privasi",
      "/blog/",
      "/blog/kalori-mie/",
      "/u/budi",
      "/p/abc-123",
    ];
    await track(paths.map((p) => ({ t: "p", p })));
    expect(leftWith()[0]?.map((item) => item.p)).toEqual(paths);
  });

  test("keeps conversions wherever they fire", async () => {
    const { track, leftWith } = page();
    const batch = [
      { t: "c", n: "onboarding_complete", p: "/onboarding" },
      { t: "c", n: "founder_purchase", p: "/pembayaran" },
      { t: "c", n: "onboarding_group_created", p: "/onboarding" },
    ];
    await track(batch);
    expect(leftWith()).toEqual([batch]);
  });

  test("cuts a mixed batch down and keeps the request options, keepalive included", async () => {
    const { track, sent, leftWith } = page();
    await track(
      [
        { t: "p", p: "/makan" },
        { t: "e", n: "heartbeat", p: "/harga", pr: { seconds: 12 } },
        { t: "c", n: "founder_purchase", p: "/makan" },
      ],
      { headers: { "Content-Type": "application/json" } },
    );
    expect(leftWith()).toEqual([
      [
        { t: "e", n: "heartbeat", p: "/harga", pr: { seconds: 12 } },
        { t: "c", n: "founder_purchase", p: "/makan" },
      ],
    ]);
    expect(sent[0]?.init).toMatchObject({
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
    });
  });

  test("cuts invite codes out of paths, encoded redirects, and share URLs", async () => {
    const { track, leftWith } = page();
    await track([
      { t: "c", n: "google_signin", p: "/gabung/KURUNG23" },
      {
        t: "p",
        p: "/login",
        r: "https://joyorogo.com/gabung/KURUNG23?utm_source=app-share",
        pr: { href: "https://joyorogo.com/login?redirect=%2Fgabung%2FKURUNG23" },
      },
    ]);
    const out = JSON.stringify(leftWith());
    expect(out).not.toContain("KURUNG23");
    expect(out).toContain('"/gabung"');
    expect(out).toContain("redirect=%2Fgabung");
    expect(out).toContain("/gabung?utm_source=app-share");
  });

  test("leaves other paths alone", async () => {
    const { track, leftWith } = page();
    const batch = [
      { t: "c", n: "a", p: "/blog/kalori-gorengan/" },
      { t: "p", p: "/u/budi" },
      { t: "c", n: "b", p: "/gabungan" },
    ];
    await track(batch);
    expect(leftWith()).toEqual([batch]);
  });

  test("passes other requests and unreadable bodies through untouched", async () => {
    const { win, sent } = page();
    const api = { method: "POST", body: JSON.stringify([{ t: "p", p: "/makan" }]) };
    await win.fetch("https://api.joyorogo.com/rpc/meal", api);
    await win.fetch(TRACK, { method: "POST", body: "not json" });
    await win.fetch(TRACK, { method: "POST", body: new Uint8Array([1]) as unknown as string });
    await win.fetch(TRACK);
    expect(sent.map((s) => s.url)).toEqual([
      "https://api.joyorogo.com/rpc/meal",
      TRACK,
      TRACK,
      TRACK,
    ]);
    expect(sent[0]?.init).toBe(api);
  });

  test("recognises the track endpoint given as a URL or a Request", async () => {
    const { win, sent } = page();
    const init = { method: "POST", body: JSON.stringify([{ t: "p", p: "/makan" }]) };
    await win.fetch(new URL(TRACK), init);
    await win.fetch(new Request(TRACK), init);
    expect(sent).toHaveLength(0);
  });

  test("ships inline right before the tag", () => {
    const html = analyticsTag("site-1");
    expect(REVKLIK_GUARD).not.toContain("</script");
    expect(html.startsWith(`<script>${REVKLIK_GUARD}</script>`)).toBe(true);
    expect(html.indexOf("klikapa.js")).toBeGreaterThan(REVKLIK_GUARD.length);
    expect(html).toContain('data-site-id="site-1"');
  });
});

describe("shareUrl", () => {
  test("adds source, medium, campaign", () => {
    expect(shareUrl("/gabung/ABCD2345", "invite")).toBe(
      "https://joyorogo.com/gabung/ABCD2345?utm_source=app-share&utm_medium=invite&utm_campaign=share-web",
    );
    expect(shareUrl("/", "meal")).toBe(
      "https://joyorogo.com/?utm_source=app-share&utm_medium=meal&utm_campaign=share-web",
    );
  });
});
