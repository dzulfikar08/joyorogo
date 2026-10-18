import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { effectiveRamadan, jakartaToday } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { wibMinutes } from "@joyorogo/api/lib/fasting";
import type { FoodKind } from "@joyorogo/api/lib/food-kind";
import { VERDICT_LABELS, adviseSnack, dayImpactLine } from "@joyorogo/api/lib/snack-advice";
import type { AdviceVerdict, SnackAdvice } from "@joyorogo/api/lib/snack-advice";

import { GainScanAdvice } from "@/components/gain/gain-today";
import { useGain } from "@/components/gain/use-gain";
import { useMaternal } from "@/components/maternal/use-maternal";
import { Button, Text } from "@/components/ui";
import { fmtInt, fmtKcalLabel } from "@/utils/format";
import { orpc } from "@/utils/orpc";

export type SnackAdviceState = { advice: SnackAdvice | null; impact: string | null };

/**
 * Advice for the item about to be saved. Today gets the verdict card; a past
 * day only gets a neutral "Total hari itu jadi ..." line, since "upcoming
 * meals" mean nothing there. Reads the same day.summary / fasting.today
 * queries as the rest of Makan, so it costs no extra request.
 */
export function useSnackAdvice(input: {
  date?: string;
  kcal: number;
  kind: FoodKind;
  slot: Meal;
  name?: string;
}): SnackAdviceState {
  const today = jakartaToday();
  const date = input.date ?? today;
  const isToday = date === today;
  const summary = useQuery(orpc.day.summary.queryOptions({ input: { date } }));
  const fasting = useQuery({ ...orpc.fasting.today.queryOptions({ input: {} }), enabled: isToday });
  const profile = useQuery(orpc.profile.myProfile.queryOptions());
  const targets = summary.data?.targets;
  if (!summary.data || !targets || !(input.kcal > 0)) return { advice: null, impact: null };
  if (!isToday) {
    return {
      advice: null,
      impact: dayImpactLine(summary.data.eatenKcal, targets.eatKcal, input.kcal),
    };
  }
  return {
    impact: null,
    advice: adviseSnack({
      name: input.name,
      kcal: input.kcal,
      kind: input.kind,
      slot: input.slot,
      eatenKcal: summary.data.eatenKcal,
      eatKcal: targets.eatKcal,
      tdeeKcal: targets.tdee,
      eatenByMeal: summary.data.eatenByMeal,
      nowMin: wibMinutes(new Date()),
      ramadan: effectiveRamadan(profile.data?.profile?.ramadanMode),
      fasting: fasting.data ?? null,
    }),
  };
}

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const VERDICT_ICON: Record<AdviceVerdict, IconName> = {
  aman: "checkmark-circle",
  "hati-hati": "alert-circle",
  lewat: "warning",
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/**
 * Inline verdict card shown before saving. Never blocks the save button; the
 * half-portion action only rescales the form above it.
 */
export function SnackAdviceCard({
  state,
  onHalf,
  halfApplied,
  onUndoHalf,
}: {
  state: SnackAdviceState;
  /** Scales the pending portion to half; omit when the screen cannot. */
  onHalf?: () => void;
  /** The portion is already halved: show the undo instead of the half action. */
  halfApplied?: boolean;
  onUndoHalf?: () => void;
}) {
  const { t } = useTranslation("makan");
  const { theme } = useUnistyles();
  const { advice, impact } = state;
  if (!advice) {
    return impact ? (
      <Text style={styles.impact} accessibilityRole="text">
        {impact}
      </Text>
    ) : null;
  }
  const palette = {
    aman: { bg: theme.colors.makanSoft, icon: theme.colors.makanText },
    "hati-hati": { bg: `${theme.colors.eatNear}26`, icon: theme.colors.kcalText },
    lewat: { bg: `${theme.colors.destructive}1F`, icon: theme.colors.destructive },
  }[advice.verdict];
  const { numbers } = advice;
  const half = advice.suggestions.find((s) => s.type === "half");
  const swap = advice.suggestions.find((s) => s.type === "swap");
  const lighter = advice.suggestions.find((s) => s.type === "lighter-next");
  const lines = [
    swap?.type === "swap" ? swap.text : null,
    lighter?.type === "lighter-next"
      ? t("snackAdvice.card.lighterLine", {
          label: lighter.label,
          kcal: fmtKcalLabel(lighter.targetKcal),
        })
      : null,
  ].filter((line): line is string => line !== null);
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={t("snackAdvice.card.ariaFull", {
        title: advice.title,
        reason: advice.reason,
      })}
      style={[styles.card, { backgroundColor: palette.bg }]}
    >
      <View style={styles.head}>
        <View style={styles.iconWrap}>
          <Ionicons name={VERDICT_ICON[advice.verdict]} size={22} color={palette.icon} />
        </View>
        <View style={styles.headText}>
          <Text style={styles.title}>{advice.title}</Text>
          <Text style={styles.reason}>{advice.reason}</Text>
        </View>
      </View>

      <View style={styles.stats}>
        <Stat
          label={t("snackAdvice.card.remainingToday")}
          value={fmtKcalLabel(numbers.remainingKcal)}
        />
        <Stat
          label={
            advice.upcoming.length > 0
              ? t("snackAdvice.card.needLater")
              : t("snackAdvice.card.mealsAhead")
          }
          value={
            advice.upcoming.length > 0
              ? fmtKcalLabel(numbers.reserveKcal)
              : t("snackAdvice.card.none")
          }
        />
        <Stat
          label={t("snackAdvice.card.afterThis")}
          value={
            numbers.afterKcal >= 0
              ? fmtKcalLabel(numbers.afterKcal)
              : t("snackAdvice.card.over", { kcal: fmtInt(numbers.overKcal) })
          }
        />
      </View>

      {halfApplied && onUndoHalf ? (
        <View style={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            icon="arrow-undo"
            label={t("snackAdvice.card.undoHalf")}
            onPress={onUndoHalf}
          />
        </View>
      ) : half?.type === "half" && onHalf ? (
        <View style={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            icon="cut-outline"
            label={t("snackAdvice.card.halfButton", { kcal: fmtKcalLabel(half.kcal) })}
            onPress={onHalf}
          />
          {half.verdict !== advice.verdict ? (
            <Text style={styles.hint}>
              {t("snackAdvice.card.halfResult", {
                verdict: VERDICT_LABELS[half.verdict].toLowerCase(),
              })}
            </Text>
          ) : null}
        </View>
      ) : null}

      {lines.map((line) => (
        <View key={line} style={styles.tipRow}>
          <Ionicons name="bulb-outline" size={16} color={theme.colors.mutedForeground} />
          <Text style={styles.tipText}>{line}</Text>
        </View>
      ))}

      <Text style={styles.hint}>{t("snackAdvice.card.note")}</Text>
    </View>
  );
}

const KIND_ICON = {
  makanan: "restaurant",
  camilan: "fast-food",
  minuman: "cafe",
} as const satisfies Record<string, IconName>;

/** Kinds the user can pick; 'lainnya' (supplements) only ever comes from the name list. */
export const PICKABLE_KINDS = ["makanan", "camilan", "minuman"] as const;

export type PickableKind = (typeof PICKABLE_KINDS)[number];

/** A kind the picker can show: 'lainnya' reads as makanan there. */
export function pickable(kind: FoodKind): PickableKind {
  return kind === "lainnya" ? "makanan" : kind;
}

/** Row chip: tap to step Makanan, Camilan, Minuman. Advice only, never saved. */
export function KindCycleChip({
  value,
  onChange,
}: {
  value: FoodKind;
  onChange: (next: PickableKind) => void;
}) {
  const { t } = useTranslation("makan");
  const { theme } = useUnistyles();
  const current = pickable(value);
  const next = PICKABLE_KINDS[(PICKABLE_KINDS.indexOf(current) + 1) % PICKABLE_KINDS.length]!;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("snackAdvice.kindCycle.aria", {
        current: t(`kind.${current}`),
        next: t(`kind.${next}`),
      })}
      hitSlop={8}
      onPress={() => onChange(next)}
      style={({ pressed }) => [styles.cycleChip, pressed && styles.pressed]}
    >
      <Ionicons name={KIND_ICON[current]} size={13} color={theme.colors.mutedForeground} />
      <Text style={styles.cycleLabel}>{t(`kind.${current}`)}</Text>
    </Pressable>
  );
}

