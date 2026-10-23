import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Redirect } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { eatenAtClock, eatenAtFromClock, eatenAtNudge } from "@joyorogo/api/lib/eaten-at";
import type { Meal } from "@joyorogo/api/lib/engine";
import type { ItemView } from "@joyorogo/api/lib/meal/view";

import { EatenAtField } from "@/components/plate/eaten-at-field";
import { LockedView } from "@/components/meal-plan/locked-view";
import { PrefsSheet } from "@/components/meal-plan/prefs-sheet";
import { BuySheet } from "@/components/meal-plan/buy-sheet";
import { RecipeSheet } from "@/components/meal-plan/recipe-sheet";
import type { RecipeTarget } from "@/components/meal-plan/recipe-sheet";
import { RegenSheet } from "@/components/meal-plan/regen-sheet";
import { ShoppingTab } from "@/components/meal-plan/shopping-view";
import { SwapSheet } from "@/components/meal-plan/swap-sheet";
import type { SwapTarget } from "@/components/meal-plan/swap-sheet";
import { pickDay, TodayTab } from "@/components/meal-plan/today-view";
import { overviewOptions, useMealPlanMutations } from "@/components/meal-plan/use-meal-plan";
import { WeekTab } from "@/components/meal-plan/week-view";
import {
  BootLoader,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Screen,
  Segmented,
  Sheet,
  Skeleton,
  Text,
} from "@/components/ui";
import { useSessionGate } from "@/lib/use-session-gate";

type Tab = "today" | "week" | "shopping";

