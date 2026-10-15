import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { appleIap } from "@/modules/apple-iap";
import { authClient } from "@/lib/auth-client";
import { Button, Card, Sheet, Text } from "@/components/ui";
import { useToast } from "@/components/toast";
import { errorMessage } from "@/utils/format";
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
  /** Yearly founder bundle: 12 months for the price of 10. */
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

/** "12 November 2026" in WIB. */
export function fmtFounderDate(value: string | Date): string {
  return new Date(value).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
}

// Better Auth Expo forwards the session cookie manually on native.
async function checkoutHeaders(): Promise<Record<string, string>> {
  if (Platform.OS === "web") return {};
  const cookies = await authClient.getCookie();
  return cookies ? { Cookie: cookies } : {};
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
  if (res.status === 401) throw new Error("Masuk dulu untuk berlangganan.");
  if (!res.ok || !body || !("status" in body)) {
    throw new Error("Pembayaran belum bisa dicek. Coba lagi nanti.");
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
      if (res.status === 401) throw new Error("Masuk dulu untuk berlangganan.");
      if (!res.ok || !body?.paymentUrl) {
        throw new Error(body?.error ?? "Pembayaran belum bisa diproses. Coba lagi nanti.");
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

const METHOD_OPTIONS: Record<
  PaymentMethod,
  { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; note: string }
> = {
  qris: {
    icon: "qr-code-outline",
    label: "QRIS",
    note: "Scan pakai e-wallet atau m-banking apa saja.",
  },
  transfer: {
    icon: "business-outline",
    label: "Transfer Bank",
    note: "Bayar lewat virtual account bank.",
  },
};

/**
 * Founder checkout behind a "QRIS atau Transfer Bank" choice (Android; iOS
 * buys through Apple). `start()` opens the picker when the server offers
 * both, otherwise goes straight to the one gateway (or the server default
 * when the config predates the picker). Render `sheet` once on the screen.
 */
export function useCheckoutPicker(plan: CheckoutPlan = "monthly") {
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
    <Sheet visible={open} onClose={() => setOpen(false)} title="Pilih cara bayar">
      <Text style={styles.methodHint}>Pro aktif otomatis setelah pembayaran masuk.</Text>
      {methods.map((method) => {
        const { icon, label, note } = METHOD_OPTIONS[method];
        return (
          <Pressable
            key={method}
            accessibilityRole="button"
            accessibilityLabel={`${label}. ${note}`}
            disabled={checkout.isPending}
            onPress={() => {
              setOpen(false);
              checkout.mutate(method, { onError: onErrorRef.current });
            }}
            style={({ pressed }) => [styles.methodOption, pressed && styles.methodPressed]}
          >
            <View style={styles.methodIcon}>
              <Ionicons name={icon} size={26} color={theme.colors.primary} />
            </View>
            <View style={styles.cardText}>
              <Text style={styles.methodLabel}>{label}</Text>
              <Text style={styles.cardNote}>{note}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.colors.mutedForeground} />
          </Pressable>
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
  const config = useAppConfig();
  const promo = config.data?.promo;
  if (!config.data || !promo || promo.slots - promo.taken <= 0) return null;
  const left = promo.slots - promo.taken;
  const nextPriceIdr = promo.nextPriceIdr ?? null;
  return (
    <Card style={styles.promoCard}>
      <Text style={styles.promoText}>
        Harga Founder (terbatas) Rp{config.data.founderPriceIdr.toLocaleString("id-ID")}
        /bulan untuk {promo.slots} pembeli pertama, sisa {left} slot
        {nextPriceIdr !== null ? `. Setelah itu Rp${nextPriceIdr.toLocaleString("id-ID")}` : ""}.
      </Text>
      <View style={styles.promoTrack}>
        <View
          style={[
            styles.promoFill,
            { width: `${Math.min(100, Math.max(0, (promo.taken / promo.slots) * 100))}%` },
          ]}
        />
      </View>
      <Text style={styles.promoNote}>
        Harga terkunci: pembeli promo Founder tetap bayar harga ini saat perpanjang.
      </Text>
    </Card>
  );
}

/** App Store Connect products for Founder (non-renewing); the server verifies the ids. */
const FOUNDER_PRODUCT_IDS = {
  monthly: "com.joyodigitama.joyorogo.founder.1m",
  yearly: "com.joyodigitama.joyorogo.founder.1y",
} as const;

/**
 * The server will never credit this transaction (bad JWS or sandbox account
 * not allowlisted), so the caller must finish it instead of replaying forever.
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
  if (res.status === 401) throw new Error("Masuk dulu untuk berlangganan.");
  if (res.status === 400) {
    throw new AppleRejectedError(body?.error ?? "Bukti pembelian tidak valid.");
  }
  if (!res.ok) throw new Error(body?.error ?? "Pembelian belum bisa diproses. Coba lagi nanti.");
}

/**
 * Buys the Founder month through StoreKit, credits it on the server, and only
 * then finishes the transaction. A transient failure before the server
 * confirms leaves the transaction unfinished, so the next mount replays it;
 * a definitive rejection finishes it immediately.
 */
export function useAppleFounderPurchase() {
  return useMutation({
    mutationFn: async (plan: "monthly" | "yearly") => {
      if (!appleIap) throw new Error("Pembelian lewat App Store tidak tersedia.");
      const result = await appleIap.purchase(FOUNDER_PRODUCT_IDS[plan]);
      if (result.status === "cancelled") return "cancelled";
      if (result.status === "pending") {
        throw new Error(
          "Pembelian menunggu persetujuan App Store. Buka lagi nanti setelah disetujui.",
        );
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
    })();
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
  if (res.status === 401) throw new Error("Masuk dulu untuk berlangganan.");
  if (res.status === 400 || res.status === 409) {
    throw new PlayRejectedError(body?.error ?? "Bukti pembelian tidak valid.");
  }
  if (!res.ok || !body?.status) {
    throw new Error(body?.error ?? "Pembelian belum bisa diproses. Coba lagi nanti.");
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
      if (!userId) throw new Error("Masuk dulu untuk berlangganan.");
      let outcome: PlayBilling.PlayPurchaseOutcome;
      try {
        outcome = await play.buyPlan(plan, userId);
      } catch (error) {
        if (error instanceof play.AlreadySubscribedError) {
          throw new Error('Kamu sudah berlangganan Pro di Google Play. Ketuk "Pulihkan pembelian".');
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
        throw new Error('Pembelian belum aktif. Coba lagi sebentar atau ketuk "Pulihkan pembelian".');
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
        toast.success("Pembayaran diterima", "Pro aktif. Terima kasih!");
      } else {
        toast.info("Belum ada pembayaran masuk", "Coba lagi sebentar.");
      }
    } catch (e) {
      toast.error("Cek pembayaran gagal", errorMessage(e));
    } finally {
      setChecking(false);
    }
  };

  // While the config loads, render no pricing at all rather than guessing.
  if (!config.data) return null;

  const onPlayBought = (result: PlayBuyResult) => {
    if (result === "bought") toast.success("Langganan aktif", "JoyoRogo Pro aktif. Terima kasih!");
    else if (result === "pending") {
      toast.info(
        "Menunggu pembayaran",
        "Pro aktif otomatis setelah pembayaran di Google Play selesai.",
      );
    }
  };
  const restorePlay = () =>
    playRestore.mutate(undefined, {
      onSuccess: (summary) => {
        if (summary.granted + summary.already > 0) {
          toast.success("Pembelian dipulihkan", "JoyoRogo Pro aktif.");
        } else if (summary.pending > 0) {
          toast.info("Menunggu pembayaran", "Pro aktif otomatis setelah pembayaran selesai.");
        } else if (summary.rejected) {
          toast.error("Tidak bisa dipulihkan", summary.rejected);
        } else {
          toast.info("Tidak ada langganan", "Akun Google Play ini belum punya langganan Pro aktif.");
        }
      },
      onError: (e) => toast.error("Pemulihan gagal", errorMessage(e)),
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
              <Text style={styles.upgradeTitle}>
                Scan AI {config.data.freeDailyScans} kali sehari
              </Text>
              <Text style={styles.cardNote}>
                {config.data.founderDailyCap === null
                  ? "Pro buka scan tanpa batas."
                  : `Pro: ${config.data.founderDailyCap} scan AI per hari.`}
              </Text>
              {ios && price.data?.monthly?.displayPrice ? (
                <Text style={styles.cardNote}>
                  {price.data.monthly.displayPrice}/bulan lewat App Store.
                </Text>
              ) : null}
              {PLAY_ACTIVE && playPrices.data?.monthly ? (
                <Text style={styles.cardNote}>
                  JoyoRogo Pro {playPrices.data.monthly.displayPrice}/bulan lewat Google Play.
                </Text>
              ) : null}
            </View>
            <Button
              size="sm"
              label="Upgrade"
              onPress={() =>
                router.push({ pathname: "/founder", params: { from: "profile", next: "/profil" } })
              }
            />
          </Card>
          {pendingOrder ? (
            <Button
              variant="secondary"
              size="sm"
              label="Sudah bayar? Cek pembayaran"
              loading={checking}
              onPress={() => void checkPending()}
            />
          ) : null}
          {PLAY_ACTIVE ? (
            <Button
              variant="secondary"
              size="sm"
              label="Pulihkan pembelian"
              loading={playRestore.isPending}
              onPress={restorePlay}
            />
          ) : null}
        </>
      ) : null}
      {tier === "founder" && founderUntil ? (
        <Card style={styles.founderCard}>
          <View style={styles.cardText}>
            <Text style={styles.founderTitle}>Pro aktif</Text>
            <Text style={styles.cardNote}>
              Sampai {fmtFounderDate(founderUntil)}.{" "}
              {PLAY_ACTIVE
                ? "Langganan Google Play dikelola dan dibatalkan di Play Store."
                : "Tidak diperpanjang otomatis."}
            </Text>
          </View>
          {billing ? (
            <Button
              size="sm"
              variant="secondary"
              label="Perpanjang"
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
  methodPressed: {
    backgroundColor: theme.colors.muted,
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
  promoText: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.makanText,
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
