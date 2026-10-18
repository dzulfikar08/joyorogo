import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Linking, Platform, View } from "react-native";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { LOCALE_HEADER, i18n } from "@joyorogo/i18n";

import { appleIap } from "@/modules/apple-iap";
import { authClient } from "@/lib/auth-client";
import { Disclosure } from "@/components/disclosure";
import { Button, Card, Sheet, Text } from "@/components/ui";
import { PressableScale, useEnter } from "@/components/motion";
import Animated from "react-native-reanimated";
import { useToast } from "@/components/toast";
import { errorMessage, fmtDateLong, fmtIdr } from "@/utils/format";
import { IS_PLAY_BUILD } from "@/src/distribution";
import { ENV } from "@/src/env";
import type * as PlayBilling from "@/src/lib/play-billing";
import { queryClient } from "@/utils/orpc";

/** Server-decided paywall/billing settings (GET /api/config). */
export type AppConfig = {
  /** Free users have a daily scan limit. */
  paywall: boolean;
  /** Founder checkout is available (paywall + a payment gateway configured). */
  billing: boolean;
  /**
   * Checkout picker options in display order: "qris" (Pakasir) and/or
   * "transfer" (DOKU). Missing on servers older than the picker.
   */
  paymentMethods?: PaymentMethod[];
  /** Apple in-app purchase is available on iOS (paywall configured). */
  appleBilling: boolean;
  /** Google Play Billing is available (paywall + Play service account); used by the Play build only. */
  googlePlayBilling?: boolean;
  freeDailyScans: number | null;
  founderDailyCap: number | null;
  founderPriceIdr: number;
  /** Yearly Pro price of the current ladder step (Rp199.000 at buyers 11-110). */
  founderYearlyPriceIdr: number;
  /**
   * Founder intro-price ladder; null when the promo is off. `slots` = buyers
   * allowed at the current step, `taken` = buyers so far, `nextPriceIdr` =
   * monthly price after this step fills (null/undefined = no further increase).
   */
  promo: { slots: number; taken: number; nextPriceIdr?: number | null } | null;
  anonScans: number;
};

/** Buyer-facing payment choice; the server maps each to its gateway. */
export type PaymentMethod = "qris" | "transfer";

/**
 * Server origin: the same host serves the public share page (/u/<code>),
 * the privacy policy (/privasi), and the billing endpoints.
 */
export function serverUrl(): string {
  if (ENV.EXPO_PUBLIC_SERVER_URL) return ENV.EXPO_PUBLIC_SERVER_URL.replace(/\/$/, "");
  return "http://localhost:3000";
}

/**
 * Read at runtime, not build time: self-hosted copies run without billing and
 * must show no pricing at all rather than guessing (same contract as web).
 * The Google Play build never sells through the DOKU/Pakasir checkout: Play
 * requires Play Billing for digital goods, so `billing` there means "Play
 * Billing is configured on the server" and the web payment options and promo
 * are hidden. When it is off every purchase surface (banner, /founder, Profil
 * cards) stays hidden.
 */
export function useAppConfig() {
  return useQuery({
    queryKey: ["app-config"],
    queryFn: async (): Promise<AppConfig> => {
      const res = await fetch(`${serverUrl()}/api/config`);
      if (!res.ok) throw new Error(`config ${res.status}`);
      const config = (await res.json()) as AppConfig;
      return IS_PLAY_BUILD
        ? {
            ...config,
            billing: config.googlePlayBilling === true,
            paymentMethods: [],
            promo: null,
          }
        : config;
    },
    staleTime: 60 * 60 * 1000,
    retry: 2,
  });
}