export default function RencanaMakan() {
  const { t } = useTranslation(["mealPlan", "common"]);
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const overview = useQuery({ ...overviewOptions(), enabled: gate === "authed" });
  const { generate, eat, undoEat } = useMealPlanMutations();

  const [tab, setTab] = useState<Tab>("today");
  const [date, setDate] = useState<string | null>(null);
  const [swapTarget, setSwapTarget] = useState<SwapTarget | null>(null);
  const [buyTarget, setBuyTarget] = useState<ItemView | null>(null);
  const [recipeTarget, setRecipeTarget] = useState<RecipeTarget | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  // Sudah makan on a slot that does not suit the clock asks "Jam makan" first.
  const [eatTarget, setEatTarget] = useState<{ date: string; slot: Meal } | null>(null);
  const [eatenAt, setEatenAt] = useState<number | null>(null);

  if (gate === "loading") return <BootLoader />;
  if (gate === "anon") return <Redirect href="/login" />;

  const header = <PageHeader title={t("title")} caption={t("subtitle")} />;

  if (overview.isPending) {
    return (
      <Screen>
        {header}
        <Text style={styles.loading} accessibilityRole="progressbar">
          {t("loading")}
        </Text>
        <Skeleton width="100%" height={52} radius={26} />
        <Skeleton width="100%" height={260} radius={24} />
        <Skeleton width="100%" height={220} radius={24} />
      </Screen>
    );
  }
  if (overview.isError) {
    return (
      <Screen>
        {header}
        <ErrorState message={t("loadError")} onRetry={() => void overview.refetch()} />
      </Screen>
    );
  }

  const data = overview.data;
  const refresh = { refreshing: overview.isRefetching, onRefresh: () => void overview.refetch() };

  if (data.status === "noProfile") {
    return (
      <Screen {...refresh}>
        {header}
        <EmptyState icon="person-circle-outline" title={t("noProfileTitle")} description={t("noProfile")} />
      </Screen>
    );
  }

  if (data.status === "locked") {
    return (
      <Screen {...refresh}>
        {header}
        <LockedView preview={data.preview} />
      </Screen>
    );
  }

  const plan = data.plan;
  if (plan === null) {
    return (
      <Screen {...refresh}>
        {header}
        <EmptyState
          pose="ready"
          title={t("empty.title")}
          description={t("empty.body")}
          action={
            <Button
              label={generate.isPending ? t("empty.working") : t("empty.cta")}
              loading={generate.isPending}
              onPress={() => generate.mutate({ regenerate: false })}
            />
          }
        />
      </Screen>
    );
  }

  const day = pickDay(plan, date ?? data.today);
  if (!day) return null;

  const pendingEat = eat.isPending
    ? `${eat.variables.date}|${eat.variables.slot}`
    : undoEat.isPending
      ? `${undoEat.variables.date}|${undoEat.variables.slot}`
      : null;

  const toggleEaten = (itemDate: string, item: ItemView) => {
    if (pendingEat !== null) return;
    const input = { date: itemDate, slot: item.slot };
    if (item.eaten) {
      undoEat.mutate(input);
    } else if (eatenAtNudge(itemDate, item.slot) !== null) {
      setEatenAt(null);
      setEatTarget(input);
    } else {
      eat.mutate(input);
    }
  };

  const closeEat = () => {
    setEatTarget(null);
    setEatenAt(null);
  };

  const confirmEat = () => {
    if (!eatTarget) return;
    eat.mutate({
      ...eatTarget,
      // Re-based on the plan day: the time may have been picked while another day was shown.
      ...(eatenAt !== null
        ? { eatenAt: eatenAtFromClock(eatTarget.date, eatenAtClock(eatenAt)) ?? undefined }
        : {}),
    });
    closeEat();
  };

  const actions = (
    <View style={styles.actions}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("prefs.open")}
        onPress={() => setPrefsOpen(true)}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <Ionicons name="options" size={20} color={theme.colors.foreground} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("regen.confirm")}
        onPress={() => setRegenOpen(true)}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <Ionicons name="refresh" size={20} color={theme.colors.foreground} />
      </Pressable>
    </View>
  );

  return (
    <>
      <Screen {...refresh}>
        <PageHeader title={t("title")} caption={t("subtitle")} right={actions} />

        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "today", label: t("tabs.today") },
            { value: "week", label: t("tabs.week") },
            { value: "shopping", label: t("tabs.shopping") },
          ]}
        />

        {tab === "today" ? (
          <TodayTab
            plan={plan}
            day={day}
            onSelectDate={setDate}
            onSwap={(itemDate, item) => setSwapTarget({ date: itemDate, slot: item.slot })}
            onBuy={setBuyTarget}
            onOpenRecipe={(item) => {
              if (item.recipeId !== null) {
                setRecipeTarget({ id: item.recipeId, scale: item.scale, carbScale: item.carbScale });
              }
            }}
            onToggleEaten={toggleEaten}
            pendingEat={pendingEat}
          />
        ) : null}
        {tab === "week" ? (
          <WeekTab
            plan={plan}
            onOpenDay={(openDate) => {
              setDate(openDate);
              setTab("today");
            }}
          />
        ) : null}
        {tab === "shopping" ? <ShoppingTab /> : null}
      </Screen>

      <SwapSheet target={swapTarget} onClose={() => setSwapTarget(null)} />
      <BuySheet item={buyTarget} onClose={() => setBuyTarget(null)} />
      <RecipeSheet target={recipeTarget} onClose={() => setRecipeTarget(null)} />
      <PrefsSheet open={prefsOpen} prefs={data.prefs} onClose={() => setPrefsOpen(false)} />
      <RegenSheet open={regenOpen} day={day.isPast ? null : day} onClose={() => setRegenOpen(false)} />
      <Sheet
        visible={eatTarget !== null}
        onClose={closeEat}
        title={t("item.ate")}
        footer={<Button label={t("common:actions.save")} onPress={confirmEat} />}
      >
        {eatTarget ? (
          <EatenAtField date={eatTarget.date} meal={eatTarget.slot} value={eatenAt} onChange={setEatenAt} />
        ) : null}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  loading: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  action: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.card,
  },
  pressed: {
    opacity: 0.7,
  },
}));
