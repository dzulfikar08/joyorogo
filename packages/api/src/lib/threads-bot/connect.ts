// OAuth `state` for the admin "Connect Threads" flow, and Meta's signed_request (deauthorize / data deletion callbacks).
// Stateless: the state is an expiry plus an HMAC under a server secret, so no table is needed. Only an admin can mint one
// (the connect route sits behind the admin gate), and the public callback accepts nothing else.

import { signBody, verifySignature } from "./webhook";

const STATE_TTL_MS = 15 * 60 * 1000;
const scope = (exp: number) => `threads-connect.${exp}`;

export async function createConnectState(secret: string, now: number): Promise<string> {
  const exp = now + STATE_TTL_MS;
  return `${exp}.${(await signBody(secret, scope(exp))).slice("sha256=".length)}`;
}

export async function verifyConnectState(
  secret: string,
  state: string,
  now: number,
): Promise<boolean> {
  const [rawExp, sig] = state.split(".");
  const exp = Number(rawExp);
  if (!sig || !Number.isInteger(exp) || exp < now) return false;
  return verifySignature(secret, scope(exp), `sha256=${sig}`);
}

function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(
      input
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(input.length / 4) * 4, "="),
    );
    return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

/** `signed_request` = base64url(HMAC-SHA256(payload, app secret)) + "." + base64url(JSON payload). Returns the payload's user_id, or null when the signature is wrong. */
export async function parseSignedRequest(
  appSecret: string,
  signedRequest: string,
): Promise<{ userId: string } | null> {
  const [sigPart, payloadPart] = signedRequest.split(".");
  if (!sigPart || !payloadPart) return null;
  const sig = base64UrlToBytes(sigPart);
  const payload = base64UrlToBytes(payloadPart);
  if (!sig || !payload) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  if (!(await crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(payloadPart))))
    return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(payload)) as { user_id?: unknown };
    return typeof data.user_id === "string" || typeof data.user_id === "number"
      ? { userId: String(data.user_id) }
      : null;
  } catch {
    return null;
  }
}
