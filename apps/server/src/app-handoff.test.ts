import { describe, expect, test } from "bun:test";

import { androidAppHandoff, handoffHtml } from "./app-handoff";

const CALLBACK = "https://api.joyorogo.com/api/auth/callback/google?state=abc&code=xyz";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const APP_URL = "joyofit:///?cookie=__Secure-better-auth.session_token%3Dtok.sig%3B%20Max-Age%3D604800";

function redirect(location: string, status = 302): Response {
  const headers = new Headers({ location });
  headers.append("set-cookie", "__Secure-better-auth.session_token=tok.sig; Max-Age=604800; Path=/; HttpOnly; Secure");
  headers.append("set-cookie", "__Secure-better-auth.session_data=data; Max-Age=300; Path=/; HttpOnly; Secure");
  return new Response(null, { status, headers });
}

const SECRET = "test-secret";
const ERROR_PAGE = "https://api.joyorogo.com/api/auth/error?error=state_mismatch";

function browserRequest(
  userAgent: string,
  init: { url?: string; method?: string; language?: string; cookie?: string } = {},
): Request {
  const headers: Record<string, string> = { "user-agent": userAgent };
  if (init.language) headers["accept-language"] = init.language;
  if (init.cookie) headers.cookie = init.cookie;
  return new Request(init.url ?? CALLBACK, { method: init.method ?? "GET", headers });
}

function handoff(request: Request, response: Response): Promise<Response | null> {
  return androidAppHandoff(request, response, SECRET);
}

/** The Cookie header Chrome would send after the hand-off page's Set-Cookie (name=value only). */
function replayCookieOf(page: Response | null): string {
  const set = page?.headers.getSetCookie().find((cookie) => cookie.startsWith("joyo_handoff="));
  return (set ?? "").split(";")[0] ?? "";
}

describe("androidAppHandoff", () => {
  test("turns the redirect to the app scheme into a page with a link and an automatic attempt", async () => {
    const page = await handoff(browserRequest(ANDROID_CHROME), redirect(APP_URL));
    expect(page).not.toBeNull();
    expect(page?.status).toBe(200);
    expect(page?.headers.get("location")).toBeNull();
    expect(page?.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page?.headers.get("cache-control")).toBe("no-store");
    const html = await page?.text();
    expect(html).toContain(`href="${APP_URL}"`);
    expect(html).toContain(`location.replace(${JSON.stringify(APP_URL)})`);
    expect(html).toContain("Buka JoyoFit");
  });

  test("keeps every Set-Cookie of the redirect and adds the replay cookie", async () => {
    const page = await handoff(browserRequest(ANDROID_CHROME), redirect(APP_URL));
    const cookies = page?.headers.getSetCookie() ?? [];
    expect(cookies).toHaveLength(3);
    const replay = cookies.find((cookie) => cookie.startsWith("joyo_handoff="));
    expect(replay).toContain("Max-Age=600");
    expect(replay).toContain("Path=/api/auth/callback");
    expect(replay).toContain("HttpOnly");
    expect(replay).toContain("Secure");
  });

  test("names the app by its scheme", async () => {
    const rogo = await handoff(browserRequest(ANDROID_CHROME), redirect("joyorogo:///?cookie=x"));
    expect(await rogo?.text()).toContain("Buka JoyoRogo");
    const other = await handoff(browserRequest(ANDROID_CHROME), redirect("someapp://done"));
    expect(await other?.text()).toContain("Buka aplikasi");
  });

  test("speaks English to an English browser", async () => {
    const page = await handoff(browserRequest(ANDROID_CHROME, { language: "en-US,en;q=0.9" }), redirect(APP_URL));
    const html = await page?.text();
    expect(html).toContain('lang="en"');
    expect(html).toContain("Open JoyoFit");
  });

  test("speaks Malay to a Malay browser", async () => {
    const page = await handoff(browserRequest(ANDROID_CHROME, { language: "ms-MY,ms;q=0.9,en;q=0.8" }), redirect(APP_URL));
    const html = await page?.text();
    expect(html).toContain('lang="ms"');
    expect(html).toContain("Buka JoyoFit");
    expect(html).toContain("ketik butang");
  });

  test("passes through the redirects that must stay redirects", async () => {
    // iOS: ASWebAuthenticationSession follows the scheme redirect itself.
    expect(await handoff(browserRequest(IPHONE_SAFARI), redirect(APP_URL))).toBeNull();
    // Web sign-in goes back to an https page.
    expect(await handoff(browserRequest(ANDROID_CHROME), redirect("https://app.joyorogo.com/beranda"))).toBeNull();
    // The app's own requests and non-redirect answers.
    expect(await handoff(browserRequest("okhttp/4.12.0", { method: "POST" }), new Response("{}"))).toBeNull();
    expect(await handoff(browserRequest(ANDROID_CHROME), new Response("{}", { status: 200 }))).toBeNull();
    // Only the auth endpoints.
    expect(
      await handoff(browserRequest(ANDROID_CHROME, { url: "https://api.joyorogo.com/u/abc" }), redirect(APP_URL)),
    ).toBeNull();
  });
});

