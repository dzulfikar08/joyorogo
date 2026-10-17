import type { Hono } from "hono";

import type { StickersBucket } from "@joyorogo/api/lib/sticker";

/**
 * Opt-out from announcement mail (broadcasts). One R2 object per user under
 * `email-optout/<userId>` in the STICKERS bucket, so no D1 migration is needed;
 * the broadcast sender lists the prefix before every batch. Receipts and other
 * transactional mail never look at it.
 */
const OPTOUT_PREFIX = "email-optout/";
const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const optOutKey = (userId: string) => `${OPTOUT_PREFIX}${userId}`;

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

const hmacKey = (secret: string, usage: "sign" | "verify") =>
  crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);

const tokenMessage = (userId: string) => encoder.encode(`unsubscribe:v1:${userId}`);

/**
 * `<userId>.<HMAC-SHA256>` over a fixed purpose string. No expiry on purpose:
 * an unsubscribe link in an old email must keep working. The signature only
 * proves the link was minted by us for that user, so it cannot opt anyone else out.
 */
export async function signUnsubscribeToken(secret: string, userId: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), tokenMessage(userId));
  return `${userId}.${toBase64Url(new Uint8Array(signature))}`;
}

/** The user id a token was minted for, or null when malformed or forged. */
export async function verifyUnsubscribeToken(secret: string, token: string): Promise<string | null> {
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const userId = token.slice(0, dot);
  const signature = fromBase64Url(token.slice(dot + 1));
  if (!USER_ID_RE.test(userId) || !signature) return null;
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), signature, tokenMessage(userId));
  return valid ? userId : null;
}

/** Records the opt-out; a second call keeps the first timestamp. */
export async function recordOptOut(bucket: StickersBucket, userId: string, now = Date.now()): Promise<void> {
  if (await bucket.get(optOutKey(userId))) return;
  await bucket.put(optOutKey(userId), JSON.stringify({ at: now }), {
    httpMetadata: { contentType: "application/json" },
  });
}

/** Every opted-out user id (all pages of the prefix listing). */
export async function listOptedOut(bucket: StickersBucket): Promise<Set<string>> {
  const ids = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: OPTOUT_PREFIX, cursor });
    for (const object of page.objects) ids.add(object.key.slice(OPTOUT_PREFIX.length));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return ids;
}

const WEB = "https://joyorogo.com";

/** Small page in the web app's look: warm off-white, green primary, Plus Jakarta Sans when installed. */
function page(title: string, body: string): string {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer">
<title>${title} - JoyoRogo</title>
<style>
:root{color-scheme:light dark;--bg:oklch(.975 .008 85);--fg:oklch(.22 .012 85);--card:#fff;--muted:oklch(.5 .014 85);--border:oklch(.91 .01 85);--primary:oklch(.52 .13 152);--on-primary:oklch(.99 .005 152)}
@media (prefers-color-scheme:dark){:root{--bg:oklch(.17 .008 85);--fg:oklch(.96 .008 85);--card:oklch(.22 .01 85);--muted:oklch(.72 .012 85);--border:oklch(1 0 0/10%);--primary:oklch(.72 .15 152);--on-primary:oklch(.17 .008 85)}}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:1.25rem;background:var(--bg);color:var(--fg);font-family:"Plus Jakarta Sans Variable","Plus Jakarta Sans",ui-sans-serif,system-ui,sans-serif;line-height:1.55}
main{width:min(26rem,100%);background:var(--card);border:1px solid var(--border);border-radius:1.25rem;padding:1.75rem 1.5rem;text-align:center}
.brand{display:inline-flex;align-items:center;gap:.5rem;font-weight:700;margin-bottom:1rem}
.brand img{width:1.75rem;height:1.75rem}
h1{font-size:1.35rem;line-height:1.3;margin:0 0 .6rem}
p{margin:0 0 1.1rem;color:var(--muted);font-size:.95rem}
button,a.btn{display:block;width:100%;min-height:2.9rem;padding:.8rem 1rem;border:0;border-radius:9999px;background:var(--primary);color:var(--on-primary);font:inherit;font-weight:700;text-decoration:none;cursor:pointer}
a.quiet{display:inline-block;margin-top:.9rem;color:var(--muted);font-size:.875rem}
</style></head><body><main>
<div class="brand"><img src="${WEB}/brand/logo-mark.svg" alt="" width="28" height="28">JoyoRogo</div>
${body}
</main></body></html>`;
}

const confirmPage = page(
  "Berhenti berlangganan",
  `<h1>Berhenti berlangganan?</h1>
<p>Kamu tidak akan menerima email pengumuman dari JoyoRogo lagi. Struk pembayaran dan pemberitahuan akun tetap dikirim.</p>
<form method="post"><button type="submit">Ya, berhenti berlangganan</button></form>
<a class="quiet" href="${WEB}">Batal</a>`,
);

const donePage = page(
  "Sudah berhenti",
  `<h1>Sudah berhenti berlangganan</h1>
<p>Kamu tidak akan menerima email pengumuman dari JoyoRogo lagi. Terima kasih sudah memakai JoyoRogo.</p>
<a class="btn" href="${WEB}">Ke JoyoRogo</a>`,
);

const invalidPage = page(
  "Tautan tidak valid",
  `<h1>Tautan tidak valid</h1>
<p>Tautan ini rusak atau tidak berlaku. Balas saja emailnya, nanti kami bantu berhentikan.</p>
<a class="btn" href="${WEB}">Ke JoyoRogo</a>`,
);

const unavailablePage = page(
  "Coba lagi nanti",
  `<h1>Belum bisa diproses</h1>
<p>Permintaanmu belum tersimpan. Coba lagi beberapa saat lagi, atau balas email pengumumannya.</p>`,
);

type Deps = {
  /** BETTER_AUTH_SECRET, the HMAC key. */
  secret: string;
  getBucket: () => StickersBucket | undefined;
};

/**
 * Public unsubscribe route (no session). GET shows a confirm page, so a mail
 * scanner that prefetches links cannot opt anyone out. POST records the
 * opt-out: from that page's button, or as RFC 8058 one-click from a mail
 * client (`List-Unsubscribe-Post: List-Unsubscribe=One-Click`). Both carry the
 * signed token in `?t=`.
 */
export function registerUnsubscribeRoutes(app: Hono, deps: Deps) {
  const headers = {
    "cache-control": "no-store",
    "x-robots-tag": "noindex",
    "referrer-policy": "no-referrer",
  };

  app.get("/unsubscribe", async (c) => {
    const userId = await verifyUnsubscribeToken(deps.secret, c.req.query("t") ?? "");
    return userId ? c.html(confirmPage, 200, headers) : c.html(invalidPage, 400, headers);
  });

  app.post("/unsubscribe", async (c) => {
    const userId = await verifyUnsubscribeToken(deps.secret, c.req.query("t") ?? "");
    if (!userId) return c.html(invalidPage, 400, headers);
    const bucket = deps.getBucket();
    if (!bucket) return c.html(unavailablePage, 503, headers);
    try {
      await recordOptOut(bucket, userId);
    } catch (error) {
      console.error("unsubscribe: could not record opt-out", error);
      return c.html(unavailablePage, 503, headers);
    }
    return c.html(donePage, 200, headers);
  });
}
