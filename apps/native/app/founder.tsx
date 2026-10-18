import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import type { Href } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppState, Linking, Platform, View } from "react-native";
import Animated from "react-native-reanimated";
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
import { Disclosure } from "@/components/disclosure";
import { useToast } from "@/components/toast";
import { useSessionGate } from "@/lib/use-session-gate";
import { isTestFlightBuild } from "@/src/lib/testflight";
import { errorMessage, fmtIdr } from "@/utils/format";
import { useEnter } from "@/components/motion";
import { orpc } from "@/utils/orpc";

/** Why the paywall opened; picks the subhead and nothing else. */
const PAYWALL_FROM = [
  "onboarding",
  "quota",
  "banner",
  "profile",
  "fitness",
  "challenge",
  "joyofit",
] as const;
type PaywallFrom = (typeof PAYWALL_FROM)[number];

/** One benefit line; the check icon staggers in with its row on first mount only. */
function BenefitRow({ index, text }: { index: number; text: string }) {
  const { theme } = useUnistyles();
  const enter = useEnter(index);
  return (
    <Animated.View entering={enter} style={styles.benefitRow}>
      <Ionicons name="checkmark-circle" size={18} color={theme.colors.primary} />
      <Text style={styles.benefitText}>{text}</Text>
    </Animated.View>
  );
}

/** TestFlight only: its purchases run in Apple's Sandbox. Plain notice, no link or action. */
function TestFlightNotice() {
  const { t } = useTranslation("billing");
  const { theme } = useUnistyles();
  return (
    <Card style={styles.noticeCard}>
      <Ionicons name="information-circle-outline" size={20} color={theme.colors.mutedForeground} />
      <Text style={styles.noticeText}>{t("testflight.notice")}</Text>
    </Card>
  );
}

