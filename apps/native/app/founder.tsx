import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import type { Href } from "expo-router";
import { useEffect } from "react";
import { Alert, AppState, Platform, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import {
  BootLoader,
  Button,
  Card,
  PageHeader,
  Screen,
  Text,
} from "@/components/ui";
import {
  useAppleFounderPrice,
  useAppleFounderPurchase,
  useAppConfig,
  useFounderCheckout,
} from "@/components/billing";
import { useSessionGate } from "@/lib/use-session-gate";
import { errorMessage } from "@/utils/format";
import { orpc } from "@/utils/orpc";

/** Why the paywall opened; picks the subhead and nothing else. */
type PaywallFrom = "onboarding" | "quota" | "banner" | "profile";

export default function FounderPaywall() {
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const { next, from } = useLocalSearchParams<{ next?: string; from?: PaywallFrom }>();
  // Callers only pass internal routes here ("/", "/makan", "/profil").
  const destination = (
    typeof next === "string" && next !== "" ? next : "/"
  ) as Href;
  const profileQuery = useQuery(orpc.profile.myProfile.queryOptions());
  const config = useAppConfig();
  const ios = Platform.OS === "ios";
  const purchase = useAppleFounderPurchase();
  const checkout = useFounderCheckout();
  const appleBilling = config.data?.appleBilling === true;
  const billing = ios ? appleBilling : config.data?.billing === true;
  const price = useAppleFounderPrice(ios && appleBilling);
  const tier = profileQuery.data?.tier ?? null;

  // Android: coming back from the DOKU browser is when payment lands; refetch
  // the profile so this screen continues on its own after paying.
  const refetchProfile = profileQuery.refetch;
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refetchProfile();
    });
    return () => sub.remove();
  }, [refetchProfile]);

  // Only sellable when billing is on and the user is not Founder yet. Anything
  // else (billing off, already Founder, config/profile unreadable) continues
  // straight to the destination instead of flashing the paywall.
  useEffect(() => {
    if (config.isPending || profileQuery.isPending) return;
    if (!config.isSuccess || !profileQuery.isSuccess || !billing || tier === "founder") {
      router.replace(destination);
    }
  }, [config, profileQuery, billing, tier, destination]);

  if (gate === "loading" || config.isPending || profileQuery.isPending) {
    return <BootLoader />;
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }
  if (!config.data || !billing || tier === "founder") {
    // The replace above is in flight; show nothing flashable meanwhile.
    return <BootLoader />;
  }

  const buy = async () => {
    try {
      if (ios) await purchase.mutateAsync();
      else await checkout.mutateAsync();
    } catch (e) {
      Alert.alert("Pembayaran gagal", errorMessage(e));
    }
  };
  const buying = ios ? purchase.isPending : checkout.isPending;

  const capText =
    config.data.founderDailyCap === null
      ? "Scan AI tanpa batas"
      : `${config.data.founderDailyCap} scan AI per hari`;
  const priceLabel =
    ios && price.data?.displayPrice
      ? price.data.displayPrice
      : `Rp${config.data.founderPriceIdr.toLocaleString("id-ID")}`;
  const subhead =
    from === "onboarding"
      ? "Rencana harianmu sudah siap. Founder buka scan AI lebih banyak setiap hari."
      : from === "quota"
        ? "Jatah scan AI gratis hari ini sudah habis."
        : "Scan AI lebih banyak setiap hari, dan dukung JoyoRogo sekalian.";
  const paySteps =
    ios && appleBilling
      ? [
          'Ketuk tombol "Jadi Founder".',
          "Bayar lewat App Store.",
          "Founder aktif otomatis setelah pembayaran.",
        ]
      : [
          'Ketuk tombol "Jadi Founder".',
          "Pilih QRIS, transfer bank (VA), atau e-wallet, lalu bayar.",
          "Founder aktif otomatis setelah pembayaran.",
        ];

  return (
    <Screen>
      <PageHeader title="Jadi Founder" caption={subhead} />

      <Card style={styles.priceCard}>
        <View style={styles.priceRow}>
          <Text style={styles.price}>{priceLabel}</Text>
          <Text style={styles.pricePer}>/bulan</Text>
        </View>
        <Text style={styles.priceNote}>Tidak diperpanjang otomatis.</Text>
      </Card>

      <Card>
        {[
          capText,
          "Lencana Founder di profilmu",
          "Dukung pengembangan JoyoRogo",
        ].map((benefit) => (
          <View key={benefit} style={styles.benefitRow}>
            <Ionicons name="checkmark-circle" size={18} color={theme.colors.primary} />
            <Text style={styles.benefitText}>{benefit}</Text>
          </View>
        ))}
        {config.data.freeDailyScans !== null ? (
          <Text style={styles.freeNote}>
            Gratis tetap ada: {config.data.freeDailyScans} scan AI per hari.
          </Text>
        ) : null}
      </Card>

      <Card>
        <Text style={styles.howTitle}>Cara bayar</Text>
        {paySteps.map((step, index) => (
          <View key={step} style={styles.stepRow}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>{index + 1}</Text>
            </View>
            <Text style={styles.stepText}>{step}</Text>
          </View>
        ))}
      </Card>

      <View style={styles.actions}>
        <Button label="Jadi Founder" onPress={() => void buy()} loading={buying} />
        <Button
          variant="secondary"
          label="Nanti saja"
          onPress={() => router.replace(destination)}
        />
        <Text style={styles.skipHint}>Kamu bisa jadi Founder kapan saja dari Profil.</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  priceCard: {
    gap: 4,
    backgroundColor: theme.colors.makanSoft,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  price: {
    fontSize: theme.fontSize.hero,
    fontWeight: "800",
    letterSpacing: -1.5,
    color: theme.colors.makanText,
  },
  pricePer: {
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    color: theme.colors.makanText,
  },
  priceNote: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.makanText,
  },
  benefitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingVertical: 6,
  },
  benefitText: {
    flex: 1,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  freeNote: {
    marginTop: theme.spacing.sm,
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 19,
  },
  howTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
    marginBottom: theme.spacing.sm,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.sm,
    paddingVertical: 6,
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.muted,
  },
  stepNumberText: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  stepText: {
    flex: 1,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
    lineHeight: 22,
  },
  actions: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  skipHint: {
    textAlign: "center",
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
}));
