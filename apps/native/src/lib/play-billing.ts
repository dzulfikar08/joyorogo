// Google Play Billing for the Play build, over expo-iap (Play Billing Library).
// expo-iap is autolinked on Android only (see "expo.autolinking" in
// package.json): this file is require()d lazily from components/billing.tsx
// and only in the Play build, so iOS and sideload builds never load it.
//
// Play Console products: subscriptions `pro` and `keluarga` (Joyo Keluarga),
// each with base plans `monthly` and `yearly`. Prices are never hardcoded: they
// come from Play per user/locale.
// Acknowledging is the server's job (after it credits the purchase), so this
// module never calls finishTransaction.
import {
  ErrorCode,
  fetchProducts,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
} from "expo-iap";
import type { ProductSubscription, Purchase } from "expo-iap";

import type { StorePrice } from "@/src/lib/pro-plans";
import { i18n } from "@joyorogo/i18n";

export const PRO_PRODUCT_ID = "pro";
/** Joyo Keluarga (docs/pricing/joyo-keluarga.md section 4.4); same base plan ids as `pro`. */
export const KELUARGA_PRODUCT_ID = "keluarga";

export type PlayPlan = "monthly" | "yearly";
/** Which subscription: Joyo Pro for one account, or Joyo Keluarga for the payer's household. */
export type PlayProduct = "pro" | "keluarga";

const PRODUCT_IDS: Record<PlayProduct, string> = { pro: PRO_PRODUCT_ID, keluarga: KELUARGA_PRODUCT_ID };

/**
 * Pro -> Keluarga on the same Google account is a Play subscription replacement, so the buyer never pays for both.
 * CHARGE_FULL_PRICE (Play Billing value 5): Keluarga starts now at its full price, matching the server, which credits
 * one full plan period to the household per charged order and leaves the buyer's own Pro period untouched. Play
 * refunds or credits the unused Pro part on its side [TO VERIFY with Play Console test purchases before release].
 */
export const KELUARGA_REPLACEMENT_MODE = "charge-full-price" as const;

export type PlayPlanOffer = {
  /** Localized price from Play, e.g. "Rp15.000". */
  displayPrice: string;
  /** The same price as an amount, for per-month and saving arithmetic; null when Play omits it. */
  price: StorePrice | null;
  offerToken: string;
};

export type PlayPlans = Partial<Record<PlayPlan, PlayPlanOffer>>;

export type PlayPurchaseOutcome =
  | { status: "purchased"; purchaseToken: string }
  | { status: "pending"; purchaseToken?: string }
  | { status: "cancelled" };

/** A purchase the user owns in Play, as the server needs it. */
export type PlayOwnedPurchase = {
  purchaseToken: string;
  /** Play product id ("pro" or "keluarga"). */
  productId: string;
  /** Play has not charged yet (convenience-store / cash payment). */
  pending: boolean;
};

/** Play's own "already subscribed" refusal; callers show a friendlier message. */
export class AlreadySubscribedError extends Error {}

let connection: Promise<unknown> | null = null;

/** One shared connection to the Play Billing service; a failed attempt is retried next call. */
function connect(): Promise<unknown> {
  connection ??= initConnection().catch((error: unknown) => {
    connection = null;
    throw error;
  });
  return connection;
}

/** A Play pricing phase as an amount; null when Play sent no usable number. */
function storePrice(
  phase: { priceAmountMicros?: string; priceCurrencyCode?: string } | undefined,
): StorePrice | null {
  const micros = Number(phase?.priceAmountMicros);
  if (!phase?.priceCurrencyCode || !Number.isFinite(micros) || micros <= 0) return null;
  return { micros, currency: phase.priceCurrencyCode };
}

/**
 * The base-plan offer of each plan. Promotional offers carry extra pricing
 * phases (trial, intro price), so the offer with the fewest phases is the
 * plain base plan; its last phase is the recurring price.
 */
