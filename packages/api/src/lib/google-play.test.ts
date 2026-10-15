import { describe, expect, test } from "bun:test";

import {
  buildServiceAccountAssertion,
  createGoogleKeySource,
  createGooglePlayClient,
  googleFounderGrant,
  googlePlayConfig,
  parsePushNotification,
  tokenMatches,
  verifyPushJwt,
} from "./google-play";
import type { PushJwtOptions } from "./google-play";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 16, 3, 0, 0);

function b64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let bin = "";
  for (const b of raw) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}

async function rsaKey() {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(
    (await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer,
  );
  let bin = "";
  for (const b of pkcs8) bin += String.fromCharCode(b);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(bin)}\n-----END PRIVATE KEY-----\n`;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  return { pem, jwk, pair };
}

describe("googlePlayConfig", () => {
  const account = JSON.stringify({
    client_email: "svc@p.iam.gserviceaccount.com",
    private_key: "k",
  });

  test("null while the service account is unset or unusable (feature reports unavailable)", () => {
    expect(googlePlayConfig({})).toBeNull();
    expect(googlePlayConfig({ GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: "  " })).toBeNull();
    expect(googlePlayConfig({ GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: "{not json" })).toBeNull();
    expect(googlePlayConfig({ GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: "{}" })).toBeNull();
    expect(
      googlePlayConfig({
        GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({
          client_email: "a",
          private_key: "b",
          token_uri: "http://insecure.example/token",
        }),
      }),
    ).toBeNull();
  });

  test("applies defaults and normalizes the optional settings", () => {
    expect(googlePlayConfig({ GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: account })).toEqual({
      clientEmail: "svc@p.iam.gserviceaccount.com",
      privateKeyPem: "k",
      tokenUri: "https://oauth2.googleapis.com/token",
      packageName: "com.joyodigitama.joyorogo",
      testEmails: [],
      pushEmail: null,
      pushToken: null,
    });
    const full = googlePlayConfig({
      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: account,
      GOOGLE_PLAY_PACKAGE_NAME: "id.example.app",
      GOOGLE_PLAY_TEST_EMAILS: " A@x.id, b@x.id ,",
      GOOGLE_PLAY_RTDN_PUSH_EMAIL: "push@p.iam.gserviceaccount.com",
      GOOGLE_PLAY_RTDN_TOKEN: "s3cret",
    });
    expect(full).toMatchObject({
      packageName: "id.example.app",
      testEmails: ["a@x.id", "b@x.id"],
      pushEmail: "push@p.iam.gserviceaccount.com",
      pushToken: "s3cret",
    });
  });
});

describe("buildServiceAccountAssertion", () => {
  test("RS256 JWT with the Android Publisher scope and a verifiable signature", async () => {
    const { pem, pair } = await rsaKey();
    const jwt = await buildServiceAccountAssertion(
      {
        clientEmail: "svc@p.iam.gserviceaccount.com",
        privateKeyPem: pem,
        tokenUri: "https://oauth2.googleapis.com/token",
      },
      NOW,
    );
    const [head, payload, sig] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(head)))).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(payload)))).toEqual({
      iss: "svc@p.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: "https://oauth2.googleapis.com/token",
      iat: NOW / 1000,
      exp: NOW / 1000 + 3600,
    });
    expect(
      await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        pair.publicKey,
        b64urlDecode(sig),
        new TextEncoder().encode(`${head}.${payload}`),
      ),
    ).toBe(true);
  });
});

describe("createGooglePlayClient", () => {
  const subscriptionJson = {
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    latestOrderId: "GPA.1111-2222-3333-44444..1",
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
    externalAccountIdentifiers: { obfuscatedExternalAccountId: "user-1" },
    lineItems: [
      {
        productId: "pro",
        expiryTime: "2026-11-16T03:00:00.123Z",
        latestSuccessfulOrderId: "GPA.1111-2222-3333-44444..0",
        autoRenewingPlan: {
          autoRenewEnabled: true,
          recurringPrice: { currencyCode: "IDR", units: "15000" },
        },
        offerDetails: { basePlanId: "monthly" },
      },
    ],
  };

  async function setup(handler: (url: string, init: RequestInit | undefined) => Response) {
    const { pem } = await rsaKey();
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    let clock = NOW;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: `at-${calls.length}`, expires_in: 3600 });
      }
      return handler(url, init);
    }) as typeof fetch;
    const client = createGooglePlayClient(
      {
        clientEmail: "svc@p",
        privateKeyPem: pem,
        tokenUri: "https://oauth2.googleapis.com/token",
        packageName: "com.joyodigitama.joyorogo",
      },
      fetchImpl,
      () => clock,
    );
    return { client, calls, advance: (ms: number) => (clock += ms) };
  }

  test("subscriptionsv2.get: bearer token, URL-encoded token, normalized snapshot", async () => {
    const { client, calls } = await setup(() => Response.json(subscriptionJson));
    const sub = await client.getSubscription("tok/en+1");
    expect(sub).toEqual({
      state: "active",
      acknowledged: false,
      test: false,
      accountId: "user-1",
      productId: "pro",
      basePlanId: "monthly",
      expiresAt: new Date("2026-11-16T03:00:00.123Z"),
      orderId: "GPA.1111-2222-3333-44444..0",
      priceIdr: 15000,
    });
    const get = calls.find((c) => c.url.includes("subscriptionsv2"))!;
    expect(get.url).toBe(
      "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.joyodigitama.joyorogo/purchases/subscriptionsv2/tokens/tok%2Fen%2B1",
    );
    expect(new Headers(get.init?.headers).get("Authorization")).toBe("Bearer at-1");
    const form = new URLSearchParams(String(calls[0]!.init?.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(form.get("assertion")?.split(".")).toHaveLength(3);
  });

  test("reuses the OAuth token until a minute before expiry", async () => {
    const { client, calls, advance } = await setup(() => Response.json(subscriptionJson));
    await client.getSubscription("token-aaaaaaaa");
    await client.getSubscription("token-bbbbbbbb");
    expect(calls.filter((c) => c.url.includes("oauth2")).length).toBe(1);
    advance(3600 * 1000 - 30_000);
    await client.getSubscription("token-cccccccc");
    expect(calls.filter((c) => c.url.includes("oauth2")).length).toBe(2);
  });

  test("falls back to latestOrderId, flags test purchases and non-IDR prices", async () => {
    const { client } = await setup(() =>
      Response.json({
        subscriptionState: "SUBSCRIPTION_STATE_PENDING",
        latestOrderId: "GPA.9",
        testPurchase: {},
        lineItems: [
          {
            productId: "pro",
            autoRenewingPlan: { recurringPrice: { currencyCode: "USD", units: "1" } },
            offerDetails: { basePlanId: "yearly" },
          },
        ],
      }),
    );
    expect(await client.getSubscription("token-aaaaaaaa")).toMatchObject({
      state: "pending",
      acknowledged: true,
      test: true,
      accountId: null,
      orderId: "GPA.9",
      expiresAt: null,
      priceIdr: null,
    });
  });

  test("unknown token (400/404/410) is null; an outage or bad credentials throw", async () => {
    for (const status of [400, 404, 410]) {
      const { client } = await setup(() => new Response("{}", { status }));
      expect(await client.getSubscription("token-aaaaaaaa")).toBeNull();
    }
    for (const status of [401, 403, 429, 500]) {
      const { client } = await setup(() => new Response("{}", { status }));
      await expect(client.getSubscription("token-aaaaaaaa")).rejects.toThrow(String(status));
    }
  });

  test("a response without line items is not a subscription", async () => {
    const { client } = await setup(() =>
      Response.json({ subscriptionState: "SUBSCRIPTION_STATE_ACTIVE" }),
    );
    expect(await client.getSubscription("token-aaaaaaaa")).toBeNull();
  });

  test("acknowledge posts to the v1 endpoint for the subscription id", async () => {
    const { client, calls } = await setup(() => new Response(null, { status: 204 }));
    await client.acknowledge("pro", "token-aaaaaaaa");
    const ack = calls.find((c) => c.url.includes(":acknowledge"))!;
    expect(ack.url).toBe(
      "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.joyodigitama.joyorogo/purchases/subscriptions/pro/tokens/token-aaaaaaaa:acknowledge",
    );
    expect(ack.init?.method).toBe("POST");
  });

  test("acknowledge failure throws so the caller retries", async () => {
    const { client } = await setup(() => new Response("{}", { status: 500 }));
    await expect(client.acknowledge("pro", "token-aaaaaaaa")).rejects.toThrow("500");
  });

  test("OAuth failure throws", async () => {
    const { pem } = await rsaKey();
    const client = createGooglePlayClient(
      {
        clientEmail: "svc@p",
        privateKeyPem: pem,
        tokenUri: "https://oauth2.googleapis.com/token",
        packageName: "x",
      },
      (async () => new Response("{}", { status: 400 })) as unknown as typeof fetch,
    );
    await expect(client.getSubscription("token-aaaaaaaa")).rejects.toThrow("google oauth 400");
  });
});

describe("googleFounderGrant", () => {
  const now = new Date(NOW);
  const base = { buyerEmail: "Buyer@x.id", testEmails: ["owner@x.id"], priceIdr: 15000, now };

  test("paid orders stack the plan's months at the charged price", () => {
    const monthly = googleFounderGrant({ ...base, test: false, months: 1, current: null });
    expect(monthly.amountIdr).toBe(15000);
    expect(monthly.until.toISOString()).toBe("2026-11-16T03:00:00.000Z");
    const yearly = googleFounderGrant({
      ...base,
      test: false,
      months: 12,
      priceIdr: 150000,
      current: new Date("2027-01-31T00:00:00.000Z"),
    });
    expect(yearly.until.toISOString()).toBe("2028-01-31T00:00:00.000Z");
    expect(yearly.amountIdr).toBe(150000);
  });

  test("test purchase: allowlisted buyer gets the paid period, anyone else 24h at Rp0", () => {
    const allowed = googleFounderGrant({
      ...base,
      buyerEmail: "OWNER@x.id",
      test: true,
      months: 1,
      current: null,
    });
    expect(allowed.amountIdr).toBe(15000);
    const trial = googleFounderGrant({ ...base, test: true, months: 1, current: null });
    expect(trial).toEqual({ until: new Date(NOW + DAY), amountIdr: 0 });
    const stacked = googleFounderGrant({
      ...base,
      test: true,
      months: 1,
      current: new Date(NOW + 5 * DAY),
    });
    expect(stacked.until.getTime()).toBe(NOW + 6 * DAY);
  });
});

describe("parsePushNotification", () => {
  const push = (payload: unknown) => ({
    message: { data: btoa(JSON.stringify(payload)), messageId: "1" },
    subscription: "projects/p/subscriptions/s",
  });

  test("subscription, voided and test notifications", () => {
    expect(
      parsePushNotification(
        push({
          version: "1.0",
          packageName: "com.joyodigitama.joyorogo",
          eventTimeMillis: "1",
          subscriptionNotification: {
            version: "1.0",
            notificationType: 2,
            purchaseToken: "tok",
            subscriptionId: "pro",
          },
        }),
      ),
    ).toEqual({
      packageName: "com.joyodigitama.joyorogo",
      subscription: { notificationType: 2, purchaseToken: "tok", subscriptionId: "pro" },
      voided: undefined,
      test: false,
    });
    expect(
      parsePushNotification(
        push({
          packageName: "p",
          voidedPurchaseNotification: {
            purchaseToken: "tok",
            orderId: "GPA.1",
            productType: 1,
            refundType: 1,
          },
        }),
      )?.voided,
    ).toEqual({ purchaseToken: "tok", orderId: "GPA.1", productType: 1 });
    expect(
      parsePushNotification(push({ packageName: "p", testNotification: { version: "1.0" } }))?.test,
    ).toBe(true);
  });

  test("junk is null", () => {
    expect(parsePushNotification(null)).toBeNull();
    expect(parsePushNotification({ message: {} })).toBeNull();
    expect(parsePushNotification({ message: { data: "@@@" } })).toBeNull();
    expect(parsePushNotification(push({ nope: true }))).toBeNull();
  });
});

describe("tokenMatches", () => {
  test("constant-time equality; empty expected never matches", () => {
    expect(tokenMatches("abc", "abc")).toBe(true);
    expect(tokenMatches("abd", "abc")).toBe(false);
    expect(tokenMatches("ab", "abc")).toBe(false);
    expect(tokenMatches("", "")).toBe(false);
  });
});

describe("verifyPushJwt", () => {
  const AUDIENCE = "https://api.joyorogo.com/api/billing/google/rtdn";
  const EMAIL = "push@p.iam.gserviceaccount.com";

  async function signed(
    claims: Record<string, unknown>,
    opts: { alg?: string; kid?: string } = {},
  ) {
    const { pair, jwk } = await rsaKey();
    const head = b64url(
      JSON.stringify({ alg: opts.alg ?? "RS256", kid: opts.kid ?? "k1", typ: "JWT" }),
    );
    const body = b64url(JSON.stringify(claims));
    const sig = new Uint8Array(
      await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        pair.privateKey,
        new TextEncoder().encode(`${head}.${body}`),
      ),
    );
    return { jwt: `${head}.${body}.${b64url(sig)}`, jwk: { ...jwk, kid: opts.kid ?? "k1" } };
  }

  const good = {
    iss: "https://accounts.google.com",
    aud: AUDIENCE,
    exp: NOW / 1000 + 600,
    email: EMAIL,
    email_verified: true,
  };

  const verify = (
    jwt: string,
    jwk: JsonWebKey & { kid?: string },
    overrides: Partial<PushJwtOptions> = {},
  ) =>
    verifyPushJwt(jwt, {
      audience: AUDIENCE,
      email: EMAIL,
      key: async (kid) => (kid === jwk.kid ? jwk : null),
      nowMs: NOW,
      ...overrides,
    });

  test("accepts a Google-signed token for our endpoint and push service account", async () => {
    const { jwt, jwk } = await signed(good);
    expect(await verify(jwt, jwk)).toBe(true);
    const bare = await signed({ ...good, iss: "accounts.google.com", email: EMAIL.toUpperCase() });
    expect(await verify(bare.jwt, bare.jwk)).toBe(true);
  });

  test("rejects wrong audience, email, issuer, expiry, unverified email", async () => {
    for (const bad of [
      { aud: "https://evil.example/hook" },
      { email: "someone-else@p.iam.gserviceaccount.com" },
      { iss: "https://evil.example" },
      { exp: NOW / 1000 - 1 },
      { email_verified: false },
    ]) {
      const { jwt, jwk } = await signed({ ...good, ...bad });
      expect(await verify(jwt, jwk)).toBe(false);
    }
  });

  test("rejects a bad signature, an unknown key id, a wrong alg, and garbage", async () => {
    const a = await signed(good);
    const b = await signed(good);
    expect(await verify(a.jwt, b.jwk)).toBe(false);
    expect(await verify(a.jwt, a.jwk, { key: async () => null })).toBe(false);
    const hs = await signed(good, { alg: "HS256" });
    expect(await verify(hs.jwt, hs.jwk)).toBe(false);
    expect(await verify("not.a.jwt", a.jwk)).toBe(false);
    expect(await verify("x", a.jwk)).toBe(false);
  });
});

describe("createGoogleKeySource", () => {
  test("caches Google's keys for an hour and refreshes once for an unknown kid", async () => {
    let clock = NOW;
    let loads = 0;
    let keys = [{ kid: "a", kty: "RSA" }];
    const source = createGoogleKeySource(
      (async () => {
        loads++;
        return Response.json({ keys });
      }) as unknown as typeof fetch,
      () => clock,
    );
    expect((await source("a"))?.kid).toBe("a");
    expect((await source("a"))?.kid).toBe("a");
    expect(loads).toBe(1);
    keys = [
      { kid: "a", kty: "RSA" },
      { kid: "b", kty: "RSA" },
    ];
    expect((await source("b"))?.kid).toBe("b");
    expect(loads).toBe(2);
    expect(await source("missing")).toBeNull();
    expect(loads).toBe(3);
    clock += 61 * 60 * 1000;
    await source("a");
    expect(loads).toBe(4);
  });
});