/** Three pills for forms with a single item (manual add, barcode). */
export function KindPicker({
  value,
  onChange,
}: {
  value: FoodKind;
  onChange: (next: PickableKind) => void;
}) {
  const { t } = useTranslation("makan");
  const { theme } = useUnistyles();
  const current = pickable(value);
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t("snackAdvice.kindPicker.label")}
      style={styles.picker}
    >
      {PICKABLE_KINDS.map((kind) => {
        const active = kind === current;
        const ink = active ? theme.colors.background : theme.colors.foreground;
        return (
          <Pressable
            key={kind}
            accessibilityRole="radio"
            accessibilityLabel={t(`kind.${kind}`)}
            accessibilityState={{ checked: active }}
            onPress={() => onChange(kind)}
            style={({ pressed }) => [
              styles.pill,
              { backgroundColor: active ? theme.colors.foreground : theme.colors.muted },
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name={KIND_ICON[kind]} size={16} color={ink} />
            <Text style={[styles.pillLabel, { color: ink }]}>{t(`kind.${kind}`)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    borderRadius: theme.radius.card,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  head: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.md,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.card,
  },
  headText: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: theme.fontSize.md,
    fontFamily: theme.fonts.heavy,
    color: theme.colors.foreground,
  },
  reason: {
    fontSize: theme.fontSize.base,
    lineHeight: 22,
    color: theme.colors.foreground,
  },
  stats: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  stat: {
    flex: 1,
    alignItems: "center",
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: 4,
    borderRadius: theme.radius.input,
    backgroundColor: theme.colors.card,
    gap: 2,
  },
  statLabel: {
    fontSize: 11,
    fontFamily: theme.fonts.medium,
    color: theme.colors.mutedForeground,
  },
  statValue: {
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fonts.heavy,
    color: theme.colors.foreground,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  tipRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.sm,
  },
  tipText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.foreground,
  },
  hint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  impact: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    paddingHorizontal: 4,
  },
  cycleChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.muted,
  },
  cycleLabel: {
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fonts.bold,
    color: theme.colors.mutedForeground,
  },
  picker: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  pill: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: theme.spacing.lg - 4,
    borderRadius: theme.radius.pill,
  },
  pillLabel: {
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fonts.bold,
  },
  pressed: {
    opacity: 0.6,
  },
}));

/** Hook + card for screens that render the advice below their early returns. */
export function SnackAdviceSection({
  date,
  kcal,
  kind,
  slot,
  name,
  ...card
}: Parameters<typeof useSnackAdvice>[0] & {
  onHalf?: () => void;
  halfApplied?: boolean;
  onUndoHalf?: () => void;
}) {
  const state = useSnackAdvice({ date, kcal, kind, slot, name });
  // Hamil / Menyusui: a need to meet, so no "left today / over" verdicts.
  const { mode } = useMaternal();
  // Naikin BB: eating more is the goal, so the verdict card gives way to a positive line.
  const { gain } = useGain();
  if (mode !== "none") return null;
  if (gain) return <GainScanAdvice date={date} kcal={kcal} />;
  return <SnackAdviceCard state={state} {...card} />;
}
