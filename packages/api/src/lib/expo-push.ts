// Expo Push Service client (JoyoRogo native and JoyoFit tokens). Batches of up to 100, one HTTP call per batch.
// Expo hands the message to FCM (Android) or APNs (iOS) with the credentials of the app's EAS project; a token of
// another project is sent the same way, so one JoyoRogo Worker serves both apps.

export type ExpoPushEnv = {
  /** Only needed when "enhanced push security" is on for an EAS project; unset sends without it. */
  EXPO_ACCESS_TOKEN?: string;
  /** Test override of the send endpoint's origin, like JoyoFit's EXPO_PUSH_URL. */
  EXPO_PUSH_URL?: string;
};

export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  /** Android notification channel; a channel the app never created falls back to the default one. */
  channelId?: string;
  priority?: "default" | "high";
  /** Seconds the push service keeps trying while the phone is offline. */
  ttl?: number;
};

/** One entry per message sent, in order. */
export type ExpoSendResult =
  | { ok: true; ticketId: string }
  /** `dead`: DeviceNotRegistered, delete the token. `transient`: worth another attempt later. */
  | { ok: false; dead: boolean; transient: boolean; error: string };

export const EXPO_BATCH = 100;
const DEFAULT_URL = "https://exp.host/--/api/v2/push";

/** What `getExpoPushTokenAsync` returns; anything else is not a token this service can deliver to. */
export function isExpoToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/.test(token);
}

function headers(env: ExpoPushEnv): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
  };
}

function base(env: ExpoPushEnv): string {
  return (env.EXPO_PUSH_URL ?? DEFAULT_URL).replace(/\/$/, "");
}

type RawTicket = { status?: string; id?: string; message?: string; details?: { error?: string } };

function toResult(ticket: RawTicket | undefined): ExpoSendResult {
  if (ticket?.status === "ok" && typeof ticket.id === "string") return { ok: true, ticketId: ticket.id };
  const error = ticket?.details?.error ?? ticket?.message ?? "no-ticket";
  const dead = ticket?.details?.error === "DeviceNotRegistered";
  // MessageRateExceeded asks to slow down; every other named error (MessageTooBig, InvalidCredentials, a bad
  // payload) repeats on retry, so only the rate limit and a missing ticket count as transient.
  const transient = !dead && (ticket?.details?.error === "MessageRateExceeded" || ticket === undefined);
  return { ok: false, dead, transient, error };
}

/** Sends `messages` (any number; chunks of 100). A failed HTTP call marks that chunk's messages transient. */
export async function sendExpo(
  env: ExpoPushEnv,
  messages: ExpoMessage[],
  fetcher: typeof fetch = fetch,
): Promise<ExpoSendResult[]> {
  const out: ExpoSendResult[] = [];
  for (let i = 0; i < messages.length; i += EXPO_BATCH) {
    const chunk = messages.slice(i, i + EXPO_BATCH);
    try {
      const response = await fetcher(`${base(env)}/send`, {
        method: "POST",
        headers: headers(env),
        body: JSON.stringify(
          chunk.map((m) => ({ sound: "default", priority: "high", ttl: 86_400, ...m })),
        ),
      });
      if (!response.ok) {
        const transient = response.status === 429 || response.status >= 500;
        out.push(...chunk.map(() => ({ ok: false as const, dead: false, transient, error: `http-${response.status}` })));
        continue;
      }
      const body = (await response.json()) as { data?: RawTicket[] };
      const tickets = Array.isArray(body.data) ? body.data : [];
      out.push(...chunk.map((_, index) => toResult(tickets[index])));
    } catch {
      out.push(...chunk.map(() => ({ ok: false as const, dead: false, transient: true, error: "network" })));
    }
  }
  return out;
}

export type ExpoReceipt = { ok: boolean; dead: boolean; error?: string };

/**
 * Receipts for ticket ids (Expo keeps them 24 h; read them 15+ minutes after sending). Unknown ids are absent from the
 * result. Dead tokens are the point: FCM / APNs only tell Expo after the send.
 */
export async function fetchReceipts(
  env: ExpoPushEnv,
  ids: string[],
  fetcher: typeof fetch = fetch,
): Promise<Record<string, ExpoReceipt>> {
  const out: Record<string, ExpoReceipt> = {};
  for (let i = 0; i < ids.length; i += 300) {
    try {
      const response = await fetcher(`${base(env)}/getReceipts`, {
        method: "POST",
        headers: headers(env),
        body: JSON.stringify({ ids: ids.slice(i, i + 300) }),
      });
      if (!response.ok) continue;
      const body = (await response.json()) as { data?: Record<string, RawTicket> };
      for (const [id, receipt] of Object.entries(body.data ?? {})) {
        const error = receipt.details?.error ?? receipt.message;
        out[id] = {
          ok: receipt.status === "ok",
          dead: receipt.details?.error === "DeviceNotRegistered",
          ...(error ? { error } : {}),
        };
      }
    } catch {
      // read again on the next tick; the ids stay on the outbox row
    }
  }
  return out;
}
