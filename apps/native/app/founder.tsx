import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import type { Href } from "expo-router";
import { useEffect, useState } from "react";
import { AppState, Linking, Platform, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import {
  BootLoader,
  Button,
  Card,
  PageHeader,
  Screen,
  Segmented,
  Text,
} from "@/components/ui";
import {
  FounderPromoCard,
  PLAY_ACTIVE,
  openManageSubscriptions,
  useAppleFounderPrice,
  useAppleRestore,
  useAppleFounderPurchase,
  useAppConfig,
  useCheckoutPicker,
  usePlayPrices,
  usePlayPurchase,
  usePlayReplay,
  usePlayRestore,
  type CheckoutPlan,
} from "@/components/billing";
import { useToast } from "@/components/toast";
import { useSessionGate } from "@/lib/use-session-gate";
import { errorMessage } from "@/utils/format";
import { orpc } from "@/utils/orpc";

/** Why the paywall opened; picks the subhead and nothing else. */
type PaywallFrom = "onboarding" | "quota" | "banner" | "profile" | "fitness" | "challenge" | "joyofit";

export default function FounderPaywall() {
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const toast = useToast();
  const { next, from } = useLocalSearchParams<{ next?: string; from?: PaywallFrom }>();
  // Callers only pass internal routes here ("/", "/makan", "/profil").
  const destination = (
    typeof next === "string" && next !== "" ? next : "/"
  ) as Href;
  const profileQuery = useQuery(orpc.profile.myProfile.queryOptions());
  const config = useAppConfig();
  const ios = Platform.OS === "ios";
  const purchase = useAppleFounderPurchase();
  const appleRestore = useAppleRestore();
  const [plan, setPlan] = useState<CheckoutPlan>("monthly");
  const checkout = useCheckoutPicker(ios ? "monthly" : plan);
  const appleBilling = config.data?.appleBilling === true;
  const billing = ios ? appleBilling : config.data?.billing === true;
  const price = useAppleFounderPrice(ios && appleBilling);
  // Play build: JoyoRogo Pro subscription (monthly / yearly) through Google Play.
  const playBuy = usePlayPurchase();
  const playRestore = usePlayRestore();
  const playPrices = usePlayPrices(PLAY_ACTIVE && billing);
  usePlayReplay(PLAY_ACTIVE && billing);
  const tier = profileQuery.data?.tier ?? null;

  // Android: coming back from the payment browser is when payment lands; refetch
  // the profile so this screen continues on its own after paying.
  const refetchProfile = profileQuery.refetch;
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refetchProfile();
    });
    return () => sub.remove();
  }, [refetchProfile]);

  // Only sellable when billing is on and the user is not Pro yet. Anything
  // else (billing off, already Pro, config/profile unreadable) continues
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
    if (PLAY_ACTIVE) {
      try {
        const result = await playBuy.mutateAsync(plan);
        if (result === "pending") {
          toast.info(
            "Menunggu pembayaran",
            "Pro aktif otomatis setelah pembayaran di Google Play selesai.",
          );
        }
      } catch (e) {
        toast.error("Pembayaran gagal", errorMessage(e));
      }
      return;
    }
    if (!ios) {
      checkout.start((e) => toast.error("Pembayaran gagal", errorMessage(e)));
      return;
    }
    try {
      await purchase.mutateAsync(plan);
    } catch (e) {
      toast.error("Pembayaran gagal", errorMessage(e));
    }
  };
  const restoreApple = async () => {
    try {
      const summary = await appleRestore.mutateAsync();
      if (summary.accepted > 0) {
        toast.success("Pembelian dipulihkan", "JoyoRogo Pro aktif.");
      } else if (summary.rejected > 0) {
        toast.error(
          "Tidak bisa dipulihkan",
          "Langganan ini sudah terhubung ke akun JoyoRogo lain.",
        );
      } else {
        toast.info("Tidak ada langganan", "Apple ID ini belum punya langganan Pro aktif.");
      }
    } catch (e) {
      toast.error("Pemulihan gagal", errorMessage(e));
    }
  };
  const restore = async () => {
    try {
      const summary = await playRestore.mutateAsync();
      if (summary.granted + summary.already > 0) {
        toast.success("Pembelian dipulihkan", "JoyoRogo Pro aktif.");
      } else if (summary.pending > 0) {
        toast.info("Menunggu pembayaran", "Pro aktif otomatis setelah pembayaran selesai.");
      } else if (summary.rejected) {
        toast.error("Tidak bisa dipulihkan", summary.rejected);
      } else {
        toast.info("Tidak ada langganan", "Akun Google Play ini belum punya langganan Pro aktif.");
      }
    } catch (e) {
      toast.error("Pemulihan gagal", errorMessage(e));
    }
  };
  const buying = PLAY_ACTIVE ? playBuy.isPending : ios ? purchase.isPending : checkout.isPending;

  const capText =
    config.data.founderDailyCap === null
      ? "Scan AI tanpa batas"
      : `${config.data.founderDailyCap} scan AI per hari`;
  const yearly = plan === "yearly";
  const appleProduct = ios ? price.data?.[plan] : undefined;
  // Apple's yearly product only saves 2 months if its StoreKit price is at most 10 monthly prices.
  const appleSaves =
    ios && price.data?.monthly && price.data.yearly
      ? Number(price.data.yearly.price) <= Number(price.data.monthly.price) * 10
      : false;
  // Play and the App Store charge their own localized price; never show the web one for them.
  const playPrice = PLAY_ACTIVE ? playPrices.data?.[plan]?.displayPrice : undefined;
  const priceLabel = PLAY_ACTIVE
    ? (playPrice ?? "...")
    : ios && appleProduct?.displayPrice
      ? appleProduct.displayPrice
      : `Rp${(
          yearly ? config.data.founderYearlyPriceIdr : config.data.founderPriceIdr
        ).toLocaleString("id-ID")}`;
  // Play needs the offer for the chosen plan: without it Play has nothing to sell.
  const playUnavailable = PLAY_ACTIVE && playPrices.isSuccess && !playPrice;
  const subhead =
    from === "onboarding"
      ? "Rencana harianmu sudah siap. Pro buka scan AI lebih banyak setiap hari."
      : from === "quota"
        ? "Jatah scan AI gratis hari ini sudah habis."
        : from === "fitness"
          ? "Dapat saran porsi dan menu harian dari skor JoyoFit, targetmu, dan makanan yang kamu catat."
          : from === "challenge"
            ? "Pro yang membuat tantangan grup. Kamu tetap bisa ikut tantangan temanmu gratis."
            : from === "joyofit"
              ? "Cadangan cloud JoyoFit termasuk di Pro, satu paket dengan JoyoRogo."
              : "Scan AI lebih banyak setiap hari, dan dukung JoyoRogo sekalian.";
  const paySteps = PLAY_ACTIVE
    ? [
        'Pilih Bulanan atau Tahunan, lalu ketuk "Berlangganan JoyoRogo Pro".',
        "Bayar lewat Google Play.",
        "Pro aktif otomatis setelah pembayaran.",
      ]
    : ios && appleBilling
      ? [
          'Pilih Bulanan atau Tahunan, lalu ketuk "Berlangganan JoyoRogo Pro".',
          "Bayar lewat App Store.",
          "Pro aktif otomatis setelah pembayaran.",
        ]
      : [
          'Ketuk tombol "Jadi Pro".',
          "Pilih QRIS atau Transfer Bank, lalu bayar.",
          "Pro aktif otomatis setelah pembayaran.",
        ];

  return (
    <Screen>
      <PageHeader title="Jadi Pro" caption={`${subhead} Pro mencakup JoyoRogo + JoyoFit.`} />

      {!ios && <FounderPromoCard />}

      <Card style={styles.priceCard}>
        <Segmented
          options={[
            { value: "monthly", label: "Bulanan" },
            { value: "yearly", label: "Tahunan" },
          ]}
          value={plan}
          onChange={setPlan}
        />
        {yearly && !PLAY_ACTIVE && (!ios || appleSaves) ? (
          <Text style={styles.priceNote}>Setara 10 bulan, hemat 2 bulan.</Text>
        ) : null}
        <View style={styles.priceRow}>
          <Text style={styles.price}>{priceLabel}</Text>
          <Text style={styles.pricePer}>{yearly ? "/tahun" : "/bulan"}</Text>
        </View>
        {yearly && !PLAY_ACTIVE && !ios ? (
          <Text style={styles.priceNote}>
            12 bulan aktif. Menumpuk di sisa masa Pro-mu.
          </Text>
        ) : null}
        <Text style={styles.priceNote}>
          {PLAY_ACTIVE
            ? `JoyoRogo Pro, langganan ${yearly ? "tahunan" : "bulanan"} lewat Google Play. Diperpanjang otomatis tiap ${yearly ? "tahun" : "bulan"} sampai kamu batalkan di Google Play > Langganan.`
            : ios
              ? `${priceLabel} per ${yearly ? "tahun" : "bulan"}. Diperpanjang otomatis kecuali dibatalkan minimal 24 jam sebelum periode berakhir. Kelola atau batalkan di Pengaturan > Apple ID > Langganan.`
              : "Tidak diperpanjang otomatis."}
        </Text>
      </Card>

      <Card>
        {[
          capText,
          "Saran makan dari skor JoyoFit",
          "Cadangan cloud JoyoFit: langkah, detak jantung, tidur, dan latihan dari jam",
          "Lencana Pro di profilmu",
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
        <Button
          label={PLAY_ACTIVE || ios ? "Berlangganan JoyoRogo Pro" : "Jadi Pro"}
          onPress={() => void buy()}
          loading={buying}
          disabled={playUnavailable}
        />
        {playUnavailable ? (
          <Text style={styles.skipHint}>Langganan belum tersedia di Google Play untuk akunmu.</Text>
        ) : null}
        {PLAY_ACTIVE ? (
          <Button
            variant="secondary"
            label="Pulihkan pembelian"
            onPress={() => void restore()}
            loading={playRestore.isPending}
          />
        ) : null}
        {ios ? (
          <>
            <Button
              variant="secondary"
              label="Pulihkan pembelian"
              onPress={() => void restoreApple()}
              loading={appleRestore.isPending}
            />
            <Button
              variant="secondary"
              label="Kelola langganan"
              onPress={() => void openManageSubscriptions()}
            />
            <View style={styles.legalRow}>
              <Text
                style={styles.legalLink}
                accessibilityRole="link"
                onPress={() =>
                  void Linking.openURL("https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")
                }
              >
                Syarat
              </Text>
              <Text style={styles.skipHint}>dan</Text>
              <Text
                style={styles.legalLink}
                accessibilityRole="link"
                onPress={() => void Linking.openURL("https://joyorogo.com/privasi")}
              >
                Privasi
              </Text>
            </View>
          </>
        ) : null}
        {!ios && !PLAY_ACTIVE ? checkout.sheet : null}
        <Button
          variant="secondary"
          label="Nanti saja"
          onPress={() => router.replace(destination)}
        />
        <Text style={styles.skipHint}>Kamu bisa jadi Pro kapan saja dari Profil.</Text>
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
  legalRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: theme.spacing.xs,
  },
  legalLink: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.primary,
    textDecorationLine: "underline",
  },
  skipHint: {
    textAlign: "center",
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
}));
