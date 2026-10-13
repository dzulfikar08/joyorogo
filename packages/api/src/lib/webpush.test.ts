import { describe, expect, test } from "bun:test";

import { encryptPayload, vapidAuthorization, vapidConfigured, vapidToken } from "./webpush";

// RFC 8291 Appendix A test vector (aes128gcm).
const VECTOR = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPublic:
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  // Full expected record: 86-byte header + ciphertext, RFC 8291 §5.
  expectedHex:
    "0c6bfaadad67958803092d454676f397000010004104fe33f4ab0dea71914db55823f73b54948f41306d92" +
    "0732dbb9a59a53286482200e597a7b7bc260ba1c227998580992e93973002f3012a28ae8f06bbb78e5ec0f" +
    "f297de5b429bba7153d3a4ae0caa091fd425f3b4b5414add8ab37a19c1bbb05cf5cb5b2a2e0562d5586356" +
    "41ec52812c6c8ff42e95ccb86be7cd",
};

describe("RFC 8291 aes128gcm encryption", () => {
  test("reproduces the Appendix A byte-for-byte vector", async () => {
    const record = await encryptPayload(
      VECTOR.plaintext,
      {
        p256dh: VECTOR.uaPublic,
        auth: VECTOR.authSecret,
      },
      {
        privateB64u: VECTOR.asPrivate,
        publicB64u: VECTOR.asPublic,
        saltB64u: VECTOR.salt,
      },
    );
    expect([...record].map((b) => b.toString(16).padStart(2, "0")).join("")).toBe(
      VECTOR.expectedHex,
    );
    // Header layout: salt(16) ‖ record size 4096 ‖ 65-byte key.
    expect(record.length).toBe(144);
    expect(record[19]).toBe(0x00); // record size high byte
    expect(record[20]).toBe(0x41); // key length 65
  });

  test("random salt/ephemeral key produce fresh but same-shaped records", async () => {
    const keys = { p256dh: VECTOR.uaPublic, auth: VECTOR.authSecret };
    const a = await encryptPayload("halo", keys);
    const b = await encryptPayload("halo", keys);
    expect(a.length).toBe(16 + 4 + 1 + 65 + "halo".length + 1 + 16);
    expect(b.length).toBe(a.length);
    expect(a.slice(0, 16)).not.toEqual(b.slice(0, 16));
  });
});

describe("VAPID ES256 JWT", () => {
  const env = {
    VAPID_PUBLIC_KEY: VECTOR.asPublic,
    VAPID_PRIVATE_KEY: VECTOR.asPrivate,
    VAPID_SUBJECT: "mailto:dzulfikar@joyorogo.com",
  };
  const now = Date.parse("2026-10-13T03:00:00Z");
  const endpoint = "https://fcm.googleapis.com/fcm/send/abc123";

  test("shape: vapid scheme, three base64url segments, decodable claims", async () => {
    expect(vapidConfigured(env)).toBe(true);
    expect(vapidConfigured({ ...env, VAPID_SUBJECT: undefined })).toBe(false);

    const header = await vapidAuthorization(endpoint, env, now);
    expect(header.startsWith("vapid t=")).toBe(true);
    expect(header).toContain(`k=${VECTOR.asPublic}`);
    const token = header.slice("vapid t=".length, header.indexOf(","));
    const [h, p, s] = token.split(".");
    expect(s).toBeDefined();
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({
      typ: "JWT",
      alg: "ES256",
    });
    const claims = JSON.parse(Buffer.from(p!, "base64url").toString());
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    expect(claims.sub).toBe("mailto:dzulfikar@joyorogo.com");
    expect(claims.exp).toBe(Math.floor(now / 1000) + 12 * 3600);
  });

  test("signature is a valid raw ES256 signature over header.payload", async () => {
    const { token } = await vapidToken(endpoint, env, now);
    const [h, p, s] = token.split(".");
    const rawSig = Buffer.from(s!, "base64url");
    expect(rawSig.length).toBe(64);
    // Bun's WebCrypto round-trips raw signatures, DER per spec elsewhere;
    // accept whichever encoding this engine verifies.
    const der = derFromRaw(new Uint8Array(rawSig));
    const point = Buffer.from(VECTOR.asPublic, "base64url");
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      {
        kty: "EC",
        crv: "P-256",
        x: Buffer.from(point.subarray(1, 33)).toString("base64url"),
        y: Buffer.from(point.subarray(33)).toString("base64url"),
      },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const message = new TextEncoder().encode(`${h}.${p}`);
    const valid =
      (await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, der, message)) ||
      (await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        publicKey,
        new Uint8Array(rawSig),
        message,
      ));
    expect(valid).toBe(true);
  });
});

function derFromRaw(raw: Uint8Array): Uint8Array {
  const r = raw.subarray(0, 32);
  const s = raw.subarray(32);
  const strip = (part: Uint8Array) => {
    let i = 0;
    while (i < part.length - 1 && part[i] === 0) i++;
    return part.subarray(i);
  };
  const rBody = strip(r);
  const sBody = strip(s);
  return new Uint8Array([
    0x30,
    2 + rBody.length + 2 + sBody.length,
    0x02,
    rBody.length,
    ...rBody,
    0x02,
    sBody.length,
    ...sBody,
  ]);
}
