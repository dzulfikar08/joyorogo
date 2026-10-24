import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import {
  APP_SEGMENTS,
  SHARED_SEGMENTS,
  SITE_SEGMENTS,
  appHref,
  areaOf,
  landingSkipsForSignedIn,
  hostConfig,
  hostRedirect,
} from "./hosts";

const config = hostConfig("https://joyorogo.com", "https://app.joyorogo.com");

describe("areaOf", () => {
  test.each([
    ["/my", "site"],
    ["/my/", "site"],
    ["/sg", "site"],
    ["/sg/", "site"],
    ["/", "site"],
    ["/harga", "site"],
    ["/harga/", "site"],
    ["/panduan/ai", "site"],
    ["/panduan/kalori", "site"],
    ["/blog/", "site"],
    ["/blog/cara-menghitung-defisit-kalori/", "site"],
    ["/blog/rss.xml", "site"],
    ["/privasi", "site"],
    ["/syarat", "site"],
    ["/pengembalian-dana", "site"],
    ["/sitemap.xml", "site"],
    ["/llms.txt", "site"],
    ["/login", "app"],
    ["/beranda", "app"],
    ["/makan/ai", "app"],
    ["/grup/abc/tantangan/xyz", "app"],
    ["/profil/strava/callback", "app"],
    ["/profil/coros/callback", "app"],
    ["/koneksi/izin", "app"],
    ["/pembayaran", "app"],
    ["/pro", "app"],
    ["/gabung/ABCD2345", "shared"],
    ["/u/budi", "shared"],
    ["/p/00000000-0000-0000-0000-000000000000", "shared"],
    ["/manifest.webmanifest", "shared"],
    ["/sw.js", "shared"],
    ["/assets/index-abc.js", "shared"],
    ["/tidak-ada", "shared"],
  ] as const)("%s is %s", (path, area) => {
    expect(areaOf(path)).toBe(area);
  });

  test("a segment only matches whole: /produk is not /pro, /blogger is not /blog, /mypage is not /my", () => {
    expect(areaOf("/produk")).toBe("shared");
    expect(areaOf("/blogger")).toBe("shared");
    expect(areaOf("/mypage")).toBe("shared");
  });

  test("every top-level route of the SPA is classified", () => {
    const routes = join(import.meta.dir, "../routes");
    const segments = new Set<string>();
    for (const entry of readdirSync(routes, { withFileTypes: true })) {
      const name = entry.name.replace(/\.tsx?$/, "");
      if (name.startsWith("__") || name === "index") continue;
      if (name === "_auth") {
        for (const child of readdirSync(join(routes, name), { withFileTypes: true })) {
          const route = child.name.replace(/\.tsx?$/, "");
          if (route === "route") continue;
          // grup_.$groupId.var.saya -> grup; profil.strava.callback -> profil
          segments.add(route.split(".")[0]!.replace(/_$/, ""));
        }
      } else {
        segments.add(name.split(".")[0]!.replace(/_$/, ""));
      }
    }
    const known = new Set([...APP_SEGMENTS, ...SITE_SEGMENTS, ...SHARED_SEGMENTS]);
    expect([...segments].filter((segment) => !known.has(segment))).toEqual([]);
  });

  test("no segment is in two lists", () => {
    const all = [...APP_SEGMENTS, ...SITE_SEGMENTS, ...SHARED_SEGMENTS];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("hostConfig", () => {
  test("needs both origins and two different hosts", () => {
    expect(hostConfig("https://joyorogo.com", undefined)).toBeNull();
    expect(hostConfig(undefined, "https://app.joyorogo.com")).toBeNull();
    expect(hostConfig("https://joyorogo.com", "https://joyorogo.com/")).toBeNull();
    expect(hostConfig("nope", "https://app.joyorogo.com")).toBeNull();
    expect(config).toMatchObject({ siteHost: "joyorogo.com", appHost: "app.joyorogo.com" });
  });

  test("tolerates a trailing slash", () => {
    expect(hostConfig("https://joyorogo.com/", "https://app.joyorogo.com/")?.appOrigin).toBe(
      "https://app.joyorogo.com",
    );
  });
});

describe("hostRedirect on the site host", () => {
  const site = "joyorogo.com";

  test("app paths go to the app host, query and hash intact", () => {
    expect(hostRedirect(config, site, "/beranda")).toBe("https://app.joyorogo.com/beranda");
    expect(hostRedirect(config, site, "/login", "?redirect=%2Fgabung%2FABCD2345")).toBe(
      "https://app.joyorogo.com/login?redirect=%2Fgabung%2FABCD2345",
    );
    expect(hostRedirect(config, site, "/koneksi/izin", "?client_id=x&exp=1&sig=a%2Bb%3D")).toBe(
      "https://app.joyorogo.com/koneksi/izin?client_id=x&exp=1&sig=a%2Bb%3D",
    );
    expect(hostRedirect(config, site, "/pembayaran", "?order=ord_1", "#top")).toBe(
      "https://app.joyorogo.com/pembayaran?order=ord_1#top",
    );
  });

  test("marketing, shared and static paths stay", () => {
    for (const path of ["/", "/my", "/sg", "/harga", "/panduan/ai", "/blog/", "/privasi", "/syarat", "/gabung/ABCD2345", "/u/budi", "/sw.js"]) {
      expect(hostRedirect(config, site, path)).toBeNull();
    }
  });
});

describe("hostRedirect on the app host", () => {
  const app = "app.joyorogo.com";

  test("root goes to the app home", () => {
    expect(hostRedirect(config, app, "/")).toBe("https://app.joyorogo.com/beranda");
    expect(hostRedirect(config, app, "/", "?utm_source=x")).toBe("https://app.joyorogo.com/beranda?utm_source=x");
  });

  test("marketing paths go back to the site", () => {
    expect(hostRedirect(config, app, "/harga")).toBe("https://joyorogo.com/harga");
    expect(hostRedirect(config, app, "/panduan/kalori", "", "#calibration")).toBe(
      "https://joyorogo.com/panduan/kalori#calibration",
    );
    expect(hostRedirect(config, app, "/blog/judul/")).toBe("https://joyorogo.com/blog/judul/");
    expect(hostRedirect(config, app, "/privasi")).toBe("https://joyorogo.com/privasi");
    expect(hostRedirect(config, app, "/my")).toBe("https://joyorogo.com/my");
    expect(hostRedirect(config, app, "/sitemap.xml")).toBe("https://joyorogo.com/sitemap.xml");
  });

  test("app, shared and static paths stay", () => {
    for (const path of ["/beranda", "/login", "/makan/ai", "/gabung/ABCD2345", "/u/budi", "/p/x", "/manifest.webmanifest", "/sw.js", "/assets/a.js"]) {
      expect(hostRedirect(config, app, path)).toBeNull();
    }
  });
});

describe("hostRedirect elsewhere", () => {
  test("another host (workers.dev, localhost) and no config never redirect", () => {
    expect(hostRedirect(config, "joyorogo-web.workers.dev", "/beranda")).toBeNull();
    expect(hostRedirect(config, "localhost:3001", "/harga")).toBeNull();
    expect(hostRedirect(null, "joyorogo.com", "/beranda")).toBeNull();
  });
});

describe("landingSkipsForSignedIn", () => {
  test("a signed-in visitor stays on the landing when the app has its own host", () => {
    expect(landingSkipsForSignedIn(config)).toBe(false);
  });

  test("the landing still forwards signed-in visitors when one host serves everything", () => {
    expect(landingSkipsForSignedIn(null)).toBe(true);
  });
});

describe("appHref", () => {
  test("absolute from the site host, relative everywhere else", () => {
    expect(appHref(config, "joyorogo.com", "/login")).toBe("https://app.joyorogo.com/login");
    expect(appHref(config, "app.joyorogo.com", "/login")).toBe("/login");
    expect(appHref(config, "localhost:3001", "/login")).toBe("/login");
    expect(appHref(null, "joyorogo.com", "/login")).toBe("/login");
  });
});
