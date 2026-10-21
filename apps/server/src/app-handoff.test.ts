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

function browserRequest(userAgent: string, init: { url?: string; method?: string; language?: string } = {}): Request {
  const headers: Record<string, string> = { "user-agent": userAgent };
  if (init.language) headers["accept-language"] = init.language;
  return new Request(init.url ?? CALLBACK, { method: init.method ?? "GET", headers });
}

describe("androidAppHandoff", () => {
  test("turns the redirect to the app scheme into a page with a link and an automatic attempt", async () => {
    const page = androidAppHandoff(browserRequest(ANDROID_CHROME), redirect(APP_URL));
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

  test("keeps every Set-Cookie of the redirect", () => {
    const page = androidAppHandoff(browserRequest(ANDROID_CHROME), redirect(APP_URL));
    expect(page?.headers.getSetCookie()).toHaveLength(2);
  });

  test("names the app by its scheme", async () => {
    const rogo = androidAppHandoff(browserRequest(ANDROID_CHROME), redirect("joyorogo:///?cookie=x"));
    expect(await rogo?.text()).toContain("Buka JoyoRogo");
    const other = androidAppHandoff(browserRequest(ANDROID_CHROME), redirect("someapp://done"));
    expect(await other?.text()).toContain("Buka aplikasi");
  });

  test("speaks English to an English browser", async () => {
    const page = androidAppHandoff(browserRequest(ANDROID_CHROME, { language: "en-US,en;q=0.9" }), redirect(APP_URL));
    const html = await page?.text();
    expect(html).toContain('lang="en"');
    expect(html).toContain("Open JoyoFit");
  });

  test("passes through the redirects that must stay redirects", () => {
    // iOS: ASWebAuthenticationSession follows the scheme redirect itself.
    expect(androidAppHandoff(browserRequest(IPHONE_SAFARI), redirect(APP_URL))).toBeNull();
    // Web sign-in goes back to an https page.
    expect(androidAppHandoff(browserRequest(ANDROID_CHROME), redirect("https://app.joyorogo.com/beranda"))).toBeNull();
    // The app's own requests and non-redirect answers.
    expect(androidAppHandoff(browserRequest("okhttp/4.12.0", { method: "POST" }), new Response("{}"))).toBeNull();
    expect(androidAppHandoff(browserRequest(ANDROID_CHROME), new Response("{}", { status: 200 }))).toBeNull();
    // Only the auth endpoints.
    expect(
      androidAppHandoff(browserRequest(ANDROID_CHROME, { url: "https://api.joyorogo.com/u/abc" }), redirect(APP_URL)),
    ).toBeNull();
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
