// Pakasir API v2 (https://pakasir.com/p/create-transaction): hosted payment
// link per order, success webhook carrying an X-Secret header, and a status
// endpoint the webhook handler re-checks before crediting anything. Order ids
// come from ./doku (buildOrderId) so both gateways share the payment table.

export const PAKASIR_BASE_URL = "https://app.pakasir.com";
/** Path set as the project's webhook URL in the Pakasir dashboard. */
export const WEBHOOK_PATH = "/api/billing/pakasir/webhook";

export type PakasirConfig = {
  slug: string;
  apiKey: string;
  webhookSecret: string;
  /** Sandbox-mode transactions only credit Founder when this is on. */
  allowSandbox: boolean;
};

export type PakasirTransaction = {
  txnId: string;
  orderId: string;
  amount: number;
  status: string;
  isSandbox: boolean;
};

/**
 * Webhook body and status response share this shape:
 * { txn_id, order_id, amount, is_sandbox, status, completed_at }.
 */
export function parseTransaction(raw: unknown): PakasirTransaction | null {
  if (typeof raw !== "object" || raw === null) return null;
  const {
    txn_id: txnId,
    order_id: orderId,
    amount,
    status,
    is_sandbox: isSandbox,
  } = raw as Record<string, unknown>;
  if (typeof txnId !== "string" || !txnId) return null;
  if (typeof orderId !== "string" || typeof status !== "string") return null;
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  return { txnId, orderId, amount, status, isSandbox: isSandbox === true };
}

/** Settled payment. Pending never counts. */
export function isPaid(t: PakasirTransaction): boolean {
  return t.status === "completed";
}

/** Canceled from the dashboard or expired after 24 hours: never payable. */
export function isFailed(t: PakasirTransaction): boolean {
  return t.status === "canceled";
}

/** Constant-time compare of the webhook's X-Secret header. */
export function secretMatches(given: string, expected: string): boolean {
  if (!expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Create (or find: Pakasir is idempotent per order_id) a payment link where
 * the buyer picks QRIS or a bank VA; `qrisOnly` locks it to the QR code.
 * `redirectUrl` backs the page's "Kembali ke halaman Merchant" button.
 */
export async function createPaymentLink(
  config: PakasirConfig,
  params: { orderId: string; amountIdr: number; redirectUrl: string; qrisOnly?: boolean },
): Promise<{ txnId: string; paymentUrl: string }> {
  const res = await fetch(
    `${PAKASIR_BASE_URL}/api/v2/create-transaction/${encodeURIComponent(config.slug)}/${encodeURIComponent(params.orderId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": config.apiKey },
      body: JSON.stringify({ method: "payment_link", amount: params.amountIdr }),
    },
  );
  const body = (await res.json().catch(() => null)) as {
    txn_id?: unknown;
    payment_link?: unknown;
  } | null;
  if (!res.ok || typeof body?.txn_id !== "string" || typeof body.payment_link !== "string") {
    throw new Error(`pakasir create-transaction failed: HTTP ${res.status}`);
  }
  const url = new URL(body.payment_link);
  url.searchParams.set("redirect", params.redirectUrl);
  if (params.qrisOnly) url.searchParams.set("qris_only", "1");
  return { txnId: body.txn_id, paymentUrl: url.toString() };
}

/** Authoritative transaction state; rate limited to once per 4s per txn. */
export async function fetchTransaction(
  config: PakasirConfig,
  txnId: string,
): Promise<PakasirTransaction> {
  const res = await fetch(
    `${PAKASIR_BASE_URL}/api/v2/transaction-status/${encodeURIComponent(config.slug)}/${encodeURIComponent(txnId)}`,
    { headers: { "X-Api-Key": config.apiKey } },
  );
  const parsed = parseTransaction(await res.json().catch(() => null));
  if (!res.ok || !parsed) {
    throw new Error(`pakasir transaction-status failed: HTTP ${res.status}`);
  }
  return parsed;
}
