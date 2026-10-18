import { describe, expect, test } from "bun:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { verifyJwsAccessToken } from "better-auth/oauth2";

import { mcpPlugins, mcpResourceUrl, parseReviewLoginEmails, reviewLoginOptions } from "./index";
import { MCP_DATA_SCOPES } from "./mcp-scopes";

const BASE = "http://localhost:3000";
const AUTH = `${BASE}/api/auth`;
const APP = "http://localhost:3001";
const RESOURCE = mcpResourceUrl(BASE);
const EMAIL = "qa@joyorogo.com";
const PASSWORD = "correct-horse-battery-staple-91";
const REDIRECT = "http://127.0.0.1:33418/callback";

const b64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

interface Harness {
  jwks: () => Promise<{ keys: Record<string, unknown>[] }>;
  user: { id: string };
  cookie: string;
  call: (path: string, init?: RequestInit) => Promise<Response>;
}

async function setup(): Promise<Harness> {
  const db: Record<string, unknown[]> = {};
  for (const model of [
    "user",
    "session",
    "account",
    "verification",
    "jwks",
    "oauthClient",
    "oauthResource",
    "oauthClientResource",
    "oauthRefreshToken",
    "oauthAccessToken",
    "oauthConsent",
    "oauthClientAssertion",
  ]) {
    db[model] = [];
  }
  const auth = betterAuth({
    database: memoryAdapter(db),
    secret: "test-secret-test-secret-test-secret-1234",
    baseURL: BASE,
    trustedOrigins: [APP],
    disabledPaths: ["/token"],
    ...reviewLoginOptions(parseReviewLoginEmails(EMAIL)),
    plugins: mcpPlugins({ BETTER_AUTH_URL: BASE, APP_URL: APP }),
  });
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser({ email: EMAIL, name: "QA", emailVerified: true }, { method: "test" });
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    accountId: user.id,
    providerId: "credential",
    password: await ctx.password.hash(PASSWORD),
  });
  const signIn = await auth.handler(
    new Request(`${AUTH}/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    }),
  );
  expect(signIn.status).toBe(200);
  const cookie = signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const call = (path: string, init: RequestInit = {}) => auth.handler(new Request(`${BASE}${path}`, init));
  return { jwks: () => (auth.api as unknown as { getJwks: () => Promise<{ keys: Record<string, unknown>[] }> }).getJwks(), user, cookie, call };
}

async function register(call: Harness["call"]) {
  const res = await call("/api/auth/oauth2/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Claude",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as { client_id: string; client_secret?: string; scope?: string };
}

async function authorize(
  t: Harness,
  clientId: string,
  challenge: string,
  extra: Record<string, string> = {},
  withCookie = true,
) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
    ...extra,
  });
  return t.call(`/api/auth/oauth2/authorize?${params}`, {
    headers: withCookie ? { cookie: t.cookie } : {},
    redirect: "manual",
  });
}

async function consent(t: Harness, location: string, accept = true) {
  const url = new URL(location);
  expect(`${url.origin}${url.pathname}`).toBe(`${APP}/koneksi/izin`);
  const res = await t.call("/api/auth/oauth2/consent", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: t.cookie, origin: APP },
    body: JSON.stringify({ accept, oauth_query: url.search.slice(1) }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { redirect: boolean; url: string };
}

async function token(t: Harness, body: Record<string, string>) {
  return t.call("/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
}

describe("MCP OAuth server", () => {
  test("discovery documents name the endpoints, the resource and the scopes", async () => {
    const t = await setup();
    const prm = await t.call("/.well-known/oauth-protected-resource/mcp");
    expect(prm.status).toBe(200);
    const prmBody = (await prm.json()) as { resource: string; authorization_servers: string[]; scopes_supported?: string[] };
    expect(prmBody.resource).toBe(RESOURCE);
    expect(prmBody.authorization_servers).toEqual([AUTH]);
    expect(prmBody.scopes_supported).toEqual([...MCP_DATA_SCOPES]);

    const as = await t.call("/.well-known/oauth-authorization-server/api/auth");
    expect(as.status).toBe(200);
    const asBody = (await as.json()) as Record<string, unknown>;
    expect(asBody.issuer).toBe(AUTH);
    expect(asBody.registration_endpoint).toBe(`${AUTH}/oauth2/register`);
    expect(asBody.code_challenge_methods_supported).toEqual(["S256"]);
  });

  test("register, consent, token, refresh: the whole authorization code flow with PKCE", async () => {
    const t = await setup();
    const client = await register(t.call);
    const { verifier, challenge } = await pkce();

    const first = await authorize(t, client.client_id, challenge, { resource: RESOURCE, scope: MCP_DATA_SCOPES.join(" ") });
    expect(first.status).toBe(302);
    const done = await consent(t, first.headers.get("location") ?? "");
    const callback = new URL(done.url);
    expect(`${callback.origin}${callback.pathname}`).toBe(REDIRECT.replace("/callback", "") + "/callback");
    expect(callback.searchParams.get("state")).toBe("xyz");
    const code = callback.searchParams.get("code") ?? "";
    expect(code).not.toBe("");

    const res = await token(t, {
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      resource: RESOURCE,
    });
    expect(res.status).toBe(200);
    const tokens = (await res.json()) as { access_token: string; refresh_token?: string; scope: string; expires_in: number };
    // No offline_access was asked for, a refresh token comes anyway.
    expect(tokens.refresh_token).toBeTruthy();
    expect(tokens.scope.split(" ")).toContain("offline_access");
    expect(tokens.expires_in).toBe(3600);

    const claims = await verifyJwsAccessToken(tokens.access_token, {
      jwksFetch: () => t.jwks(),
      jwksCacheKey: {},
      verifyOptions: { issuer: AUTH, audience: RESOURCE },
    });
    expect(claims.sub).toBe(t.user.id);
    expect(claims.azp).toBe(client.client_id);
    expect(String(claims.scope).split(" ")).toEqual(expect.arrayContaining([...MCP_DATA_SCOPES]));

    const refreshed = await token(t, {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token ?? "",
      client_id: client.client_id,
      resource: RESOURCE,
    });
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as { access_token: string; refresh_token: string };
    expect(next.refresh_token).not.toBe(tokens.refresh_token);

    // A second authorization for the same scopes needs no consent screen.
    const { challenge: second } = await pkce();
    const again = await authorize(t, client.client_id, second, { resource: RESOURCE, scope: MCP_DATA_SCOPES.join(" ") });
    expect(again.status).toBe(302);
    expect(again.headers.get("location")).toStartWith(REDIRECT);
  });

  test("without a session the authorize endpoint sends the user to the web login page", async () => {
    const t = await setup();
    const client = await register(t.call);
    const { challenge } = await pkce();
    const res = await authorize(t, client.client_id, challenge, { resource: RESOURCE }, false);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toStartWith(`${APP}/koneksi/izin?`);
  });

  test("a request without PKCE is refused", async () => {
    const t = await setup();
    const client = await register(t.call);
    const res = await t.call(
      `/api/auth/oauth2/authorize?${new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: REDIRECT, state: "s" })}`,
      { headers: { cookie: t.cookie }, redirect: "manual" },
    );
    expect(res.headers.get("location") ?? "").toContain("error=invalid_request");
  });

  test("an omitted scope means every connector scope", async () => {
    const t = await setup();
    const client = await register(t.call);
    const { challenge } = await pkce();
    const res = await authorize(t, client.client_id, challenge, { resource: RESOURCE });
    const location = new URL(res.headers.get("location") ?? "");
    const scope = location.searchParams.get("scope")?.split(" ") ?? [];
    expect(scope).toEqual(expect.arrayContaining([...MCP_DATA_SCOPES, "offline_access"]));
  });

  test("a client that leaves the RFC 8707 resource out still gets a JWT for the MCP endpoint", async () => {
    const t = await setup();
    const client = await register(t.call);
    const { verifier, challenge } = await pkce();
    const first = await authorize(t, client.client_id, challenge, { scope: MCP_DATA_SCOPES.join(" ") });
    const done = await consent(t, first.headers.get("location") ?? "");
    const code = new URL(done.url).searchParams.get("code") ?? "";
    const res = await token(t, {
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: client.client_id,
      redirect_uri: REDIRECT,
    });
    const body = (await res.json()) as { access_token: string };
    const claims = await verifyJwsAccessToken(body.access_token, {
      jwksFetch: () => t.jwks(),
      jwksCacheKey: {},
      verifyOptions: { issuer: AUTH, audience: RESOURCE },
    });
    expect(claims.aud).toEqual(RESOURCE);
  });
});
