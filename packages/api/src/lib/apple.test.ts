import { beforeAll, describe, expect, test } from "bun:test";

import type { AppleVerifyOptions } from "./apple";
import {
  APPLE_ROOT_CA_G3_SHA256,
  DEFAULT_APPLE_BUNDLE_ID,
  DEFAULT_APPLE_FOUNDER_PRODUCT_ID,
  DEFAULT_APPLE_FOUNDER_YEARLY_PRODUCT_ID,
  verifyAppleTransactionJws,
} from "./apple";

// Apple's real intermediates and root (public certs, downloaded from
// apple.com/certificateauthority). The leaf key is Apple's secret, so the
// real chain is exercised pairwise: WWDR G6 verified under the pinned G3.
const APPLE_ROOT_G3_B64 =
  "MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySrMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM6BgD56KyKA==";
const APPLE_WWDR_G6_B64 =
  "MIIDFjCCApygAwIBAgIUIsGhRwp0c2nvU4YSycafPTjzbNcwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMjEwMzE3MjAzNzEwWhcNMzYwMzE5MDAwMDAwWjB1MUQwQgYDVQQDDDtBcHBsZSBXb3JsZHdpZGUgRGV2ZWxvcGVyIFJlbGF0aW9ucyBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTELMAkGA1UECwwCRzYxEzARBgNVBAoMCkFwcGxlIEluYy4xCzAJBgNVBAYTAlVTMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAEbsQKC94PrlWmZXnXgtxzdVJL8T0SGYngDRGpngn3N6PT8JMEb7FDi4bBmPhCnZ3/sq6PF/cGcKXWsL5vOteRhyJ45x3ASP7cOB+aao90fcpxSv/EZFbniAbNgZGhIhpIo4H6MIH3MBIGA1UdEwEB/wQIMAYBAf8CAQAwHwYDVR0jBBgwFoAUu7DeoVgziJqkipnevr3rr9rLJKswRgYIKwYBBQUHAQEEOjA4MDYGCCsGAQUFBzABhipodHRwOi8vb2NzcC5hcHBsZS5jb20vb2NzcDAzLWFwcGxlcm9vdGNhZzMwNwYDVR0fBDAwLjAsoCqgKIYmaHR0cDovL2NybC5hcHBsZS5jb20vYXBwbGVyb290Y2FnMy5jcmwwHQYDVR0OBBYEFD8vlCNR01DJmig97bB85c+lkGKZMA4GA1UdDwEB/wQEAwIBBjAQBgoqhkiG92NkBgIBBAIFADAKBggqhkjOPQQDAwNoADBlAjBAXhSq5IyKogMCPtw490BaB677CaEGJXufQB/EqZGd6CSjiCtOnuMTbXVXmxxcxfkCMQDTSPxarZXvNrkxU3TkUMI33yzvFVVRT4wxWJC994OsdcZ4+RGNsYDyR5gmdr0nDGg=";

// Every fixture is generated in-process (WebCrypto ECDSA P-256): root CA ->
// WWDR-style intermediate -> App Store-style leaf, built with a tiny DER
// writer. No Apple material is committed; the pinned root is injectable, so
// the tests pin the generated root exactly like the server pins Apple Root
// CA - G3.

const BUNDLE = DEFAULT_APPLE_BUNDLE_ID;
const PRODUCT = DEFAULT_APPLE_FOUNDER_PRODUCT_ID;
const YEARLY = DEFAULT_APPLE_FOUNDER_YEARLY_PRODUCT_ID;
const SIGNED_DATE = Date.parse("2026-10-13T00:00:00Z");
const NOT_BEFORE = Date.parse("2026-01-01T00:00:00Z");
const NOT_AFTER = Date.parse("2027-01-01T00:00:00Z");
const EXPIRED_NOT_AFTER = Date.parse("2021-01-01T00:00:00Z");

const APPLE_WWDR_OID = "1.2.840.113635.100.6.2.1";
const APPLE_LEAF_OID = "1.2.840.113635.100.6.11.1";
const BASIC_CONSTRAINTS_OID = "2.5.29.19";

type HashName = "SHA-256" | "SHA-384";
type CurveName = "P-256" | "P-384";
const ECDSA_OID_BY_HASH = {
  "SHA-256": "1.2.840.10045.4.3.2",
  "SHA-384": "1.2.840.10045.4.3.3",
} as const;

const utf8 = new TextEncoder();

// --- DER writer ------------------------------------------------------------