export async function loadPlans(which: PlayProduct = "pro"): Promise<PlayPlans> {
  await connect();
  const sku = PRODUCT_IDS[which];
  const products = ((await fetchProducts({ skus: [sku], type: "subs" })) ??
    []) as ProductSubscription[];
  const product = products.find((p) => p.platform === "android" && p.id === sku);
  if (!product) return {};

  const plans: PlayPlans = {};
  for (const plan of ["monthly", "yearly"] as const) {
    let best: { phases: number; offer: PlayPlanOffer } | null = null;
    for (const offer of product.subscriptionOffers ?? []) {
      if (offer.basePlanIdAndroid !== plan || !offer.offerTokenAndroid) continue;
      const phases = offer.pricingPhasesAndroid?.pricingPhaseList ?? [];
      const recurring = phases[phases.length - 1];
      if (best && best.phases <= phases.length) continue;
      best = {
        phases: phases.length,
        offer: {
          displayPrice: recurring?.formattedPrice ?? offer.displayPrice,
          price: storePrice(recurring),
          offerToken: offer.offerTokenAndroid,
        },
      };
    }
    if (best) plans[plan] = best.offer;
  }
  return plans;
}

/**
 * Opens the Play purchase sheet for one plan and resolves with the outcome.
 * `accountId` (the signed-in user's id) rides along as obfuscatedAccountId so
 * the server can refuse a purchase made for a different account. `replace` is
 * the purchase token of a live `pro` subscription when buying Keluarga: Play
 * then swaps Pro for Keluarga instead of selling a second subscription.
 */
export async function buyPlan(
  plan: PlayPlan,
  accountId: string,
  which: PlayProduct = "pro",
  replace?: { purchaseToken: string } | null,
): Promise<PlayPurchaseOutcome> {
  const sku = PRODUCT_IDS[which];
  const offer = (await loadPlans(which))[plan];
  if (!offer) throw new Error(i18n.t("billing:error.playNoOffer"));

  return new Promise<PlayPurchaseOutcome>((resolve, reject) => {
    const subscriptions: { remove: () => void }[] = [];
    const settle = (finish: () => void) => {
      for (const subscription of subscriptions) subscription.remove();
      finish();
    };
    subscriptions.push(
      purchaseUpdatedListener((purchase) => {
        if (purchase.productId !== sku) return;
        if (purchase.purchaseState === "pending") {
          const purchaseToken = purchase.purchaseToken ?? undefined;
          settle(() => resolve({ status: "pending", purchaseToken }));
        } else if (purchase.purchaseState === "purchased" && purchase.purchaseToken) {
          const purchaseToken = purchase.purchaseToken;
          settle(() => resolve({ status: "purchased", purchaseToken }));
        }
      }),
      purchaseErrorListener((error) => {
        settle(() => {
          if (error.code === ErrorCode.UserCancelled) resolve({ status: "cancelled" });
          else if (error.code === ErrorCode.AlreadyOwned) reject(new AlreadySubscribedError());
          else reject(new Error(error.message));
        });
      }),
    );
    requestPurchase({
      type: "subs",
      request: {
        google: {
          skus: [sku],
          subscriptionOffers: [{ sku, offerToken: offer.offerToken }],
          obfuscatedAccountId: accountId,
          ...(which === "keluarga" && replace
            ? {
                purchaseToken: replace.purchaseToken,
                subscriptionProductReplacementParams: {
                  oldProductId: PRO_PRODUCT_ID,
                  replacementMode: KELUARGA_REPLACEMENT_MODE,
                },
              }
            : {}),
        },
      },
    }).catch((error: unknown) => {
      settle(() => reject(error instanceof Error ? error : new Error(String(error))));
    });
  });
}

/** Subscriptions Play says this Google account holds (restore / replay). */
export async function ownedPurchases(): Promise<PlayOwnedPurchase[]> {
  await connect();
  const purchases: Purchase[] = await getAvailablePurchases();
  return purchases
    .filter(
      (purchase) =>
        (purchase.productId === PRO_PRODUCT_ID || purchase.productId === KELUARGA_PRODUCT_ID) &&
        purchase.purchaseToken,
    )
    .map((purchase) => ({
      purchaseToken: purchase.purchaseToken as string,
      productId: purchase.productId,
      pending: purchase.purchaseState === "pending",
    }));
}
