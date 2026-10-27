import { describe, expect, test } from "bun:test";

import { createConnectState, parseSignedRequest, verifyConnectState } from "./connect";
import { parseMentionEvents, signBody, verifyChallenge, verifySignature } from "./webhook";

const SECRET = "app-secret-123";
const BODY = JSON.stringify({
  app_id: "1",
  topic: "interaction",
  target_id: "100",
  values: { field: "mentions", value: { id: "m1" } },
});

describe("verifySignature (X-Hub-Signature-256)", () => {
  test("accepts the HMAC-SHA256 of the raw body keyed with the app secret", async () => {
    expect(await verifySignature(SECRET, BODY, await signBody(SECRET, BODY))).toBe(true);
  });

  test("matches a known HMAC-SHA256 vector", async () => {
    // RFC 4231 test case 2: key "Jefe", data "what do ya want for nothing?"
    expect(await signBody("Jefe", "what do ya want for nothing?")).toBe(
      "sha256=5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });

  test("rejects a tampered body, a wrong secret, a missing or malformed header", async () => {
    const good = await signBody(SECRET, BODY);
    expect(await verifySignature(SECRET, `${BODY} `, good)).toBe(false);
    expect(await verifySignature("other-secret", BODY, good)).toBe(false);
    expect(await verifySignature(SECRET, BODY, null)).toBe(false);
    expect(await verifySignature(SECRET, BODY, "")).toBe(false);
    expect(await verifySignature(SECRET, BODY, good.replace("sha256=", "sha1="))).toBe(false);
    expect(await verifySignature(SECRET, BODY, "sha256=nothex")).toBe(false);
    expect(await verifySignature(SECRET, BODY, "sha256=abc")).toBe(false);
    expect(await verifySignature(SECRET, BODY, good.slice(0, -2))).toBe(false);
  });
});

describe("verifyChallenge", () => {
  test("echoes the challenge only for subscribe with our verify token", () => {
    expect(
      verifyChallenge(
        { "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "1158201444" },
        "tok",
      ),
    ).toBe("1158201444");
    expect(
      verifyChallenge(
        { "hub.mode": "subscribe", "hub.verify_token": "bad", "hub.challenge": "1" },
        "tok",
      ),
    ).toBeNull();
    expect(
      verifyChallenge(
        { "hub.mode": "subscribe", "hub.verify_token": "to", "hub.challenge": "1" },
        "tok",
      ),
    ).toBeNull();
    expect(
      verifyChallenge(
        { "hub.mode": "unsubscribe", "hub.verify_token": "tok", "hub.challenge": "1" },
        "tok",
      ),
    ).toBeNull();
    expect(verifyChallenge({}, "tok")).toBeNull();
  });
});

describe("parseMentionEvents", () => {
  const value = {
    id: "8901234",
    username: "someone",
    media_type: "IMAGE",
    media_url: "https://scontent.cdninstagram.com/x.jpg",
  };

  test("reads the Threads doc shape: values.{field,value} with target_id", () => {
    const events = parseMentionEvents({
      app_id: "1",
      topic: "interaction",
      target_id: "100",
      values: { field: "mentions", value },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      targetId: "100",
      post: { id: "8901234", username: "someone" },
    });
  });

  test("reads the Graph shape: entry[].changes[]", () => {
    const events = parseMentionEvents({
      object: "threads",
      entry: [
        {
          id: "100",
          time: 1,
          changes: [
            { field: "mentions", value },
            { field: "mentions", value: { id: "9" } },
          ],
        },
      ],
    });
    expect(events.map((e) => e.post.id)).toEqual(["8901234", "9"]);
    expect(events[0]?.targetId).toBe("100");
  });

  test("drops other fields and malformed entries", () => {
    expect(parseMentionEvents({ values: { field: "replies", value } })).toEqual([]);
    expect(parseMentionEvents({ values: { field: "publish", value } })).toEqual([]);
    expect(
      parseMentionEvents({ values: { field: "mentions", value: { username: "no id" } } }),
    ).toEqual([]);
    expect(parseMentionEvents({ values: { field: "mentions", value: "string" } })).toEqual([]);
    expect(parseMentionEvents({ entry: [null, 5, { changes: "x" }] })).toEqual([]);
    expect(parseMentionEvents(null)).toEqual([]);
    expect(parseMentionEvents([1, 2])).toEqual([]);
    expect(parseMentionEvents("x")).toEqual([]);
  });
});

describe("connect state", () => {
  test("round trip, expiry and tampering", async () => {
    const state = await createConnectState("server-secret", 1_000_000);
    expect(await verifyConnectState("server-secret", state, 1_000_001)).toBe(true);
    expect(await verifyConnectState("server-secret", state, 1_000_000 + 16 * 60_000)).toBe(false);
    expect(await verifyConnectState("other", state, 1_000_001)).toBe(false);
    expect(await verifyConnectState("server-secret", `${state}0`, 1_000_001)).toBe(false);
    expect(await verifyConnectState("server-secret", "", 1_000_001)).toBe(false);
    expect(await verifyConnectState("server-secret", "5.abcd", 1)).toBe(false);
  });
});

describe("parseSignedRequest", () => {
  const b64url = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  async function signed(secret: string, payload: object) {
    const part = b64url(new TextEncoder().encode(JSON.stringify(payload)));
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(part)),
    );
    return `${b64url(sig)}.${part}`;
  }

  test("returns the user id only for a valid signature", async () => {
    expect(
      await parseSignedRequest(
        SECRET,
        await signed(SECRET, { user_id: "100", algorithm: "HMAC-SHA256" }),
      ),
    ).toEqual({ userId: "100" });
    expect(await parseSignedRequest("wrong", await signed(SECRET, { user_id: "100" }))).toBeNull();
    expect(await parseSignedRequest(SECRET, await signed(SECRET, { nothing: 1 }))).toBeNull();
    expect(await parseSignedRequest(SECRET, "garbage")).toBeNull();
    expect(await parseSignedRequest(SECRET, "")).toBeNull();
  });
});