function der(tag: number, content: Uint8Array): Uint8Array {
  let lengthBytes: number[];
  if (content.length < 0x80) {
    lengthBytes = [content.length];
  } else {
    lengthBytes = [];
    for (let n = content.length; n > 0; n >>= 8) lengthBytes.unshift(n & 0xff);
    lengthBytes.unshift(0x80 | lengthBytes.length);
  }
  return new Uint8Array([tag, ...lengthBytes, ...content]);
}

function derSeq(...items: Uint8Array[]): Uint8Array {
  const content = new Uint8Array(items.reduce((n, item) => n + item.length, 0));
  let offset = 0;
  for (const item of items) {
    content.set(item, offset);
    offset += item.length;
  }
  return der(0x30, content);
}

function derInt(value: number): Uint8Array {
  return der(0x02, new Uint8Array([value]));
}

function derOid(dotted: string): Uint8Array {
  const parts = dotted.split(".").map(Number);
  const bytes = [(parts[0] ?? 0) * 40 + (parts[1] ?? 0)];
  for (const part of parts.slice(2)) {
    const stack = [part & 0x7f];
    for (let value = part >> 7; value > 0; value >>= 7) stack.unshift(0x80 | (value & 0x7f));
    bytes.push(...stack);
  }
  return der(0x06, new Uint8Array(bytes));
}

