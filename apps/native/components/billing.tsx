import { useMutation, useQuery } from "@tanstack/react-query";
import { Platform, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { StyleSheet } from "react-native-unistyles";

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

/**
 * The web profil banners (profil.tsx): free-tier scan quota + Upgrade when
 * billing is on, and founder expiry + Perpanjang. Both start the same
 * checkout the web's useFounderCheckout runs.
 */
export function FounderCards({
  tier,
  founderUntil,
}: {
  tier: "free" | "founder";
  founderUntil: string | Date | null;
}) {
  const config = useAppConfig();
  const checkout = useFounderCheckout();
  const billing = config.data?.billing === true;

  // While the config loads, render no pricing at all rather than guessing.
  if (!config.data) return null;

  return (
    <>
      {tier === "free" && billing ? (
        <Card style={styles.upgradeCard}>
          <View style={styles.cardText}>
            <Text style={styles.upgradeTitle}>
              Scan AI {config.data.freeDailyScans} kali sehari
            </Text>
            <Text style={styles.cardNote}>Founder buka scan tanpa batas.</Text>
          </View>
          <Button
            size="sm"
            label="Upgrade"
            onPress={() => checkout.mutate()}
            loading={checkout.isPending}
          />
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
              onPress={() => checkout.mutate()}
              loading={checkout.isPending}
            />
          ) : null}
        </Card>
      ) : null}
      {checkout.isError ? <Text style={styles.error}>{checkout.error.message}</Text> : null}
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
