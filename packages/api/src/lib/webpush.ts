// Web Push sender, WebCrypto-only so it runs in Workers: VAPID (RFC 8292,
// ES256 JWT) and RFC 8291 "aes128gcm" payload encryption. No node deps —
// unit-tested against the RFC 8291 Appendix A vector.
//
// Key env format (matches what `npx web-push generate-vapid-keys --json`
// prints and what browsers take as applicationServerKey):
//   VAPID_PUBLIC_KEY  = base64url of the 65-byte uncompressed P-256 point
//   VAPID_PRIVATE_KEY = base64url of the 32-byte private scalar `d`

export type PushKeys = { p256dh: string; auth: string };

export type PushSubscriptionLike = { endpoint: string } & PushKeys;

export type VapidEnv = {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
};

/** Reminders stay off until every VAPID piece is configured. */
export function vapidConfigured(env: VapidEnv): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

// --- base64url -----------------------------------------------------------------

function b64uDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const raw = atob(padded + pad);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function b64uEncode(bytes: Uint8Array): string {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// --- RFC 8291 payload encryption -------------------------------------------------

type Ephemeral = { privateKey: CryptoKey; publicRaw: Uint8Array };

async function ephemeralKey(test?: {
  privateB64u?: string;
  publicB64u?: string;
}): Promise<Ephemeral> {
  if (test?.privateB64u) {
    // Deterministic path for the RFC test vector: x/y come from the matching
    // public point, exactly how VAPID private keys import.
    const pubRaw = b64uDecode(test.publicB64u ?? "");
    const jwk: JsonWebKey = {
      kty: "EC",
      crv: "P-256",
      d: test.privateB64u,
      x: b64uEncode(pubRaw.slice(1, 33)),
      y: b64uEncode(pubRaw.slice(33, 65)),
    };
    const privateKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
    return { privateKey, publicRaw: pubRaw };
  }
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const publicRaw = new Uint8Array(
    (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
  );
  return { privateKey: pair.privateKey, publicRaw };
}

async function hkdfBits(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  bits: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bits),
  );
}

const webPushInfo = (label: string): Uint8Array => utf8(`Content-Encoding: ${label}\u0000`);

/**
 * One aes128gcm record: 86-byte header (salt, record size 4096, ephemeral
 * public key) + AES-128-GCM over plaintext ‖ 0x02. `test` pins the ephemeral
 * key and salt for the RFC 8291 Appendix A vector; production leaves both
 * random, as the spec requires.
 */
export async function encryptPayload(
  plaintext: string,
  keys: PushKeys,
  test?: { privateB64u?: string; publicB64u?: string; saltB64u?: string },
): Promise<Uint8Array> {
  const uaPublic = b64uDecode(keys.p256dh);
  const authSecret = b64uDecode(keys.auth);
  const eph = await ephemeralKey(test);
  const salt = test?.saltB64u
    ? b64uDecode(test.saltB64u)
    : crypto.getRandomValues(new Uint8Array(16));

  // workers-types names the ECDH peer key `$public`, while every runtime
  // (Workers, Bun, browsers) reads `public` — so the object keeps `public`
  // and only the static type is cast.
  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhParams = { name: "ECDH", public: uaKey } as unknown as Parameters<
    typeof crypto.subtle.deriveBits
  >[0];
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(ecdhParams, eph.privateKey, 256),
  );

  // PRK_key = HKDF-Extract(auth_secret, ecdh_secret); the combined call then
  // HKDF-Expands key_info‖0x01 — that expansion IS RFC 8291's IKM.
  const ikm = await hkdfBits(
    ecdhSecret,
    authSecret,
    concat(utf8("WebPush: info"), new Uint8Array(1), uaPublic, eph.publicRaw),
    256,
  );
  // RFC 8188: CEK and nonce from HKDF(IKM, salt=header salt, info‖0x00).
  const cek = await hkdfBits(ikm, salt, webPushInfo("aes128gcm"), 128);
  const nonce = await hkdfBits(ikm, salt, webPushInfo("nonce"), 96);

  // Header: salt(16) ‖ record size 4096 (4) ‖ key id length 65 (1) ‖ key (65).
  const header = concat(salt, new Uint8Array([0, 0, 0x10, 0, 0x41]), eph.publicRaw);
  const padded = concat(utf8(plaintext), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded),
  );
  return concat(header, ciphertext);
}