/** "12 November 2026" / "November 12, 2026" in WIB, in the active language. */
export function fmtFounderDate(value: string | Date): string {
  const wibDay = new Date(new Date(value).getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
  return fmtDateLong(wibDay).replace(/^\w+, /, "");
}

// Better Auth Expo forwards the session cookie manually on native. The server
// writes billing errors in the language the UI shows.
async function checkoutHeaders(): Promise<Record<string, string>> {
  const locale = { [LOCALE_HEADER]: i18n.language };
  if (Platform.OS === "web") return locale;
  const cookies = await authClient.getCookie();
  return cookies ? { ...locale, Cookie: cookies } : locale;
}

/** One Founder order as the order endpoints answer it. */
export type BillingOrder = {
  orderId: string;
  status: string;
  amountIdr: number;
  founderUntil: string | null;
};

/**
 * "Cek pembayaran": the server asks DOKU/Pakasir right now and settles the
 * order when it is already paid (covers a webhook that never arrived).
 */
export async function checkOrderPaid(orderId: string): Promise<BillingOrder> {
  const res = await fetch(
    `${serverUrl()}/api/billing/orders/${encodeURIComponent(orderId)}/check`,
    { method: "POST", headers: await checkoutHeaders() },
  );
  const body = (await res.json().catch(() => null)) as BillingOrder | { error?: string } | null;
  if (res.status === 401) throw new Error(i18n.t("billing:error.signIn"));
  if (!res.ok || !body || !("status" in body)) {
    throw new Error(i18n.t("billing:error.checkFailed"));
  }
  return body;
}

/** Founder billing period; yearly stacks 12 months on the remaining period. */
export type CheckoutPlan = "monthly" | "yearly";

/**
 * Start a Founder checkout, opened in the browser. `method` picks QRIS
 * (Pakasir) or bank transfer (DOKU); omitted = server default. UI goes
 * through useCheckoutPicker, which asks the buyer first.
 */
export function useFounderCheckout(plan: CheckoutPlan = "monthly") {
  return useMutation({
    mutationFn: async (
      method: PaymentMethod | undefined,
    ): Promise<{ orderId: string; paymentUrl: string }> => {
      const res = await fetch(`${serverUrl()}/api/billing/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await checkoutHeaders()) },
        body: JSON.stringify({ plan, method }),
      });
      const body = (await res.json().catch(() => null)) as {
        orderId?: string;
        paymentUrl?: string;
        error?: string;
      } | null;
      if (res.status === 401) throw new Error(i18n.t("billing:error.signIn"));
      if (!res.ok || !body?.paymentUrl) {
        throw new Error(body?.error ?? i18n.t("billing:error.checkoutFailed"));
      }
      return { orderId: body.orderId ?? "", paymentUrl: body.paymentUrl };
    },
    onSuccess: async ({ orderId, paymentUrl }) => {
      await WebBrowser.openBrowserAsync(paymentUrl);
      queryClient.invalidateQueries();
      // Back from the gateway: settle a webhook-less payment right away.
      try {
        if (orderId && (await checkOrderPaid(orderId)).status === "paid") {
          queryClient.invalidateQueries();
        }
      } catch {
        // Profil's "Sudah bayar?" button and the server cron still cover this.
      }
    },
  });
}

const METHOD_ICONS: Record<PaymentMethod, React.ComponentProps<typeof Ionicons>["name"]> = {
  qris: "qr-code-outline",
  transfer: "business-outline",
};

/**
 * Founder checkout behind a "QRIS atau Transfer Bank" choice (Android; iOS
 * buys through Apple). `start()` opens the picker when the server offers
 * both, otherwise goes straight to the one gateway (or the server default
 * when the config predates the picker). Render `sheet` once on the screen.
 */
export function useCheckoutPicker(plan: CheckoutPlan = "monthly") {
  const { t } = useTranslation("billing");
  const config = useAppConfig();
  const checkout = useFounderCheckout(plan);
  const { theme } = useUnistyles();
  const [open, setOpen] = useState(false);
  const onErrorRef = useRef<((error: Error) => void) | undefined>(undefined);
  const methods = config.data?.paymentMethods ?? [];

  const start = (onError?: (error: Error) => void) => {
    onErrorRef.current = onError;
    if (methods.length > 1) setOpen(true);
    else checkout.mutate(methods[0], { onError });
  };

  const sheet = (
    <Sheet visible={open} onClose={() => setOpen(false)} title={t("picker.title")}>
      <Text style={styles.methodHint}>{t("picker.description")}</Text>
      {methods.map((method) => {
        const icon = METHOD_ICONS[method];
        const label = t(`picker.${method}.label`);
        const note = t(`picker.${method}.note`);
        return (
          <PressableScale
            key={method}
            accessibilityRole="button"
            accessibilityLabel={`${label}. ${note}`}
            disabled={checkout.isPending}
            onPress={() => {
              setOpen(false);
              checkout.mutate(method, { onError: onErrorRef.current });
            }}
            scaleTo={0.98}
            dimTo={0.8}
            style={styles.methodOption}
          >
            <View style={styles.methodIcon}>
              <Ionicons name={icon} size={26} color={theme.colors.primary} />
            </View>
            <View style={styles.cardText}>
              <Text style={styles.methodLabel}>{label}</Text>
              <Text style={styles.cardNote}>{note}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.colors.mutedForeground} />
          </PressableScale>
        );
      })}
    </Sheet>
  );

  return {
    start,
    sheet,
    isPending: checkout.isPending,
    error: checkout.error,
  };
}

/** Latest pending order of the caller (null when none); drives "Sudah bayar?". */
export function usePendingOrder(enabled: boolean) {
  return useQuery({
    queryKey: ["billing-pending-order"],
    queryFn: async (): Promise<string | null> => {
      const res = await fetch(`${serverUrl()}/api/billing/orders`, {
        headers: await checkoutHeaders(),
      });
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`orders ${res.status}`);
      const body = (await res
        .json()
        .catch(() => null)) as { pending?: { orderId?: string } | null } | null;
      return body?.pending?.orderId ?? null;
    },
    enabled,
    staleTime: 30 * 1000,
    retry: 1,
  });
}

/**
 * Founder intro-price banner with slot progress. Render it on Android only:
 * Apple charges its own App Store price, so the DOKU promo copy would
 * mismatch on iOS.
 */
export function FounderPromoCard() {
  const { t } = useTranslation("billing");
  const config = useAppConfig();
  const promo = config.data?.promo;
  const enter = useEnter(1);
  if (!config.data || !promo || promo.slots - promo.taken <= 0) return null;
  const left = promo.slots - promo.taken;
  const nextPriceIdr = promo.nextPriceIdr ?? null;
  return (
    <Animated.View entering={enter}>
      <Card style={styles.promoCard}>
        <Text style={styles.promoHeadline}>
          {t("promo.headline", { price: fmtIdr(config.data.founderPriceIdr) })}
        </Text>
        <Text style={styles.promoText}>
          <Trans
            ns="billing"
            i18nKey="promo.slots"
            count={left}
            values={{ total: promo.slots, left }}
            components={{ b: <Text style={styles.promoBold} /> }}
          />
        </Text>
        <View style={styles.promoTrack}>
          <View
            style={[
              styles.promoFill,
              { width: `${Math.min(100, Math.max(0, (promo.taken / promo.slots) * 100))}%` },
            ]}
          />
        </View>
        <Disclosure plain title={t("promo.details")}>
          {nextPriceIdr !== null ? (
            <Text style={styles.promoNote}>{t("promo.then", { price: fmtIdr(nextPriceIdr) })}</Text>
          ) : null}
          <Text style={styles.promoNote}>{t("promo.locked")}</Text>
        </Disclosure>
      </Card>
    </Animated.View>
  );
}

/** App Store Connect auto-renewable subscriptions (group "JoyoRogo Founder"); the server verifies the ids. */
const FOUNDER_PRODUCT_IDS = {
  monthly: "com.joyodigitama.joyorogo.founder.monthly",
  yearly: "com.joyodigitama.joyorogo.founder.yearly",
} as const;

export const APPLE_SUBSCRIPTIONS_URL = "https://apps.apple.com/account/subscriptions";

/**
 * StoreKit appAccountToken for a user: SHA-256("joyorogo-apple:<userId>"), first
 * 16 bytes, UUID version 5 + RFC 4122 variant. Must match appleAccountToken in
 * packages/api/src/lib/apple.ts: the server rejects a transaction whose token
 * belongs to another account.
 */
async function appleAccountToken(userId: string): Promise<string> {
  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    new TextEncoder().encode(`joyorogo-apple:${userId}`),
  );
  const bytes = new Uint8Array(digest).slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The server will never credit this transaction (bad JWS, sandbox account
 * not allowlisted, or a subscription linked to another account), so the
 * caller must finish it instead of replaying forever.
 */
class AppleRejectedError extends Error {}

/** Sends the StoreKit JWS for crediting; the server is idempotent per transaction. */
async function postAppleJws(signedTransaction: string): Promise<void> {
  const res = await fetch(`${serverUrl()}/api/billing/apple`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await checkoutHeaders()) },
    body: JSON.stringify({ signedTransaction }),
  });
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (res.status === 401) throw new Error(i18n.t("billing:error.signIn"));
  if (res.status === 400 || res.status === 403) {
    throw new AppleRejectedError(body?.error ?? i18n.t("billing:error.receiptInvalid"));
  }
  if (!res.ok) throw new Error(body?.error ?? i18n.t("billing:error.purchaseFailed"));
}

/**
 * Subscribes to a Founder plan through StoreKit with the account's
 * appAccountToken, credits it on the server, and only then finishes the
 * transaction. A transient failure before the server confirms leaves the
 * transaction unfinished, so the next mount replays it; a definitive
 * rejection finishes it immediately. Renewals arrive later through App Store
 * Server Notifications and the launch entitlement sync.
 */
export function useAppleFounderPurchase() {
  return useMutation({
    mutationFn: async (plan: "monthly" | "yearly") => {
      if (!appleIap) throw new Error(i18n.t("billing:error.appleUnavailable"));
      const userId = (await authClient.getSession()).data?.user.id;
      if (!userId) throw new Error(i18n.t("billing:error.signIn"));
      const result = await appleIap.purchase(
        FOUNDER_PRODUCT_IDS[plan],
        await appleAccountToken(userId),
      );
      if (result.status === "cancelled") return "cancelled";
      if (result.status === "pending") {
        throw new Error(i18n.t("billing:error.applePending"));
      }
      try {
        await postAppleJws(result.signedTransaction);
      } catch (error) {
        if (error instanceof AppleRejectedError) await appleIap.finish(result.transactionId);
        throw error;
      }
      await appleIap.finish(result.transactionId);
      return "bought";
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

/**
 * Posts every active subscription this Apple ID holds (StoreKit
 * currentEntitlements). `sync` first asks the App Store to refresh, for the
 * explicit restore. Returns how many were accepted; rejected ones (linked to
 * another JoyoRogo account) are counted separately.
 */
async function syncAppleEntitlements(sync: boolean) {
  const summary = { accepted: 0, rejected: 0 };
  if (!appleIap) return summary;
  for (const item of await appleIap.currentEntitlements(sync)) {
    try {
      await postAppleJws(item.signedTransaction);
      summary.accepted++;
    } catch (error) {
      if (!(error instanceof AppleRejectedError)) throw error;
      summary.rejected++;
    }
  }
  return summary;
}

/** "Pulihkan pembelian" (required by Apple): re-reads this Apple ID's subscriptions and credits them. */
export function useAppleRestore() {
  return useMutation({
    mutationFn: () => syncAppleEntitlements(true),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

/** Opens Apple's subscription management ("Kelola langganan"). */
export async function openManageSubscriptions(): Promise<void> {
  if (appleIap && (await appleIap.showManageSubscriptions().catch(() => false))) return;
  await Linking.openURL(APPLE_SUBSCRIPTIONS_URL);
}

/** StoreKit products for both plans; a plan is null while its product is unavailable. */
export function useAppleFounderPrice(enabled: boolean) {
  return useQuery({
    queryKey: ["apple-founder-products"],
    queryFn: async () => {
      const [monthly, yearly] = await Promise.all([
        appleIap?.getProduct(FOUNDER_PRODUCT_IDS.monthly),
        appleIap?.getProduct(FOUNDER_PRODUCT_IDS.yearly),
      ]);
      return { monthly: monthly ?? null, yearly: yearly ?? null };
    },
    enabled,
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });
}

/**
 * Purchases interrupted before the server confirmed are still unfinished in
 * StoreKit; replaying them on mount credits the user and finishes them.
 * Definitive rejections are finished too; other failures stay unfinished and
 * retry on the next mount. Already-credited transactions are skipped by the
 * server (once per id).
 */
/** Also syncs current entitlements so a renewal made while closed is credited at launch. */
function useUnfinishedReplay(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !appleIap) return;
    let cancelled = false;
    void (async () => {
      const items = await appleIap.unfinished();
      for (const item of items) {
        if (cancelled) return;
        try {
          await postAppleJws(item.signedTransaction);
          queryClient.invalidateQueries();
        } catch (error) {
          if (!(error instanceof AppleRejectedError)) return;
        }
        await appleIap.finish(item.transactionId);
      }
      // Renewals while the app was closed: current entitlements carry the new period.
      if (cancelled) return;
      const summary = await syncAppleEntitlements(false);
      if (summary.accepted > 0) queryClient.invalidateQueries();
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);
}

/** Play Billing exists only in the Play build on Android; its module loads lazily. */
export const PLAY_ACTIVE = IS_PLAY_BUILD && Platform.OS === "android";

function playBilling(): typeof PlayBilling {
  return require("@/src/lib/play-billing") as typeof PlayBilling;
}

/** The server will never credit this token (not ours, wrong product, or another account's). */
class PlayRejectedError extends Error {}

type PlayVerdict = "granted" | "already" | "pending" | "inactive";

/** Sends a Play purchase token for verification; the server is idempotent per Play order. */
async function postPlayPurchase(purchaseToken: string): Promise<PlayVerdict> {
  const res = await fetch(`${serverUrl()}/api/billing/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await checkoutHeaders()) },
    body: JSON.stringify({ purchaseToken }),
  });
  const body = (await res.json().catch(() => null)) as {
    status?: PlayVerdict;
    error?: string;
  } | null;
  if (res.status === 401) throw new Error(i18n.t("billing:error.signIn"));
  if (res.status === 400 || res.status === 409) {
    throw new PlayRejectedError(body?.error ?? i18n.t("billing:error.receiptInvalid"));
  }
  if (!res.ok || !body?.status) {
    throw new Error(body?.error ?? i18n.t("billing:error.purchaseFailed"));
  }
  return body.status;
}

export type PlayBuyResult = "bought" | "pending" | "cancelled";

/**
 * Buys JoyoRogo Pro through Google Play Billing. The server verifies the
 * purchase token with Google and acknowledges it only after crediting; a
 * transient failure leaves the purchase unacknowledged, and the next
 * mount's replay (usePlayReplay) credits it.
 */
export function usePlayPurchase() {
  return useMutation({
    mutationFn: async (plan: CheckoutPlan): Promise<PlayBuyResult> => {
      const play = playBilling();
      const userId = (await authClient.getSession()).data?.user.id;
      if (!userId) throw new Error(i18n.t("billing:error.signIn"));
      let outcome: PlayBilling.PlayPurchaseOutcome;
      try {
        outcome = await play.buyPlan(plan, userId);
      } catch (error) {
        if (error instanceof play.AlreadySubscribedError) {
          throw new Error(i18n.t("billing:error.playAlready"));
        }
        throw error;
      }
      if (outcome.status === "cancelled") return "cancelled";
      if (outcome.status === "pending") {
        // Not charged yet (e.g. convenience store). Linking the token now lets
        // the server credit it the moment Google reports the payment.
        if (outcome.purchaseToken) await postPlayPurchase(outcome.purchaseToken).catch(() => null);
        return "pending";
      }
      const verdict = await postPlayPurchase(outcome.purchaseToken);
      if (verdict === "pending") return "pending";
      if (verdict === "inactive") {
        throw new Error(i18n.t("billing:error.playInactive"));
      }
      return "bought";
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

/** Localized Play prices for each plan; empty while Play has no `pro` subscription for this user. */
export function usePlayPrices(enabled: boolean) {
  return useQuery({
    queryKey: ["play-plans"],
    queryFn: () => playBilling().loadPlans(),
    enabled: enabled && PLAY_ACTIVE,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
}

export type PlaySyncSummary = {
  /** Newly credited by this sync. */
  granted: number;
  /** Credited earlier, still active. */
  already: number;
  /** Waiting for the buyer's payment. */
  pending: number;
  /** Linked to another JoyoRogo account (or not valid); message of the first one. */
  rejected: string | null;
};

/** Posts every subscription this Google account holds to the server (restore + replay). */
async function syncPlayPurchases(): Promise<PlaySyncSummary> {
  const summary: PlaySyncSummary = { granted: 0, already: 0, pending: 0, rejected: null };
  for (const owned of await playBilling().ownedPurchases()) {
    try {
      const verdict = await postPlayPurchase(owned.purchaseToken);
      if (verdict === "granted") summary.granted++;
      else if (verdict === "already") summary.already++;
      else if (verdict === "pending") summary.pending++;
    } catch (error) {
      if (!(error instanceof PlayRejectedError)) throw error;
      summary.rejected ??= error.message;
    }
  }
  return summary;
}

/** "Pulihkan pembelian": re-reads Play's purchases for this Google account and credits them. */
export function usePlayRestore() {
  return useMutation({
    mutationFn: syncPlayPurchases,
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

/**
 * Purchases Play holds that the server has not confirmed yet (app killed
 * before the credit, a pending payment that completed, an unacknowledged
 * renewal) are replayed on mount. Failures are silent: the next mount retries.
 */
export function usePlayReplay(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !PLAY_ACTIVE) return;
    let cancelled = false;
    void syncPlayPurchases()
      .then((summary) => {
        if (!cancelled && summary.granted > 0) queryClient.invalidateQueries();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);
}

/**
 * The web profil banners (profil.tsx): free-tier scan quota + Upgrade when
 * billing is on, and founder expiry + Perpanjang. Upgrade opens the paywall
 * screen (/founder) so users see the "Cara bayar" steps first; Perpanjang
 * starts checkout directly because founders never see that screen. Android
 * starts a DOKU checkout; iOS buys through Apple in-app purchase instead; the
 * Play build buys the JoyoRogo Pro subscription through Google Play Billing.
 */
export function FounderCards({
  tier,
  founderUntil,
}: {
  tier: "free" | "founder";
  founderUntil: string | Date | null;
}) {
  const { t } = useTranslation("billing");
  const config = useAppConfig();
  const ios = Platform.OS === "ios";
  const checkout = useCheckoutPicker();
  const purchase = useAppleFounderPurchase();
  const playBuy = usePlayPurchase();
  const playRestore = usePlayRestore();
  const gatewayBilling = config.data?.billing === true;
  const appleBilling = config.data?.appleBilling === true;
  const billing = ios ? appleBilling : gatewayBilling;
  const price = useAppleFounderPrice(ios && appleBilling);
  useUnfinishedReplay(ios && appleBilling);
  usePlayReplay(PLAY_ACTIVE && billing);
  const playPrices = usePlayPrices(PLAY_ACTIVE && billing);
  const pendingOrder = usePendingOrder(tier === "free" && billing && !PLAY_ACTIVE).data ?? null;
  const toast = useToast();
  const [checking, setChecking] = useState(false);

  const checkPending = async () => {
    if (!pendingOrder || checking) return;
    setChecking(true);
    try {
      const order = await checkOrderPaid(pendingOrder);
      if (order.status === "paid") {
        queryClient.invalidateQueries();
        toast.success(t("toast.paidTitle"), t("toast.paidBody"));
      } else {
        toast.info(t("toast.notPaidTitle"), t("toast.notPaidBody"));
      }
    } catch (e) {
      toast.error(t("toast.checkFailed"), errorMessage(e));
    } finally {
      setChecking(false);
    }
  };

  // While the config loads, render no pricing at all rather than guessing.
  if (!config.data) return null;

  const onPlayBought = (result: PlayBuyResult) => {
    if (result === "bought") toast.success(t("toast.subscribedTitle"), t("toast.subscribedBody"));
    else if (result === "pending") {
      toast.info(t("toast.waitingTitle"), t("toast.waitingPlay"));
    }
  };
  const restorePlay = () =>
    playRestore.mutate(undefined, {
      onSuccess: (summary) => {
        if (summary.granted + summary.already > 0) {
          toast.success(t("toast.restoredTitle"), t("toast.restoredBody"));
        } else if (summary.pending > 0) {
          toast.info(t("toast.waitingTitle"), t("toast.waitingGeneric"));
        } else if (summary.rejected) {
          toast.error(t("toast.restoreRejectedTitle"), summary.rejected);
        } else {
          toast.info(t("toast.noSubscriptionTitle"), t("toast.noSubscriptionPlay"));
        }
      },
      onError: (e) => toast.error(t("toast.restoreFailed"), errorMessage(e)),
    });
  const buy = () => {
    if (ios) purchase.mutate("monthly");
    else if (PLAY_ACTIVE) playBuy.mutate("monthly", { onSuccess: onPlayBought });
    else checkout.start();
  };
  const buying = ios ? purchase.isPending : PLAY_ACTIVE ? playBuy.isPending : checkout.isPending;
  const failure = ios
    ? purchase.isError
      ? purchase.error.message
      : null
    : PLAY_ACTIVE
      ? playBuy.isError
        ? playBuy.error.message
        : null
      : (checkout.error?.message ?? null);

  return (
    <>
      {tier === "free" && billing ? (
        <>
          <Card style={styles.upgradeCard}>
            <View style={styles.cardText}>
              {config.data.freeDailyScans !== null ? (
                <Text style={styles.upgradeTitle}>
                  {t("cards.freeScans", { count: config.data.freeDailyScans })}
                </Text>
              ) : null}
              <Text style={styles.cardNote}>
                {config.data.founderDailyCap === null
                  ? t("cards.proUnlimited")
                  : t("cards.proCapped", { count: config.data.founderDailyCap })}
              </Text>
              {ios && price.data?.monthly?.displayPrice ? (
                <Text style={styles.cardNote}>
                  {t("cards.applePrice", { price: price.data.monthly.displayPrice })}
                </Text>
              ) : null}
              {PLAY_ACTIVE && playPrices.data?.monthly ? (
                <Text style={styles.cardNote}>
                  {t("cards.playPrice", { price: playPrices.data.monthly.displayPrice })}
                </Text>
              ) : null}
            </View>
            <Button
              size="sm"
              label={t("cards.upgrade")}
              onPress={() =>
                router.push({ pathname: "/founder", params: { from: "profile", next: "/profil" } })
              }
            />
          </Card>
          {pendingOrder ? (
            <Button
              variant="secondary"
              size="sm"
              label={t("cards.checkPending")}
              loading={checking}
              onPress={() => void checkPending()}
            />
          ) : null}
          {PLAY_ACTIVE ? (
            <Button
              variant="secondary"
              size="sm"
              label={t("cards.restore")}
              loading={playRestore.isPending}
              onPress={restorePlay}
            />
          ) : null}
        </>
      ) : null}
      {tier === "founder" && founderUntil ? (
        <Card style={styles.founderCard}>
          <View style={styles.cardText}>
            <Text style={styles.founderTitle}>{t("cards.activeTitle")}</Text>
            <Text style={styles.cardNote}>
              {t(`cards.activeUntil.${PLAY_ACTIVE ? "play" : ios ? "apple" : "web"}`, {
                date: fmtFounderDate(founderUntil),
              })}
            </Text>
          </View>
          {ios ? (
            <Button
              size="sm"
              variant="secondary"
              label={t("cards.manage")}
              onPress={() => void openManageSubscriptions()}
            />
          ) : billing ? (
            <Button
              size="sm"
              variant="secondary"
              label={t("cards.renew")}
              onPress={buy}
              loading={buying}
            />
          ) : null}
        </Card>
      ) : null}
      {!ios && !PLAY_ACTIVE && billing ? checkout.sheet : null}
      {failure ? <Text style={styles.error}>{failure}</Text> : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  upgradeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    backgroundColor: theme.colors.makanSoft,
  },
  founderCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  cardText: {
    flex: 1,
    gap: 2,
  },
  upgradeTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.makanText,
  },
  founderTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  cardNote: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 19,
  },
  methodHint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    marginBottom: theme.spacing.xs,
  },
  methodOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    minHeight: 80,
    padding: theme.spacing.md,
    borderRadius: theme.radius.tile,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.background,
  },
  methodIcon: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.input,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.makanSoft,
  },
  methodLabel: {
    fontSize: theme.fontSize.lg,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  promoCard: {
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.makanSoft,
  },
  promoHeadline: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    lineHeight: 19,
    color: theme.colors.makanText,
  },
  promoText: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.makanText,
  },
  promoBold: {
    fontWeight: "800",
  },
  promoTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.muted,
    overflow: "hidden",
  },
  promoFill: {
    height: "100%",
    borderRadius: 3,
    backgroundColor: theme.colors.primary,
  },
  promoNote: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.makanText,
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
}));