export default function FounderPaywall() {
  const { t } = useTranslation("billing");
  const gate = useSessionGate();
  const toast = useToast();
  const { next, from } = useLocalSearchParams<{ next?: string; from?: string }>();
  // Callers only pass internal routes here ("/", "/makan", "/profil").
  const destination = (
    typeof next === "string" && next !== "" ? next : "/"
  ) as Href;
  const subheadFrom: PaywallFrom = PAYWALL_FROM.find((value) => value === from) ?? "banner";
  const profileQuery = useQuery(orpc.profile.myProfile.queryOptions());
  const config = useAppConfig();
  const ios = Platform.OS === "ios";
  const purchase = useAppleFounderPurchase();
  const appleRestore = useAppleRestore();
  const [plan, setPlan] = useState<CheckoutPlan>("yearly");
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
  const heroEnter = useEnter(0);
  const priceEnter = useEnter(1);
  const detailsEnter = useEnter(5);
  const actionsEnter = useEnter(6);

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
          toast.info(t("toast.waitingTitle"), t("toast.waitingPlay"));
        }
      } catch (e) {
        toast.error(t("toast.payFailed"), errorMessage(e));
      }
      return;
    }
    if (!ios) {
      checkout.start((e) => toast.error(t("toast.payFailed"), errorMessage(e)));
      return;
    }
    try {
      await purchase.mutateAsync(plan);
    } catch (e) {
      toast.error(t("toast.payFailed"), errorMessage(e));
    }
  };
  const restoreApple = async () => {
    try {
      const summary = await appleRestore.mutateAsync();
      if (summary.accepted > 0) {
        toast.success(t("toast.restoredTitle"), t("toast.restoredBody"));
      } else if (summary.rejected > 0) {
        toast.error(t("toast.restoreRejectedTitle"), t("toast.restoreRejectedApple"));
      } else {
        toast.info(t("toast.noSubscriptionTitle"), t("toast.noSubscriptionApple"));
      }
    } catch (e) {
      toast.error(t("toast.restoreFailed"), errorMessage(e));
    }
  };
  const restore = async () => {
    try {
      const summary = await playRestore.mutateAsync();
      if (summary.granted + summary.already > 0) {
        toast.success(t("toast.restoredTitle"), t("toast.restoredBody"));
      } else if (summary.pending > 0) {
        toast.info(t("toast.waitingTitle"), t("toast.waitingGeneric"));
      } else if (summary.rejected) {
        toast.error(t("toast.restoreRejectedTitle"), summary.rejected);
      } else {
        toast.info(t("toast.noSubscriptionTitle"), t("toast.noSubscriptionPlay"));
      }
    } catch (e) {
      toast.error(t("toast.restoreFailed"), errorMessage(e));
    }
  };
  const buying = PLAY_ACTIVE ? playBuy.isPending : ios ? purchase.isPending : checkout.isPending;

  const capText =
    config.data.founderDailyCap === null
      ? t("benefits.scansUnlimited")
      : t("benefits.scansCapped", { count: config.data.founderDailyCap });
  const yearly = plan === "yearly";
  const appleProduct = ios ? price.data?.[plan] : undefined;
  const standardMonthly = config.data.promo?.nextPriceIdr ?? config.data.founderPriceIdr;
  const yearlySaving = standardMonthly * 12 - config.data.founderYearlyPriceIdr;
  // Play and the App Store charge their own localized price; never show the web one for them.
  const playPrice = PLAY_ACTIVE ? playPrices.data?.[plan]?.displayPrice : undefined;
  const priceLabel = PLAY_ACTIVE
    ? (playPrice ?? "...")
    : ios && appleProduct?.displayPrice
      ? appleProduct.displayPrice
      : fmtIdr(yearly ? config.data.founderYearlyPriceIdr : config.data.founderPriceIdr);
  // Play needs the offer for the chosen plan: without it Play has nothing to sell.
  const playUnavailable = PLAY_ACTIVE && playPrices.isSuccess && !playPrice;
  const webYearly = yearly && !PLAY_ACTIVE && !ios;
  const equivalent = [
    t("plan.equivalent", { price: fmtIdr(Math.round(config.data.founderYearlyPriceIdr / 12)) }),
    yearlySaving > 0 ? t("plan.save", { amount: fmtIdr(yearlySaving) }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const renewalNote = PLAY_ACTIVE
    ? t("renewal.play")
    : ios
      ? t("renewal.apple")
      : t("paywall.noAutoRenew");
  const renewalDetail = PLAY_ACTIVE
    ? t(yearly ? "details.renewal.playYearly" : "details.renewal.playMonthly")
    : ios
      ? t(yearly ? "details.renewal.appleYearly" : "details.renewal.appleMonthly", {
          price: priceLabel,
        })
      : null;
  const paySteps = PLAY_ACTIVE || (ios && appleBilling)
    ? [
        t("details.step.store.one"),
        t(PLAY_ACTIVE ? "details.step.store.playTwo" : "details.step.store.appleTwo"),
        t("details.step.done"),
      ]
    : [t("details.step.web.one"), t("details.step.web.two"), t("details.step.done")];

  return (
    <Screen>
      <Animated.View entering={heroEnter}>
        <PageHeader title={t("paywall.title")} caption={t(`paywall.subhead.${subheadFrom}`)} />
      </Animated.View>

      {!ios && <FounderPromoCard />}

      <Animated.View entering={priceEnter}>
        <Card style={styles.priceCard}>
          <Segmented
            options={[
              { value: "yearly", label: t("plan.yearly") },
              { value: "monthly", label: t("plan.monthly") },
            ]}
            value={plan}
            onChange={setPlan}
          />
          <View style={styles.priceRow}>
            <Text style={styles.price}>{priceLabel}</Text>
            <Text style={styles.pricePer}>{yearly ? t("plan.perYear") : t("plan.perMonth")}</Text>
          </View>
          {webYearly ? <Text style={styles.priceNote}>{equivalent}</Text> : null}
          <Text style={styles.priceNote}>{renewalNote}</Text>
        </Card>
      </Animated.View>

      <Card style={styles.benefitsCard}>
        <Text style={styles.bundle}>{t("paywall.bundle")}</Text>
        {[
          capText,
          t("benefits.advice"),
          t("benefits.backup"),
          t("benefits.badge"),
          t("benefits.support"),
        ].map((benefit, index) => (
          <BenefitRow key={benefit} index={index + 2} text={benefit} />
        ))}
        {config.data.freeDailyScans !== null ? (
          <Text style={styles.freeNote}>
            {t("benefits.free", { count: config.data.freeDailyScans })}
          </Text>
        ) : null}
      </Card>

      <Animated.View entering={detailsEnter}>
        <Disclosure title={t("details.title")}>
          <Text style={styles.howTitle}>{t("details.stepsTitle")}</Text>
          {paySteps.map((step, index) => (
            <View key={step} style={styles.stepRow}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>{index + 1}</Text>
              </View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
          <Text style={styles.detailText}>{t("details.backup")}</Text>
          {webYearly ? <Text style={styles.detailText}>{t("details.stacks")}</Text> : null}
          {renewalDetail ? <Text style={styles.detailText}>{renewalDetail}</Text> : null}
          <Text style={styles.detailText}>{t("details.later")}</Text>
        </Disclosure>
      </Animated.View>

      <Animated.View entering={actionsEnter} style={styles.actions}>
        {ios && isTestFlightBuild() ? <TestFlightNotice /> : null}
        <Button
          label={PLAY_ACTIVE || ios ? t("paywall.buyStore") : t("paywall.buy")}
          onPress={() => void buy()}
          loading={buying}
          disabled={playUnavailable}
        />
        {playUnavailable ? <Text style={styles.skipHint}>{t("paywall.playUnavailable")}</Text> : null}
        {PLAY_ACTIVE ? (
          <Button
            variant="secondary"
            size="sm"
            label={t("cards.restore")}
            onPress={() => void restore()}
            loading={playRestore.isPending}
          />
        ) : null}
        {ios ? (
          <>
            <View style={styles.buttonRow}>
              <Button
                variant="secondary"
                size="sm"
                style={styles.rowButton}
                label={t("cards.restore")}
                onPress={() => void restoreApple()}
                loading={appleRestore.isPending}
              />
              <Button
                variant="secondary"
                size="sm"
                style={styles.rowButton}
                label={t("cards.manage")}
                onPress={() => void openManageSubscriptions()}
              />
            </View>
            <View style={styles.legalRow}>
              <Text
                style={styles.legalLink}
                accessibilityRole="link"
                onPress={() =>
                  void Linking.openURL("https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")
                }
              >
                {t("paywall.terms")}
              </Text>
              <Text style={styles.skipHint}>·</Text>
              <Text
                style={styles.legalLink}
                accessibilityRole="link"
                onPress={() => void Linking.openURL("https://joyorogo.com/privasi")}
              >
                {t("paywall.privacy")}
              </Text>
            </View>
          </>
        ) : null}
        {!ios && !PLAY_ACTIVE ? checkout.sheet : null}
        <Button
          variant="ghost"
          size="sm"
          label={t("paywall.later")}
          onPress={() => router.replace(destination)}
        />
      </Animated.View>
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
  benefitsCard: {
    gap: 2,
  },
  bundle: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
    marginBottom: 4,
  },
  benefitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingVertical: 3,
  },
  benefitText: {
    flex: 1,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  freeNote: {
    marginTop: theme.spacing.xs,
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 19,
  },
  howTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.mutedForeground,
    textTransform: "uppercase",
  },
  detailText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 19,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.sm,
    paddingVertical: 2,
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
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    lineHeight: 20,
  },
  actions: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  buttonRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  rowButton: {
    flex: 1,
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
  noticeCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.sm,
  },
  noticeText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 19,
  },
}));