// --- VAPID (RFC 8292) -------------------------------------------------------------

/** DER ECDSA signature → the raw r‖s (64-byte) form ES256 requires. */
function derSignatureToRaw(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error("bad ECDSA signature");
  let offset = 2;
  if (der[offset] !== 0x02) throw new Error("bad ECDSA signature");
  const rStart = offset + 2;
  const rLen = der[offset + 1]!;
  offset = rStart + rLen;
  if (der[offset] !== 0x02) throw new Error("bad ECDSA signature");
  const sStart = offset + 2;
  const sLen = der[offset + 1]!;
  const raw = new Uint8Array(64);
  raw.set(der.subarray(rStart, rStart + rLen), 32 - rLen);
  raw.set(der.subarray(sStart, sStart + sLen), 64 - sLen);
  return raw;
}

// Workers emit DER signatures; Bun (local dev/tests) already emits raw r‖s.
function normalizeEs256Signature(sig: Uint8Array): Uint8Array {
  return sig.length === 64 ? sig : derSignatureToRaw(sig);
}

async function importVapidPrivateKey(env: VapidEnv): Promise<CryptoKey> {
  const point = b64uDecode(env.VAPID_PUBLIC_KEY!);
  if (point.length !== 65 || point[0] !== 0x04) {
    throw new Error("VAPID_PUBLIC_KEY must be a 65-byte uncompressed P-256 point (base64url)");
  }
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    d: env.VAPID_PRIVATE_KEY,
    x: b64uEncode(point.slice(1, 33)),
    y: b64uEncode(point.slice(33, 65)),
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ]);
}

export type VapidToken = { token: string; publicKey: string };

/** Signed ES256 JWT (aud = endpoint origin, 12 h expiry, sub = mailto). */
export async function vapidToken(
  endpoint: string,
  env: VapidEnv,
  now = Date.now(),
): Promise<VapidToken> {
  const audience = new URL(endpoint).origin;
  const header = b64uEncode(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64uEncode(
    utf8(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(now / 1000) + 12 * 3600,
        sub: env.VAPID_SUBJECT,
      }),
    ),
  );
  const key = await importVapidPrivateKey(env);
  const der = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(`${header}.${claims}`)),
  );
  const token = `${header}.${claims}.${b64uEncode(normalizeEs256Signature(der))}`;
  return { token, publicKey: env.VAPID_PUBLIC_KEY! };
}

/** The Authorization header value push servers expect: `vapid t=…, k=…`. */
export async function vapidAuthorization(
  endpoint: string,
  env: VapidEnv,
  now = Date.now(),
): Promise<string> {
  const { token, publicKey } = await vapidToken(endpoint, env, now);
  return `vapid t=${token}, k=${publicKey}`;
}

// --- Sending ------------------------------------------------------------------------

export type PushResult = { ok: boolean; status: number };

/**
 * Delivers one encrypted notification. `status` 404/410 means the browser
 * threw the subscription away — callers delete the stored row then. Any
 * other failure just counts as skipped; the next cron tick retries.
 */
export async function sendPush(
  env: VapidEnv,
  subscription: PushSubscriptionLike,
  payload: { title: string; body: string },
): Promise<PushResult> {
  if (!vapidConfigured(env)) return { ok: false, status: 0 };
  try {
    const body = await encryptPayload(JSON.stringify(payload), {
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    });
    const authorization = await vapidAuthorization(subscription.endpoint, env);
    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: authorization,
        TTL: "86400",
        Urgency: "normal",
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
      },
      body,
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
