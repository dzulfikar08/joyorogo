import { appleAudiences } from "@joyorogo/auth/apple-audience";

import { DEFAULT_APPLE_BUNDLE_ID } from "./apple";

export const DEFAULT_APPLE_TEAM_ID = "F6Q6UFUK69";
const APPLE_AUDIENCE = "https://appleid.apple.com";
const TOKEN_URL = `${APPLE_AUDIENCE}/auth/token`;
const REVOKE_URL = `${APPLE_AUDIENCE}/auth/revoke`;

export type AppleRevokeEnv = {
  APPLE_TEAM_ID?: string;
  APPLE_SIWA_KEY_ID?: string;
  APPLE_SIWA_PRIVATE_KEY?: string;
  APPLE_BUNDLE_ID?: string;
};

export type AppleRevokeConfig = {
  teamId: string;
  keyId: string;
  privateKeyPem: string;
  clientId: string;
};

/**
 * null when the Sign in with Apple key is not configured. `clientId` is the bundle id of the app that
 * obtained the authorization code (Apple only exchanges a code for the client it was issued to); it
 * must be one of the apps that sign in here, otherwise it falls back to JoyoRogo's.
 */
export function appleRevokeConfig(env: AppleRevokeEnv, clientId?: string): AppleRevokeConfig | null {
  const keyId = env.APPLE_SIWA_KEY_ID?.trim();
  const privateKeyPem = env.APPLE_SIWA_PRIVATE_KEY?.trim();
  if (!keyId || !privateKeyPem) return null;
  return {
    teamId: env.APPLE_TEAM_ID?.trim() || DEFAULT_APPLE_TEAM_ID,
    keyId,
    privateKeyPem,
    clientId: appleRevokeClientId(env, clientId),
  };
}

function appleRevokeClientId(env: AppleRevokeEnv, requested?: string): string {
  const own = env.APPLE_BUNDLE_ID?.trim() || DEFAULT_APPLE_BUNDLE_ID;
  return requested && appleAudiences(own).includes(requested) ? requested : own;
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): Uint8Array {
  // Secrets are sometimes stored with literal "\n" sequences.
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** ES256 client_secret JWT for Apple's token endpoints (WebCrypto only). */
export async function buildAppleClientSecret(
  config: AppleRevokeConfig,
  nowMs: number = Date.now(),
): Promise<string> {
  const enc = new TextEncoder();
  const iat = Math.floor(nowMs / 1000);
  const header = { alg: "ES256", kid: config.keyId, typ: "JWT" };
  const claims = {
    iss: config.teamId,
    iat,
    exp: iat + 300,
    aud: APPLE_AUDIENCE,
    sub: config.clientId,
  };
  const signingInput = `${b64url(enc.encode(JSON.stringify(header)))}.${b64url(
    enc.encode(JSON.stringify(claims)),
  )}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(config.privateKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  // WebCrypto ECDSA emits raw r||s, which is what JWS ES256 expects.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(signingInput)),
  );
  return `${signingInput}.${b64url(signature)}`;
}

async function postForm(url: string, params: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
}

/**
 * Exchanges the fresh authorization code for tokens, then revokes them so the
 * app disappears from the user's Apple ID "Sign in with Apple" list.
 * Throws on any failure; callers must abort account deletion.
 */
export async function revokeAppleAuthorization(
  config: AppleRevokeConfig,
  authorizationCode: string,
  nowMs?: number,
): Promise<void> {
  const clientSecret = await buildAppleClientSecret(config, nowMs);

  const tokenRes = await postForm(TOKEN_URL, {
    grant_type: "authorization_code",
    code: authorizationCode,
    client_id: config.clientId,
    client_secret: clientSecret,
  });
  if (!tokenRes.ok) throw new Error(`apple token exchange failed: ${tokenRes.status}`);
  const tokens = (await tokenRes.json()) as { refresh_token?: string; access_token?: string };

  const [token, hint] = tokens.refresh_token
    ? [tokens.refresh_token, "refresh_token"]
    : tokens.access_token
      ? [tokens.access_token, "access_token"]
      : [null, null];
  if (!token || !hint) throw new Error("apple token exchange returned no token");

  const revokeRes = await postForm(REVOKE_URL, {
    client_id: config.clientId,
    client_secret: clientSecret,
    token,
    token_type_hint: hint,
  });
  if (!revokeRes.ok) throw new Error(`apple revoke failed: ${revokeRes.status}`);
}
