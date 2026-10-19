import { describe, expect, test } from "bun:test";

import { nativeHref, parsePushData, pushData, webUrl } from "./push-link";
import type { PushLink } from "./push-link";

const LINKS: { link: PushLink; web: string; native: string }[] = [
  { link: { t: "post", postId: "p1" }, web: "/p/p1", native: "/feed/p1" },
  { link: { t: "post", postId: "p1", commentId: "c1" }, web: "/p/p1", native: "/feed/p1" },
  { link: { t: "profile", handle: "ann_k" }, web: "/u/ann_k", native: "/u/ann_k" },
  { link: { t: "feed" }, web: "/feed", native: "/feed/notifikasi" },
  { link: { t: "inbox" }, web: "/inbox", native: "/inbox" },
  { link: { t: "group", groupId: "g1" }, web: "/grup/g1", native: "/grup/g1" },
  { link: { t: "challenge", groupId: "g1", challengeId: "c1" }, web: "/grup/g1/tantangan/c1", native: "/grup/g1/tantangan/c1" },
  { link: { t: "makan" }, web: "/makan", native: "/(tabs)/makan" },
  { link: { t: "berat" }, web: "/berat", native: "/berat" },
  { link: { t: "rekap" }, web: "/rekap", native: "/rekap" },
  { link: { t: "beranda" }, web: "/beranda", native: "/(tabs)" },
  { link: { t: "rencana" }, web: "/rencana-makan", native: "/rencana-makan" },
  { link: { t: "settings" }, web: "/profil/notifikasi", native: "/profil/notifikasi" },
];

describe("push links", () => {
  test.each(LINKS)("$link.t -> web and native paths", ({ link, web, native }) => {
    expect(webUrl(link)).toBe(web);
    expect(nativeHref(link)).toBe(native);
  });

  test("ids are path-encoded", () => {
    expect(webUrl({ t: "profile", handle: "a b/c" })).toBe("/u/a%20b%2Fc");
    expect(nativeHref({ t: "post", postId: "x?y" })).toBe("/feed/x%3Fy");
  });

  test.each(LINKS)("parsePushData round-trips $link.t", ({ link }) => {
    const data = pushData("kudos", link, "joyorogo");
    expect(parsePushData(JSON.parse(JSON.stringify(data)))).toEqual(data);
  });

  test("the app marker survives, defaulting to joyorogo", () => {
    const fit = pushData("comment", { t: "post", postId: "p" }, "joyofit");
    expect(parsePushData(fit)?.app).toBe("joyofit");
    expect(parsePushData({ ...fit, app: "other" })?.app).toBe("joyorogo");
  });

  test("anything this pipeline did not send is null", () => {
    expect(parsePushData(null)).toBeNull();
    expect(parsePushData(undefined)).toBeNull();
    expect(parsePushData("x")).toBeNull();
    expect(parsePushData({})).toBeNull();
    // a local reminder or JoyoFit family alert
    expect(parsePushData({ type: "family_poke", linkId: "l1" })).toBeNull();
    expect(parsePushData({ v: 2, kind: "x", link: { t: "feed" } })).toBeNull();
    expect(parsePushData({ v: 1, kind: "x", link: { t: "nope" } })).toBeNull();
    expect(parsePushData({ v: 1, kind: "x", link: { t: "post" } })).toBeNull();
    expect(parsePushData({ v: 1, kind: "", link: { t: "feed" } })).toBeNull();
    expect(parsePushData({ v: 1, kind: "x", link: { t: "challenge", groupId: "g" } })).toBeNull();
  });

  test("the url is rebuilt from the link, not trusted from the payload", () => {
    const parsed = parsePushData({ v: 1, kind: "x", link: { t: "feed" }, url: "https://evil.example" });
    expect(parsed?.url).toBe("/feed");
  });
});