describe("androidAppHandoff replay of a used callback", () => {
  test("a second load of the callback shows the hand-off page again instead of state_mismatch", async () => {
    const first = await handoff(browserRequest(ANDROID_CHROME), redirect(APP_URL));
    const cookie = replayCookieOf(first);
    expect(cookie).not.toBe("");
    const second = await handoff(browserRequest(ANDROID_CHROME, { cookie }), redirect(ERROR_PAGE));
    expect(second?.status).toBe(200);
    expect(second?.headers.get("location")).toBeNull();
    expect(second?.headers.getSetCookie()).toHaveLength(0);
    const html = await second?.text();
    expect(html).toContain(`href="${APP_URL}"`);
    expect(html).toContain("Buka JoyoFit");
  });

  test("also covers state_not_found, with other cookies around the replay cookie", async () => {
    const first = await handoff(browserRequest(ANDROID_CHROME), redirect("joyorogo:///?cookie=x"));
    const cookie = `a=b; ${replayCookieOf(first)}; c=d`;
    const second = await handoff(
      browserRequest(ANDROID_CHROME, { cookie }),
      redirect("https://api.joyorogo.com/api/auth/error?error=state_not_found"),
    );
    expect(await second?.text()).toContain("Buka JoyoRogo");
  });

  test("without the cookie the error page stays", async () => {
    expect(await handoff(browserRequest(ANDROID_CHROME), redirect(ERROR_PAGE))).toBeNull();
  });

  test("a forged or altered cookie is ignored", async () => {
    const value = replayCookieOf(await handoff(browserRequest(ANDROID_CHROME), redirect(APP_URL))).split("=")[1] ?? "";
    const evil = btoa("joyorogo:///?cookie=evil").replace(/=+$/, "");
    const signature = value.split(".")[1];
    for (const cookie of [`joyo_handoff=${evil}.${signature}`, `joyo_handoff=${evil}`, "joyo_handoff=.", "joyo_handoff=x.y"]) {
      expect(await handoff(browserRequest(ANDROID_CHROME, { cookie }), redirect(ERROR_PAGE))).toBeNull();
    }
    // Signed with another secret.
    const other = await androidAppHandoff(browserRequest(ANDROID_CHROME), redirect(APP_URL), "another-secret");
    expect(
      await handoff(browserRequest(ANDROID_CHROME, { cookie: replayCookieOf(other) }), redirect(ERROR_PAGE)),
    ).toBeNull();
  });

  test("only a state error of a callback is replayed, and only on Android", async () => {
    const cookie = replayCookieOf(await handoff(browserRequest(ANDROID_CHROME), redirect(APP_URL)));
    const other = redirect("https://api.joyorogo.com/api/auth/error?error=invalid_code");
    expect(await handoff(browserRequest(ANDROID_CHROME, { cookie }), other)).toBeNull();
    expect(await handoff(browserRequest(IPHONE_SAFARI, { cookie }), redirect(ERROR_PAGE))).toBeNull();
    const elsewhere = browserRequest(ANDROID_CHROME, { cookie, url: "https://api.joyorogo.com/api/auth/magic-link/verify?token=x" });
    expect(await handoff(elsewhere, redirect(ERROR_PAGE))).toBeNull();
  });
});

describe("handoffHtml", () => {
  test("a target cannot break out of the attribute or the script", () => {
    const html = handoffHtml('joyofit:///?x="><script>alert(1)</script>', "id");
    expect(html).not.toContain('"><script>alert(1)');
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html).toContain("\\u003c/script>");
  });
});
