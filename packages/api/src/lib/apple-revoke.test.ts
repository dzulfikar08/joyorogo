import { afterEach, describe, expect, test } from "bun:test";

import {
  appleRevokeConfig,
  buildAppleClientSecret,
  revokeAppleAuthorization,
} from "./apple-revoke";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function b64urlDecode(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function testKey() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  let bin = "";
  for (const b of pkcs8) bin += String.fromCharCode(b);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(bin)}\n-----END PRIVATE KEY-----`;
  return { pem, publicKey: pair.publicKey };
}

describe("appleRevokeConfig", () => {
  test("null without key id / key, applies defaults", () => {
    expect(appleRevokeConfig({})).toBeNull();
    expect(appleRevokeConfig({ APPLE_SIWA_KEY_ID: "K" })).toBeNull();
    expect(appleRevokeConfig({ APPLE_SIWA_KEY_ID: "K", APPLE_SIWA_PRIVATE_KEY: "P" })).toEqual({
      teamId: "F6Q6UFUK69",
      keyId: "K",
      privateKeyPem: "P",
      clientId: "com.joyodigitama.joyorogo",
    });
  });
});

describe("buildAppleClientSecret", () => {
  test("ES256 JWT with Apple claims and a verifiable signature", async () => {
    const { pem, publicKey } = await testKey();
    const now = Date.parse("2026-10-15T00:00:00Z");
    const jwt = await buildAppleClientSecret(
      { teamId: "TEAM", keyId: "KID", privateKeyPem: pem, clientId: "com.x.y" },
      now,
    );
    const [h, p, s] = jwt.split(".") as [string, string, string];
    const dec = new TextDecoder();
    expect(JSON.parse(dec.decode(b64urlDecode(h)))).toMatchObject({ alg: "ES256", kid: "KID" });
    const claims = JSON.parse(dec.decode(b64urlDecode(p)));
    expect(claims).toEqual({
      iss: "TEAM",
      iat: now / 1000,
      exp: now / 1000 + 300,
      aud: "https://appleid.apple.com",
      sub: "com.x.y",
    });
    const sig = b64urlDecode(s);
    expect(sig.length).toBe(64);
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      sig,
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });
});

describe("revokeAppleAuthorization", () => {
  async function config() {
    const { pem } = await testKey();
    return { teamId: "TEAM", keyId: "KID", privateKeyPem: pem, clientId: "com.x.y" };
  }

  function mockFetch(handler: (url: string, form: URLSearchParams) => Response) {
    const calls: { url: string; form: URLSearchParams }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const form = new URLSearchParams(String(init?.body));
      calls.push({ url, form });
      return handler(url, form);
    }) as typeof fetch;
    return calls;
  }

  test("exchanges the code then revokes the refresh token", async () => {
    const calls = mockFetch((url) =>
      url.endsWith("/auth/token")
        ? Response.json({ refresh_token: "R", access_token: "A" })
        : new Response("", { status: 200 }),
    );
    await revokeAppleAuthorization(await config(), "CODE");
    expect(calls.map((c) => c.url)).toEqual([
      "https://appleid.apple.com/auth/token",
      "https://appleid.apple.com/auth/revoke",
    ]);
    expect(calls[0]!.form.get("grant_type")).toBe("authorization_code");
    expect(calls[0]!.form.get("code")).toBe("CODE");
    expect(calls[0]!.form.get("client_id")).toBe("com.x.y");
    expect(calls[1]!.form.get("token")).toBe("R");
    expect(calls[1]!.form.get("token_type_hint")).toBe("refresh_token");
  });

  test("falls back to the access token", async () => {
    const calls = mockFetch((url) =>
      url.endsWith("/auth/token") ? Response.json({ access_token: "A" }) : new Response(""),
    );
    await revokeAppleAuthorization(await config(), "CODE");
    expect(calls[1]!.form.get("token")).toBe("A");
    expect(calls[1]!.form.get("token_type_hint")).toBe("access_token");
  });

  test("throws when exchange or revoke fails", async () => {
    mockFetch(() => new Response("no", { status: 400 }));
    await expect(revokeAppleAuthorization(await config(), "CODE")).rejects.toThrow("token exchange");
    mockFetch((url) =>
      url.endsWith("/auth/token") ? Response.json({ refresh_token: "R" }) : new Response("no", { status: 500 }),
    );
    await expect(revokeAppleAuthorization(await config(), "CODE")).rejects.toThrow("revoke failed");
  });
});
