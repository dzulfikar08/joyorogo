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
import { PRIORITY_SUPPORT, proBenefitItems } from "@joyorogo/i18n";
import type { ProBenefit } from "@joyorogo/i18n";

import {
  BootLoader,
  Button,
  Card,
  PageHeader,
  Screen,
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
import { errorMessage, fmtIdr } from "@/utils/format";
import { PressableScale, useEnter } from "@/components/motion";
import { benefitOrder, paywallMoment } from "@/src/lib/pro-nudge";
import { privacyUrl, termsUrl } from "@/src/lib/legal-url";
import { formatStorePrice, yearlySaving, type StorePrice } from "@/src/lib/pro-plans";
import { orpc } from "@/utils/orpc";

/** BCP-47 tags for Intl, by the app languages. */
const INTL_TAG = { id: "id-ID", en: "en-US", ms: "ms-MY" } as const;

const SITE_URL = "https://joyorogo.com";
const APPLE_TERMS_URL = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";

const idrPrice = (idr: number): StorePrice => ({ micros: idr * 1_000_000, currency: "IDR" });

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

/**
 * One plan as a selectable row: radio mark (state is never colour alone), name, price and period, and for the
 * yearly plan the per-month price and the saving against twelve monthly payments.
 */
function PlanOption({
  selected,
  onSelect,
  title,
  price,
  per,
  note,
  badge,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  price: string;
  per: string;
  note: string | null;
  badge: string | null;
}) {
  const { theme } = useUnistyles();
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}, ${price} ${per}`}
      onPress={onSelect}
      scaleTo={0.98}
      style={[styles.plan, selected ? styles.planSelected : null]}
    >
      <Ionicons
        name={selected ? "radio-button-on" : "radio-button-off"}
        size={22}
        color={selected ? theme.colors.primary : theme.colors.mutedForeground}
      />
      <View style={styles.planText}>
        <View style={styles.planTitleRow}>
          <Text style={styles.planTitle}>{title}</Text>
          {badge ? (
            <View style={styles.saveBadge}>
              <Text style={styles.saveBadgeText}>{badge}</Text>
            </View>
          ) : null}
        </View>
        {note ? <Text style={styles.planNote}>{note}</Text> : null}
      </View>
      <View style={styles.planPrice}>
        <Text style={styles.planAmount}>{price}</Text>
        <Text style={styles.planPer}>{per}</Text>
      </View>
    </PressableScale>
  );
}

export default function FounderPaywall() {
  const { t, i18n } = useTranslation("billing");
  const gate = useSessionGate();
  const toast = useToast();
  const { next, from, days } = useLocalSearchParams<{ next?: string; from?: string; days?: string }>();
  // Callers only pass internal routes here ("/", "/makan", "/profil").
  const hasNext = typeof next === "string" && next !== "";
  const destination = (hasNext ? next : "/") as Href;
  const moment = paywallMoment(from);
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

  // The one way out: back to where the person came from, or on to the screen the caller named.
  const dismiss = () => {
    if (!hasNext && router.canGoBack()) router.back();
    else router.replace(destination);
  };
  const buy = async () => {
    if (PLAY_ACTIVE) {
      try {
        const result = await playBuy.mutateAsync(plan);
        if (result === "bought") toast.success(t("toast.subscribedTitle"), t("toast.subscribedBody"));
        else if (result === "pending") toast.info(t("toast.waitingTitle"), t("toast.waitingPlay"));
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
  const restorePlay = async () => {
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

  const cfg = config.data;
  const freeScans = cfg.freeDailyScans ?? 0;
  const yearly = plan === "yearly";
  const localeTag = INTL_TAG[i18n.language as keyof typeof INTL_TAG] ?? INTL_TAG.id;

  // What each store charges is its own localized price; the web price is the server's. Never show the web price for a store.
  const play = playPrices.data;
  const apple = price.data;
  const priceOf = (which: CheckoutPlan): string => {
    if (PLAY_ACTIVE) return play?.[which]?.displayPrice ?? "...";
    if (ios && apple?.[which]?.displayPrice) return apple[which].displayPrice;
    return fmtIdr(which === "yearly" ? cfg.founderYearlyPriceIdr : cfg.founderPriceIdr);
  };
  // The saving is worked out from the same amounts the buyer is charged. Apple reports no currency code, so only the
  // percentage (currency-free) is claimed there, never a per-month figure.
  const appleAmount = (which: CheckoutPlan): StorePrice | null => {
    const value = Number(apple?.[which]?.price);
    return Number.isFinite(value) && value > 0 ? { micros: value * 1_000_000, currency: "STORE" } : null;
  };
  const saving = PLAY_ACTIVE
    ? yearlySaving(play?.monthly?.price, play?.yearly?.price)
    : ios
      ? yearlySaving(appleAmount("monthly"), appleAmount("yearly"))
      : yearlySaving(idrPrice(cfg.founderPriceIdr), idrPrice(cfg.founderYearlyPriceIdr));
  const perMonth = saving && !ios ? formatStorePrice(saving.perMonth, localeTag) : null;

  // Play needs the offer for the chosen plan: without it Play has nothing to sell.
  const playUnavailable = PLAY_ACTIVE && playPrices.isSuccess && !play?.[plan]?.displayPrice;
  const playLoading = PLAY_ACTIVE && playPrices.isPending;
  const renewalNote = PLAY_ACTIVE
    ? t("renewal.play")
    : ios
      ? t("renewal.apple")
      : t("paywall.noAutoRenew");
  const renewalDetail = PLAY_ACTIVE
    ? t(yearly ? "details.renewal.playYearly" : "details.renewal.playMonthly")
    : ios
      ? t(yearly ? "details.renewal.appleYearly" : "details.renewal.appleMonthly", {
          price: priceOf(plan),
        })
      : null;
  const paySteps = PLAY_ACTIVE || (ios && appleBilling)
    ? [
        t("details.step.store.one"),
        t(PLAY_ACTIVE ? "details.step.store.playTwo" : "details.step.store.appleTwo"),
        t("details.step.done"),
      ]
    : [t("details.step.web.one"), t("details.step.web.two"), t("details.step.done")];

  const benefitText = (item: ProBenefit): string => {
    if (item === "scans") {
      return cfg.founderDailyCap === null
        ? t("benefits.scansUnlimited")
        : t("benefits.scansCapped", { count: cfg.founderDailyCap });
    }
    if (item === "support") return t("pro.items.support", { count: PRIORITY_SUPPORT.replyWorkdays });
    return t(`pro.items.${item}`);
  };
  const chargeLine = `${t(yearly ? "plan.chargeYearly" : "plan.chargeMonthly", { price: priceOf(plan) })} ${renewalNote}`;
  const legalTerms = ios ? APPLE_TERMS_URL : PLAY_ACTIVE ? termsUrl(SITE_URL, i18n.language) : null;

  return (
    <Screen
      footer={
        <View style={styles.footer}>
          <Text style={styles.chargeLine}>{chargeLine}</Text>
          <Button
            label={PLAY_ACTIVE || ios ? t("paywall.buyStore") : t("paywall.buy")}
            onPress={() => void buy()}
            loading={buying}
            disabled={playUnavailable || playLoading}
          />
          {playUnavailable ? <Text style={styles.skipHint}>{t("paywall.playUnavailable")}</Text> : null}
          <View style={styles.footerRow}>
            {PLAY_ACTIVE || ios ? (
              <Button
                variant="ghost"
                size="sm"
                label={t("cards.restore")}
                onPress={() => void (PLAY_ACTIVE ? restorePlay() : restoreApple())}
                loading={PLAY_ACTIVE ? playRestore.isPending : appleRestore.isPending}
              />
            ) : null}
            <Button variant="ghost" size="sm" label={t("paywall.later")} onPress={dismiss} />
          </View>
        </View>
      }
    >
      <Animated.View entering={heroEnter}>
        <PageHeader
          title={t("paywall.title")}
          back={false}
          caption={t(`paywall.subhead.${moment}`, { days: Number(days) > 0 ? Number(days) : "" })}
        />
      </Animated.View>

      {!ios && <FounderPromoCard />}

      <Animated.View entering={priceEnter} style={styles.plans} accessibilityRole="radiogroup">
        <PlanOption
          selected={yearly}
          onSelect={() => setPlan("yearly")}
          title={t("plan.yearly")}
          price={priceOf("yearly")}
          per={t("plan.perYear")}
          note={perMonth ? t("plan.equivalent", { price: perMonth }) : null}
          badge={saving ? t("plan.savePercent", { percent: saving.percent }) : null}
        />
        <PlanOption
          selected={!yearly}
          onSelect={() => setPlan("monthly")}
          title={t("plan.monthly")}
          price={priceOf("monthly")}
          per={t("plan.perMonth")}
          note={null}
          badge={null}
        />
      </Animated.View>

      <Card style={styles.benefitsCard}>
        <Text style={styles.bundle}>{t("pro.title")}</Text>
        {benefitOrder(moment).map((group, groupIndex) => (
          <View key={group} style={styles.benefitGroup}>
            <Text style={styles.groupTitle}>{t(`pro.groups.${group}`)}</Text>
            {proBenefitItems(group).map((item) => (
              <BenefitRow key={item} index={groupIndex + 2} text={benefitText(item)} />
            ))}
          </View>
        ))}
        <Text style={styles.freeNote}>{t("benefits.free", { count: freeScans })}</Text>
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
          {yearly && !PLAY_ACTIVE && !ios ? <Text style={styles.detailText}>{t("details.stacks")}</Text> : null}
          {renewalDetail ? <Text style={styles.detailText}>{renewalDetail}</Text> : null}
          <Text style={styles.detailText}>{t("details.later")}</Text>
        </Disclosure>
      </Animated.View>

      {PLAY_ACTIVE || ios ? (
        <View style={styles.legalRow}>
          {legalTerms ? (
            <Text style={styles.legalLink} accessibilityRole="link" onPress={() => void Linking.openURL(legalTerms)}>
              {t("paywall.terms")}
            </Text>
          ) : null}
          <Text style={styles.skipHint}>·</Text>
          <Text style={styles.legalLink} accessibilityRole="link" onPress={() => void Linking.openURL(privacyUrl(SITE_URL, i18n.language))}>
            {t("paywall.privacy")}
          </Text>
          {ios ? (
            <>
              <Text style={styles.skipHint}>·</Text>
              <Text
                style={styles.legalLink}
                accessibilityRole="link"
                onPress={() => void openManageSubscriptions()}
              >
                {t("cards.manage")}
              </Text>
            </>
          ) : null}
        </View>
      ) : null}
      {!ios && !PLAY_ACTIVE ? checkout.sheet : null}
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  plans: {
    gap: theme.spacing.sm,
  },
  plan: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    minHeight: 72,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.tile,
    borderWidth: 2,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.card,
  },
  planSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.makanSoft,
  },
  planText: {
    flex: 1,
    gap: 2,
  },
  planTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  planTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  planNote: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  planPrice: {
    alignItems: "flex-end",
  },
  planAmount: {
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  planPer: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  saveBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.primary,
  },
  saveBadgeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: "800",
    color: theme.colors.primaryForeground,
  },
  benefitsCard: {
    gap: 2,
  },
  bundle: {
    fontSize: theme.fontSize.md,
    fontWeight: "800",
    color: theme.colors.foreground,
    marginBottom: 4,
  },
  benefitGroup: {
    marginTop: theme.spacing.sm,
  },
  groupTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.mutedForeground,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  benefitRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.sm,
    paddingVertical: 4,
  },
  benefitText: {
    flex: 1,
    fontSize: theme.fontSize.base,
    lineHeight: 21,
    color: theme.colors.foreground,
  },
  freeNote: {
    marginTop: theme.spacing.sm,
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
  footer: {
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  chargeLine: {
    textAlign: "center",
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
    color: theme.colors.mutedForeground,
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: theme.spacing.md,
  },
  legalRow: {
    flexDirection: "row",
    flexWrap: "wrap",
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
