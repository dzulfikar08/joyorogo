// Test-only: an in-process Apple-shaped chain (root -> WWDR-style intermediate
// -> App Store-style leaf, all ECDSA P-256) plus a JWS signer, so tests can pin
// their own root exactly like the server pins Apple Root CA - G3. No Apple
// material is involved.

const NOT_BEFORE = Date.parse("2026-01-01T00:00:00Z");
const NOT_AFTER = Date.parse("2030-01-01T00:00:00Z");
const APPLE_WWDR_OID = "1.2.840.113635.100.6.2.1";
const APPLE_LEAF_OID = "1.2.840.113635.100.6.11.1";
const BASIC_CONSTRAINTS_OID = "2.5.29.19";
const ECDSA_SHA256_OID = "1.2.840.10045.4.3.2";

const utf8 = new TextEncoder();

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

const derInt = (value: number) => der(0x02, new Uint8Array([value]));

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

function derTime(ms: number): Uint8Array {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const text = `${String(d.getUTCFullYear()).slice(2)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  return der(0x17, utf8.encode(text));
}

const derName = (cn: string) =>
  derSeq(derSeq(derSeq(derOid("2.5.4.3"), der(0x0c, utf8.encode(cn)))));
const derExt = (oid: string, value: Uint8Array) => derSeq(derOid(oid), der(0x04, value));
const caTrueExt = derExt(BASIC_CONSTRAINTS_OID, derSeq(der(0x01, new Uint8Array([0xff]))));
const markerExt = (oid: string) => derExt(oid, der(0x05, new Uint8Array([0x05, 0x00])));

function derIntBytes(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  const content = bytes.subarray(start);
  return der(0x02, content[0]! & 0x80 ? new Uint8Array([0, ...content]) : new Uint8Array(content));
}

const derSig = (raw: Uint8Array) => {
  const half = raw.length / 2;
  return derSeq(derIntBytes(raw.subarray(0, half)), derIntBytes(raw.subarray(half)));
};

type Entity = { nameDer: Uint8Array; keyPair: CryptoKeyPair };
type IssuedCert = Entity & { der: Uint8Array };

async function newEntity(cn: string): Promise<Entity> {
  const keyPair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  return { nameDer: derName(cn), keyPair };
}

async function issue(
  name: string,
  subject: Entity,
  issuer: Entity,
  serial: number,
  extensions: Uint8Array[],
): Promise<IssuedCert> {
  const spki = new Uint8Array(
    (await crypto.subtle.exportKey("spki", subject.keyPair.publicKey)) as ArrayBuffer,
  );
  const tbs = derSeq(
    der(0xa0, derInt(2)),
    derInt(serial),
    derSeq(derOid(ECDSA_SHA256_OID)),
    issuer.nameDer,
    derSeq(derTime(NOT_BEFORE), derTime(NOT_AFTER)),
    derName(name),
    spki,
    der(0xa3, derSeq(...extensions)),
  );
  const raw = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, issuer.keyPair.privateKey, tbs),
  );
  return {
    der: derSeq(tbs, derSeq(derOid(ECDSA_SHA256_OID)), der(0x03, new Uint8Array([0, ...derSig(raw)]))),
    nameDer: derName(name),
    keyPair: subject.keyPair,
  };
}

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const base64url = (bytes: Uint8Array) =>
  base64(bytes).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

export type TestAppleChain = {
  /** Hex SHA-256 of the root DER: the value to pin as `rootSha256`. */
  rootSha256: string;
  /** Signs `payload` as an Apple JWS (x5c = leaf, intermediate, root). */
  sign(payload: Record<string, unknown>): Promise<string>;
};

export async function createTestAppleChain(): Promise<TestAppleChain> {
  const rootEntity = await newEntity("Test Root CA");
  const root = await issue("Test Root CA", rootEntity, rootEntity, 1, [caTrueExt]);
  const interEntity = await newEntity("Test WWDR");
  const intermediate = await issue("Test WWDR", interEntity, rootEntity, 2, [
    caTrueExt,
    markerExt(APPLE_WWDR_OID),
  ]);
  const leafEntity = await newEntity("JoyoRogo App");
  const leaf = await issue("JoyoRogo App", leafEntity, interEntity, 3, [markerExt(APPLE_LEAF_OID)]);

  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", root.der));
  const head = base64url(
    utf8.encode(
      JSON.stringify({ alg: "ES256", x5c: [leaf.der, intermediate.der, root.der].map(base64) }),
    ),
  );
  return {
    rootSha256: [...digest].map((b) => b.toString(16).padStart(2, "0")).join(""),
    async sign(payload) {
      const body = base64url(utf8.encode(JSON.stringify(payload)));
      const sig = new Uint8Array(
        await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          leaf.keyPair.privateKey,
          utf8.encode(`${head}.${body}`),
        ),
      );
      return `${head}.${body}.${base64url(sig)}`;
    },
  };
}
