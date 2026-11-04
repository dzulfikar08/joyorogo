// Pure gateway choices of the web checkout (apps/server/src/billing.ts), apart so they can be tested without the Worker.
import { createCheckout } from "@joyorogo/api/lib/doku";
import type { DokuConfig } from "@joyorogo/api/lib/doku";

export type Provider = "doku" | "pakasir";

/** Buyer-facing choice in the checkout picker; each maps to one gateway (methodGateway). */
export type PaymentMethod = "qris" | "transfer";
export const PAYMENT_METHODS: readonly PaymentMethod[] = ["qris", "transfer"];

/** Where a web checkout was started from, besides JoyoRogo itself. Allowlist: it picks a return link. */
export type OrderSource = "joyoarto";
export function orderSource(value: unknown): OrderSource | null {
  return value === "joyoarto" ? "joyoarto" : null;
}

export const flagOn = (value: string | undefined) => ["1", "on", "true"].includes((value ?? "").trim().toLowerCase());

/**
 * QRIS goes to Pakasir only while PAKASIR_ENABLED is on; otherwise to DOKU Checkout limited to its QRIS channel.
 * Bank transfer is always DOKU.
 */
export function methodGateway(method: PaymentMethod, pakasirForNewOrders: boolean): Provider {
  return method === "qris" && pakasirForNewOrders ? "pakasir" : "doku";
}

/** Gateway for checkouts without a payment method; null = checkout off. */
export function defaultProvider(
  choice: string | undefined,
  configured: Record<Provider, boolean>,
): Provider | null {
  if ((choice === "doku" || choice === "pakasir") && configured[choice]) return choice;
  if (configured.doku) return "doku";
  if (configured.pakasir) return "pakasir";
  return null;
}

/**
 * DOKU Checkout, narrowed to the given channels when asked. If DOKU refuses the narrowed request (a channel not
 * enabled on the merchant), the buyer gets DOKU's full page instead of an error: QRIS is still on it.
 */
export async function createDokuCheckout(
  config: DokuConfig,
  params: Parameters<typeof createCheckout>[1],
  create: typeof createCheckout = createCheckout,
): Promise<{ paymentUrl: string }> {
  if (!params.paymentMethodTypes?.length) return create(config, params);
  try {
    return await create(config, params);
  } catch (error) {
    console.error(`doku checkout ${params.orderId} with ${params.paymentMethodTypes.join(",")} failed, retrying with every channel:`, error);
    return create(config, { ...params, paymentMethodTypes: undefined });
  }
}
