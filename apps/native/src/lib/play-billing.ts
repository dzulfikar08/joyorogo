// Google Play Billing for the Play build, over expo-iap (Play Billing Library).
// expo-iap is autolinked on Android only (see "expo.autolinking" in
// package.json): this file is require()d lazily from components/billing.tsx
// and only in the Play build, so iOS and sideload builds never load it.
//
// Play Console product: subscription `pro` with base plans `monthly` and
// `yearly`. Prices are never hardcoded: they come from Play per user/locale.
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

export const PRO_PRODUCT_ID = "pro";

export type PlayPlan = "monthly" | "yearly";

export type PlayPlanOffer = {
  /** Localized price from Play, e.g. "Rp15.000". */
  displayPrice: string;
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

/**
 * The base-plan offer of each plan. Promotional offers carry extra pricing
 * phases (trial, intro price), so the offer with the fewest phases is the
 * plain base plan; its last phase is the recurring price.
 */
export async function loadPlans(): Promise<PlayPlans> {
  await connect();
  const products = ((await fetchProducts({ skus: [PRO_PRODUCT_ID], type: "subs" })) ??
    []) as ProductSubscription[];
  const product = products.find((p) => p.platform === "android" && p.id === PRO_PRODUCT_ID);
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
 * the server can refuse a purchase made for a different account.
 */
export async function buyPlan(plan: PlayPlan, accountId: string): Promise<PlayPurchaseOutcome> {
  const offer = (await loadPlans())[plan];
  if (!offer) throw new Error("Langganan belum tersedia di Google Play.");

  return new Promise<PlayPurchaseOutcome>((resolve, reject) => {
    const subscriptions: { remove: () => void }[] = [];
    const settle = (finish: () => void) => {
      for (const subscription of subscriptions) subscription.remove();
      finish();
    };
    subscriptions.push(
      purchaseUpdatedListener((purchase) => {
        if (purchase.productId !== PRO_PRODUCT_ID) return;
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
          skus: [PRO_PRODUCT_ID],
          subscriptionOffers: [{ sku: PRO_PRODUCT_ID, offerToken: offer.offerToken }],
          obfuscatedAccountId: accountId,
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
    .filter((purchase) => purchase.productId === PRO_PRODUCT_ID && purchase.purchaseToken)
    .map((purchase) => ({
      purchaseToken: purchase.purchaseToken as string,
      pending: purchase.purchaseState === "pending",
    }));
}
