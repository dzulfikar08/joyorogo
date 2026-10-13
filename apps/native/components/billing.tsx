import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Platform, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { StyleSheet } from "react-native-unistyles";

import { appleIap } from "@/modules/apple-iap";
import { authClient } from "@/lib/auth-client";
import { Button, Card, Text } from "@/components/ui";
import { ENV } from "@/src/env";
import { queryClient } from "@/utils/orpc";

/** Server-decided paywall/billing settings (GET /api/config). */
export type AppConfig = {
  /** Free users have a daily scan limit. */
  paywall: boolean;
  /** Founder checkout is available (paywall + DOKU configured). */
  billing: boolean;
  /** Apple in-app purchase is available on iOS (paywall configured). */
  appleBilling: boolean;
  freeDailyScans: number | null;
  founderDailyCap: number | null;
  founderPriceIdr: number;
  anonScans: number;
};

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
 */
export function useAppConfig() {
  return useQuery({
    queryKey: ["app-config"],
    queryFn: async (): Promise<AppConfig> => {
      const res = await fetch(`${serverUrl()}/api/config`);
      if (!res.ok) throw new Error(`config ${res.status}`);
      return (await res.json()) as AppConfig;
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

/** Start a DOKU Checkout for one month of Founder, opened in the browser. */
function useFounderCheckout() {
  return useMutation({
    mutationFn: async (): Promise<string> => {
      const res = await fetch(`${serverUrl()}/api/billing/checkout`, {
        method: "POST",
        headers: await checkoutHeaders(),
      });
      const body = (await res.json().catch(() => null)) as {
        paymentUrl?: string;
        error?: string;
      } | null;
      if (res.status === 401) throw new Error("Masuk dulu untuk berlangganan.");
      if (!res.ok || !body?.paymentUrl) {
        throw new Error(body?.error ?? "Pembayaran belum bisa diproses. Coba lagi nanti.");
      }
      return body.paymentUrl;
    },
    onSuccess: async (url) => {
      await WebBrowser.openBrowserAsync(url);
      queryClient.invalidateQueries();
    },
  });
}

/** App Store Connect product for one month of Founder; server verifies the id. */
const FOUNDER_PRODUCT_ID = "com.joyodigitama.joyorogo.founder.1m";

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
function useAppleFounderPurchase() {
  return useMutation({
    mutationFn: async () => {
      if (!appleIap) throw new Error("Pembelian lewat App Store tidak tersedia.");
      const result = await appleIap.purchase(FOUNDER_PRODUCT_ID);
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

/** StoreKit price for the card copy; null while the product is unavailable. */
function useAppleFounderPrice(enabled: boolean) {
  return useQuery({
    queryKey: ["apple-founder-product"],
    queryFn: async () => (await appleIap?.getProduct(FOUNDER_PRODUCT_ID)) ?? null,
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

/**
 * The web profil banners (profil.tsx): free-tier scan quota + Upgrade when
 * billing is on, and founder expiry + Perpanjang. Android/web start a DOKU
 * checkout; iOS buys through Apple in-app purchase instead.
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
  const checkout = useFounderCheckout();
  const purchase = useAppleFounderPurchase();
  const dokuBilling = config.data?.billing === true;
  const appleBilling = config.data?.appleBilling === true;
  const billing = ios ? appleBilling : dokuBilling;
  const price = useAppleFounderPrice(ios && appleBilling);
  useUnfinishedReplay(ios && appleBilling);

  // While the config loads, render no pricing at all rather than guessing.
  if (!config.data) return null;

  const buy = () => (ios ? purchase.mutate() : checkout.mutate());
  const buying = ios ? purchase.isPending : checkout.isPending;
  const failure = ios
    ? purchase.isError
      ? purchase.error.message
      : null
    : checkout.isError
      ? checkout.error.message
      : null;

  return (
    <>
      {tier === "free" && billing ? (
        <Card style={styles.upgradeCard}>
          <View style={styles.cardText}>
            <Text style={styles.upgradeTitle}>
              Scan AI {config.data.freeDailyScans} kali sehari
            </Text>
            <Text style={styles.cardNote}>Founder buka scan tanpa batas.</Text>
            {ios && price.data?.displayPrice ? (
              <Text style={styles.cardNote}>{price.data.displayPrice} lewat App Store.</Text>
            ) : null}
          </View>
          <Button size="sm" label="Upgrade" onPress={buy} loading={buying} />
        </Card>
      ) : null}
      {tier === "founder" && founderUntil ? (
        <Card style={styles.founderCard}>
          <View style={styles.cardText}>
            <Text style={styles.founderTitle}>Founder aktif</Text>
            <Text style={styles.cardNote}>
              Sampai {fmtFounderDate(founderUntil)}. Tidak diperpanjang otomatis.
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
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
}));