/** UTCTime, second precision, always Z. */
function derTime(ms: number): Uint8Array {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = String(d.getUTCFullYear()).slice(2);
  const text = `${year}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  return der(0x17, utf8.encode(text));
}

const derName = (cn: string) =>
  derSeq(derSeq(derSeq(derOid("2.5.4.3"), der(0x0c, utf8.encode(cn)))));

/** Extension ::= SEQUENCE { extnID OID, extnValue OCTET STRING }. */
const derExt = (oid: string, value: Uint8Array) => derSeq(derOid(oid), der(0x04, value));
const caTrueExt = derExt(BASIC_CONSTRAINTS_OID, derSeq(der(0x01, new Uint8Array([0xff]))));
const markerExt = (oid: string) => derExt(oid, der(0x05, new Uint8Array([0x05, 0x00])));

/** DER INTEGER from big-endian bytes, minimal with positive sign pad. */
function derIntBytes(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  const content = bytes.subarray(start);
  return der(0x02, content[0]! & 0x80 ? new Uint8Array([0, ...content]) : new Uint8Array(content));
}

/** Raw 64/96-byte r||s -> DER ECDSA-Sig-Value. */
const derSig = (raw: Uint8Array) => {
  const half = raw.length / 2;
  return derSeq(derIntBytes(raw.subarray(0, half)), derIntBytes(raw.subarray(half)));
};

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const base64Bytes = (value: string) => new Uint8Array([...atob(value)].map((c) => c.charCodeAt(0)));

// --- Certificate chain fixtures --------------------------------------------

type KeyPair = CryptoKeyPair;
type Entity = { nameDer: Uint8Array; keyPair: KeyPair };
type IssuedCert = Entity & { der: Uint8Array };

function generateKeyPair(curve: CurveName): Promise<KeyPair> {
  return crypto.subtle.generateKey({ name: "ECDSA", namedCurve: curve }, true, [
    "sign",
    "verify",
  ]) as Promise<KeyPair>;
}

async function entity(cn: string, curve: CurveName = "P-256"): Promise<Entity> {
  return { nameDer: derName(cn), keyPair: await generateKeyPair(curve) };
}

async function issue(
  subject: { name: string; keyPair: KeyPair },
  issuer: Entity,
  notBefore: number,
  notAfter: number,
  serial: number,
  extensions: Uint8Array[],
  sigHash: HashName = "SHA-256",
): Promise<IssuedCert> {
  const spki = new Uint8Array(
    (await crypto.subtle.exportKey("spki", subject.keyPair.publicKey)) as ArrayBuffer,
  );
  const tbs = derSeq(
    der(0xa0, derInt(2)),
    derInt(serial),
    derSeq(derOid(ECDSA_OID_BY_HASH[sigHash])),
    issuer.nameDer,
    derSeq(derTime(notBefore), derTime(notAfter)),
    derName(subject.name),
    spki,
    ...(extensions.length ? [der(0xa3, derSeq(...extensions))] : []),
  );
  const raw = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: sigHash }, issuer.keyPair.privateKey, tbs),
  );
  const signature = der(0x03, new Uint8Array([0, ...derSig(raw)]));
  return {
    der: derSeq(tbs, derSeq(derOid(ECDSA_OID_BY_HASH[sigHash])), signature),
    nameDer: derName(subject.name),
    keyPair: subject.keyPair,
  };
}

// --- JWS builder -----------------------------------------------------------

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const base64url = (bytes: Uint8Array) =>
  base64(bytes).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

async function makeJws(
  chain: Uint8Array[],
  signingKey: CryptoKey,
  payload: Record<string, unknown>,
): Promise<string> {
  const head = base64url(utf8.encode(JSON.stringify({ alg: "ES256", x5c: chain.map(base64) })));
  const body = base64url(utf8.encode(JSON.stringify(payload)));
  const raw = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      signingKey,
      utf8.encode(`${head}.${body}`),
    ),
  );
  return `${head}.${body}.${base64url(raw)}`;
}

const validPayload = (overrides: Record<string, unknown> = {}) => ({
  transactionId: "2000000123456789",
  bundleId: BUNDLE,
  productId: PRODUCT,
  environment: "Sandbox",
  signedDate: SIGNED_DATE,
  price: 15_000_000,
  currency: "IDR",
  ...overrides,
});

// --- Fixtures --------------------------------------------------------------

async function issueIntermediate(
  root: Entity,
  extensions: Uint8Array[],
  sigHash: HashName = "SHA-256",
): Promise<IssuedCert> {
  const intermediateEntity = await entity("Test WWDR", sigHash === "SHA-384" ? "P-384" : "P-256");
  return issue(
    { name: "Test WWDR", keyPair: intermediateEntity.keyPair },
    root,
    NOT_BEFORE,
    NOT_AFTER,
    2,
    extensions,
    sigHash,
  );
}

async function issueLeaf(
  issuer: IssuedCert,
  notAfter: number,
  extensions: Uint8Array[],
  sigHash: HashName = "SHA-256",
): Promise<IssuedCert> {
  const leafEntity = await entity("JoyoRogo App");
  return issue(
    { name: "JoyoRogo App", keyPair: leafEntity.keyPair },
    issuer,
    NOT_BEFORE,
    notAfter,
    3,
    extensions,
    sigHash,
  );
}

let root: IssuedCert;
let altRoot: IssuedCert;
let intermediate: IssuedCert;
let leaf: IssuedCert;
let leafNoOid: IssuedCert;
let intermediateNoOid: IssuedCert;
let intermediateNotCa: IssuedCert;
let expiredLeaf: IssuedCert;
/** Issuer name matches the real intermediate but the key does not. */
let rogueIntermediate: IssuedCert;
let strangerLeaf: IssuedCert;
/** Apple-shaped topology: P-384 root and intermediate, P-256 leaf, SHA-384 sigs. */
let leaf384: IssuedCert;
let intermediate384: IssuedCert;
let root384: IssuedCert;
let pinned: AppleVerifyOptions;

beforeAll(async () => {
  const rootEntity = await entity("Test Root CA");
  root = await issue(
    { name: "Test Root CA", keyPair: rootEntity.keyPair },
    rootEntity,
    NOT_BEFORE,
    NOT_AFTER,
    1,
    [caTrueExt],
  );
  const altRootEntity = await entity("Other Root CA");
  altRoot = await issue(
    { name: "Other Root CA", keyPair: altRootEntity.keyPair },
    altRootEntity,
    NOT_BEFORE,
    NOT_AFTER,
    1,
    [caTrueExt],
  );

  intermediate = await issueIntermediate(rootEntity, [caTrueExt, markerExt(APPLE_WWDR_OID)]);
  intermediateNoOid = await issueIntermediate(rootEntity, [caTrueExt]);
  intermediateNotCa = await issueIntermediate(rootEntity, [markerExt(APPLE_WWDR_OID)]);
  rogueIntermediate = await issueIntermediate(rootEntity, [caTrueExt, markerExt(APPLE_WWDR_OID)]);

  leaf = await issueLeaf(intermediate, NOT_AFTER, [markerExt(APPLE_LEAF_OID)]);
  leafNoOid = await issueLeaf(intermediate, NOT_AFTER, []);
  expiredLeaf = await issueLeaf(intermediate, EXPIRED_NOT_AFTER, [markerExt(APPLE_LEAF_OID)]);

  const strangerCa = await entity("Stranger CA");
  const strangerLeafEntity = await entity("Stranger Leaf");
  strangerLeaf = await issue(
    { name: "Stranger Leaf", keyPair: strangerLeafEntity.keyPair },
    strangerCa,
    NOT_BEFORE,
    NOT_AFTER,
    4,
    [markerExt(APPLE_LEAF_OID)],
  );

  const root384Entity = await entity("Test Root 384", "P-384");
  root384 = await issue(
    { name: "Test Root 384", keyPair: root384Entity.keyPair },
    root384Entity,
    NOT_BEFORE,
    NOT_AFTER,
    1,
    [caTrueExt],
    "SHA-384",
  );
  intermediate384 = await issueIntermediate(
    root384Entity,
    [caTrueExt, markerExt(APPLE_WWDR_OID)],
    "SHA-384",
  );
  leaf384 = await issueLeaf(intermediate384, NOT_AFTER, [markerExt(APPLE_LEAF_OID)], "SHA-384");

  pinned = { rootSha256: await sha256Hex(root.der), bundleId: BUNDLE, productIds: [PRODUCT, YEARLY] };
});

const validJws = (payload = validPayload()) =>
  makeJws([leaf.der, intermediate.der, root.der], leaf.keyPair.privateKey, payload);

/** Asserts rejection and returns the reason for a precise expect. */
async function rejectReason(jws: string, opts: AppleVerifyOptions = pinned): Promise<string> {
  const result = await verifyAppleTransactionJws(jws, opts);
  expect(result.ok).toBe(false);
  return result.ok ? "unexpectedly ok" : result.reason;
}

describe("verifyAppleTransactionJws", () => {
  test("accepts a valid Sandbox transaction", async () => {
    const result = await verifyAppleTransactionJws(await validJws(), pinned);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transaction.transactionId).toBe("2000000123456789");
      expect(result.transaction.environment).toBe("Sandbox");
      expect(result.transaction.priceIdr).toBe(15_000);
      expect(result.transaction.signedDate.getTime()).toBe(SIGNED_DATE);
    }
  });

  test("accepts the yearly product and reports the product id", async () => {
    const jws = await validJws(validPayload({ productId: YEARLY }));
    const result = await verifyAppleTransactionJws(jws, pinned);
    expect(result.ok && result.transaction.productId).toBe(YEARLY);
  });

  test("verifies Apple's real WWDR G6 under the pinned G3 root (P-384, SHA-384)", async () => {
    const g3 = base64Bytes(APPLE_ROOT_G3_B64);
    const g6 = base64Bytes(APPLE_WWDR_G6_B64);
    expect(await sha256Hex(g3)).toBe(APPLE_ROOT_CA_G3_SHA256);
    // x5c [G6, G3, G3]: both chain signatures are the REAL P-384/SHA-384
    // verifications (G6 <- G3 and G3 self-signed); the run then stops on the
    // missing App Store leaf OID, which is the expected rejection point.
    const keyPair = await generateKeyPair("P-256");
    const jws = await makeJws([g6, g3, g3], keyPair.privateKey, validPayload());
    expect(await rejectReason(jws, { ...pinned, rootSha256: APPLE_ROOT_CA_G3_SHA256 })).toBe("oid");
  });

  test("accepts a P-384 chain with SHA-384 signatures and a P-256 leaf", async () => {
    const jws = await makeJws(
      [leaf384.der, intermediate384.der, root384.der],
      leaf384.keyPair.privateKey,
      validPayload(),
    );
    const result = await verifyAppleTransactionJws(jws, {
      ...pinned,
      rootSha256: await sha256Hex(root384.der),
    });
    expect(result.ok).toBe(true);
  });

  test("accepts Production and colon-separated fingerprints", async () => {
    const jws = await validJws(validPayload({ environment: "Production" }));
    const fingerprint = (await sha256Hex(root.der)).toUpperCase().match(/.{2}/g)!.join(":");
    const result = await verifyAppleTransactionJws(jws, { ...pinned, rootSha256: fingerprint });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.transaction.environment).toBe("Production");
  });

  test("verifies the same JWS repeatedly (replay-safe lib)", async () => {
    const jws = await validJws();
    const first = await verifyAppleTransactionJws(jws, pinned);
    const second = await verifyAppleTransactionJws(jws, pinned);
    expect(second).toEqual(first);
  });

  test("maps a non-IDR price to null", async () => {
    const jws = await validJws(validPayload({ currency: "USD", price: 990 }));
    const result = await verifyAppleTransactionJws(jws, pinned);
    expect(result.ok && result.transaction.priceIdr).toBe(null);
  });

  test("rejects a foreign pinned root", async () => {
    const jws = await validJws();
    expect(await rejectReason(jws, { ...pinned, rootSha256: await sha256Hex(altRoot.der) })).toBe(
      "root",
    );
  });

  test("rejects wrong payload fields", async () => {
    const cases = [
      [{ bundleId: "com.other.app" }, "bundle"],
      [{ productId: "com.other.product" }, "product"],
      [{ revocationDate: Date.parse("2026-10-14T00:00:00Z") }, "revoked"],
      [{ environment: "Xcode" }, "environment"],
    ] as const;
    for (const [overrides, reason] of cases) {
      const jws = await validJws(validPayload(overrides));
      expect(await rejectReason(jws), JSON.stringify(overrides)).toBe(reason);
    }
  });

  test("rejects a tampered payload", async () => {
    const [head, , sig] = (await validJws()).split(".") as [string, string, string];
    const tampered = base64url(
      utf8.encode(JSON.stringify(validPayload({ transactionId: "2000000999999999" }))),
    );
    expect(await rejectReason(`${head}.${tampered}.${sig}`)).toBe("signature");
  });

  test("rejects a tampered certificate", async () => {
    const tamperedLeaf = new Uint8Array(leaf.der);
    tamperedLeaf[tamperedLeaf.length - 1]! ^= 0xff;
    const jws = await makeJws(
      [tamperedLeaf, intermediate.der, root.der],
      leaf.keyPair.privateKey,
      validPayload(),
    );
    expect(await rejectReason(jws)).toBe("signature");
  });

  test("rejects a leaf signed by a key outside the chain", async () => {
    // rogueIntermediate has the same subject name as the real one, so the
    // issuer/subject byte checks pass and the signature check must catch it.
    const jws = await makeJws(
      [leaf.der, rogueIntermediate.der, root.der],
      leaf.keyPair.privateKey,
      validPayload(),
    );
    expect(await rejectReason(jws)).toBe("signature");
  });

  test("rejects a leaf whose issuer is not in the chain", async () => {
    const jws = await makeJws(
      [strangerLeaf.der, intermediate.der, root.der],
      strangerLeaf.keyPair.privateKey,
      validPayload(),
    );
    expect(await rejectReason(jws)).toBe("chain");
  });

  test("rejects a chain that expired before signedDate", async () => {
    const jws = await makeJws(
      [expiredLeaf.der, intermediate.der, root.der],
      expiredLeaf.keyPair.privateKey,
      validPayload(),
    );
    expect(await rejectReason(jws)).toBe("validity");
  });

  test("rejects missing Apple marker OIDs", async () => {
    const noLeafOid = await makeJws(
      [leafNoOid.der, intermediate.der, root.der],
      leafNoOid.keyPair.privateKey,
      validPayload(),
    );
    const leafOfNoOid = await issueLeaf(intermediateNoOid, NOT_AFTER, [markerExt(APPLE_LEAF_OID)]);
    const noIntermediateOid = await makeJws(
      [leafOfNoOid.der, intermediateNoOid.der, root.der],
      leafOfNoOid.keyPair.privateKey,
      validPayload(),
    );
    expect(await rejectReason(noLeafOid)).toBe("oid");
    expect(await rejectReason(noIntermediateOid)).toBe("oid");
  });

  test("rejects a non-CA intermediate", async () => {
    const jws = await makeJws(
      [leaf.der, intermediateNotCa.der, root.der],
      leaf.keyPair.privateKey,
      validPayload(),
    );
    expect(await rejectReason(jws)).toBe("chain");
  });

  test("rejects a short chain or a non-ES256 header", async () => {
    const body = base64url(utf8.encode(JSON.stringify(validPayload())));
    const signWithLeaf = async (head: string) =>
      base64url(
        new Uint8Array(
          await crypto.subtle.sign(
            { name: "ECDSA", hash: "SHA-256" },
            leaf.keyPair.privateKey,
            utf8.encode(`${head}.${body}`),
          ),
        ),
      );
    const shortChain = base64url(
      utf8.encode(
        JSON.stringify({ alg: "ES256", x5c: [base64(leaf.der), base64(intermediate.der)] }),
      ),
    );
    expect(await rejectReason(`${shortChain}.${body}.${await signWithLeaf(shortChain)}`)).toBe(
      "chain",
    );

    const rs256Head = base64url(
      utf8.encode(
        JSON.stringify({
          alg: "RS256",
          x5c: [base64(leaf.der), base64(intermediate.der), base64(root.der)],
        }),
      ),
    );
    expect(await rejectReason(`${rs256Head}.${body}.${await signWithLeaf(rs256Head)}`)).toBe(
      "algorithm",
    );
  });

  test("rejects malformed input", async () => {
    for (const jws of [
      "",
      "not-a-jws",
      "a.b",
      `${"x".repeat(10)}.${"y".repeat(10)}.${"z".repeat(10)}`,
    ]) {
      const result = await verifyAppleTransactionJws(jws, pinned);
      expect(result.ok).toBe(false);
    }
  });
});
