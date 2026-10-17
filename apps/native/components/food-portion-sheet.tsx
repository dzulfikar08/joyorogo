import "@/unistyles";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { MEAL_EDIT_LABELS, jakartaToday, relativeDayLabel } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { PORTION_MULTIPLIERS, scalePortion } from "@joyorogo/api/lib/portion";
import type { PortionValues } from "@joyorogo/api/lib/portion";

import { MacroLine } from "@/components/macro-line";
import { DateSheet, DayChips } from "@/components/plate/date-sheet";
import { MealSlotField } from "@/components/plate/meal-slot-field";
import { SheetActions } from "@/components/sheet-actions";
import { StickerHero } from "@/components/sticker";
import { MacroIcon } from "@/utils/macro-icons";
import { Button, Chip, Field, Input, Num, Sheet, Text } from "@/components/ui";
import { OptimisticCache, useOptimisticMutation } from "@/lib/optimistic";
import { fmtDateMedium, fmtGramsLabel, fmtKcalLabel, parseNum } from "@/utils/format";
import { client, orpc } from "@/utils/orpc";

type FoodUpdateInput = Parameters<typeof client.food.update>[0];

/** The slice of a food_log row this sheet edits and re-renders. */
export type PortionRow = PortionValues & {
  id: string;
  date: string;
  meal: string;
  name: string;
  scanId?: string | null;
};

type FoodList = {
  items: PortionRow[];
  totals: { kcal: number; protein: number; carbs: number; fat: number; fiber: number };
};

const listKey = (date: string) => orpc.food.listByDate.queryOptions({ input: { date } }).queryKey;

/** Decimal-comma text for an input, at most `digits` decimals, no trailing zeros. */
const fmtField = (n: number, digits = 0) =>
  String(Math.round(n * 10 ** digits) / 10 ** digits).replace(".", ",");

const portionOf = (row: PortionRow): PortionValues => ({
  grams: row.grams,
  kcal: row.kcal,
  protein: row.protein,
  carbs: row.carbs,
  fat: row.fat,
  fiber: row.fiber,
});

/** Payload that sets a row to exactly these values (the undo path reuses it). */
function updateInput(
  row: PortionRow,
  values: PortionValues,
  extra: Partial<FoodUpdateInput>,
): FoodUpdateInput {
  return {
    id: row.id,
    kcal: values.kcal,
    ...(values.grams !== null ? { grams: values.grams } : {}),
    ...(values.protein !== null ? { protein: values.protein } : {}),
    ...(values.carbs !== null ? { carbs: values.carbs } : {}),
    ...(values.fat !== null ? { fat: values.fat } : {}),
    ...(values.fiber !== null ? { fiber: values.fiber } : {}),
    ...extra,
  };
}

/**
 * Cache patch for one edited row: same-day edits replace the row in place and
 * move the day totals by the delta; a date change relocates it between the two
 * day caches. Day summaries get the matching deltas.
 */
function patchFoodEdit(cache: OptimisticCache, before: PortionRow, after: PortionRow) {
  const delta = {
    kcal: after.kcal - before.kcal,
    protein: (after.protein ?? 0) - (before.protein ?? 0),
    carbs: (after.carbs ?? 0) - (before.carbs ?? 0),
    fat: (after.fat ?? 0) - (before.fat ?? 0),
    fiber: (after.fiber ?? 0) - (before.fiber ?? 0),
  };
  if (after.date !== before.date) {
    cache.value<FoodList>(listKey(before.date), (old) =>
      old
        ? {
            items: old.items.filter((item) => item.id !== before.id),
            totals: {
              kcal: Math.max(0, old.totals.kcal - before.kcal),
              protein: Math.max(0, old.totals.protein - (before.protein ?? 0)),
              carbs: Math.max(0, old.totals.carbs - (before.carbs ?? 0)),
              fat: Math.max(0, old.totals.fat - (before.fat ?? 0)),
              fiber: Math.max(0, old.totals.fiber - (before.fiber ?? 0)),
            },
          }
        : old,
    );
    cache.value<FoodList>(listKey(after.date), (old) =>
      old
        ? {
            items: [...old.items, after],
            totals: {
              kcal: old.totals.kcal + after.kcal,
              protein: old.totals.protein + (after.protein ?? 0),
              carbs: old.totals.carbs + (after.carbs ?? 0),
              fat: old.totals.fat + (after.fat ?? 0),
              fiber: old.totals.fiber + (after.fiber ?? 0),
            },
          }
        : old,
    );
    cache.summary({
      date: before.date,
      kcal: -before.kcal,
      protein: -(before.protein ?? 0),
      carbs: -(before.carbs ?? 0),
      fat: -(before.fat ?? 0),
      meal: before.meal,
      meals: -1,
    });
    cache.summary({
      date: after.date,
      kcal: after.kcal,
      protein: after.protein ?? 0,
      carbs: after.carbs ?? 0,
      fat: after.fat ?? 0,
      meal: after.meal,
      meals: 1,
    });
    return;
  }
  cache.value<FoodList>(listKey(before.date), (old) =>
    old
      ? {
          items: old.items.map((item) => (item.id === before.id ? after : item)),
          totals: {
            kcal: Math.max(0, old.totals.kcal + delta.kcal),
            protein: Math.max(0, old.totals.protein + delta.protein),
            carbs: Math.max(0, old.totals.carbs + delta.carbs),
            fat: Math.max(0, old.totals.fat + delta.fat),
            fiber: Math.max(0, old.totals.fiber + delta.fiber),
          },
        }
      : old,
  );
  if (after.meal !== before.meal) {
    // Slot move on the same day: the kcal and the meal count leave one slot and land in the other.
    cache.summary({
      date: before.date,
      kcal: -before.kcal,
      protein: -(before.protein ?? 0),
      carbs: -(before.carbs ?? 0),
      fat: -(before.fat ?? 0),
      meal: before.meal,
      meals: -1,
    });
    cache.summary({
      date: after.date,
      kcal: after.kcal,
      protein: after.protein ?? 0,
      carbs: after.carbs ?? 0,
      fat: after.fat ?? 0,
      meal: after.meal,
      meals: 1,
    });
  } else {
    cache.summary({ date: before.date, ...delta, meal: before.meal });
  }
}

/**
 * Edit sheet for one logged food: name, portion and day.
 *
 * Portion math is linear from the stored row. Rows with a weight get a gram
 * and a kcal field that follow each other (link button to break the tie);
 * rows without one get 0,5x / 1x / 1,5x / 2x chips plus a custom multiplier.
 * Typing kcal always rescales the macros. The preview shows exactly what will
 * be stored; price lives on the plate and does not change with portion.
 */
export function FoodPortionSheet({
  row,
  onClose,
  favorite,
  onFavorite,
  onShare,
  onDelete,
}: {
  row: PortionRow;
  onClose: () => void;
  favorite: boolean;
  onFavorite: () => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation(["makan", "common"]);
  const { theme } = useUnistyles();
  const queryClient = useQueryClient();
  const base = portionOf(row);
  const hasGrams = base.grams !== null;
  const [name, setName] = useState(row.name);
  const [date, setDate] = useState(row.date);
  const [meal, setMeal] = useState<Meal>(row.meal as Meal);
  const [pickingDate, setPickingDate] = useState(false);
  const [linked, setLinked] = useState(true);
  // Scale of the portion relative to what was logged; macros always follow it.
  const [ratio, setRatio] = useState(1);
  const [gramsText, setGramsText] = useState(hasGrams ? fmtField(base.grams!) : "");
  const [kcalText, setKcalText] = useState(fmtField(base.kcal));
  const [multText, setMultText] = useState("1");

  const typedKcal = parseNum(kcalText);
  const typedGrams = parseNum(gramsText);
  const scaled = scalePortion(base, ratio);
  const values: PortionValues = {
    ...scaled,
    kcal: typedKcal === null ? scaled.kcal : Math.round(typedKcal),
    grams: hasGrams && typedGrams !== null ? Math.round(typedGrams) : scaled.grams,
  };
  const valid =
    name.trim() !== "" &&
    typedKcal !== null &&
    typedKcal >= 0 &&
    typedKcal <= 5000 &&
    (!hasGrams || (typedGrams !== null && typedGrams >= 1 && typedGrams <= 5000));
  const dateChanged = date !== row.date;
  const mealChanged = meal !== row.meal;
  const changed =
    dateChanged ||
    mealChanged ||
    name.trim() !== row.name ||
    values.kcal !== row.kcal ||
    values.grams !== row.grams ||
    ratio !== 1;

  /** Re-render every field from a new scale (the linked path). */
  const applyRatio = (next: number) => {
    const s = scalePortion(base, next);
    setRatio(next);
    setKcalText(fmtField(s.kcal));
    setMultText(fmtField(next, 2));
    if (hasGrams) setGramsText(fmtField(s.grams!));
  };

  const onGrams = (text: string) => {
    setGramsText(text);
    const grams = parseNum(text);
    if (linked && hasGrams && grams !== null && grams > 0) {
      const next = grams / base.grams!;
      setRatio(next);
      setKcalText(fmtField(scalePortion(base, next).kcal));
    }
  };

  const onKcal = (text: string) => {
    setKcalText(text);
    const kcal = parseNum(text);
    if (kcal === null || kcal < 0 || base.kcal <= 0) return;
    const next = kcal / base.kcal;
    setRatio(next);
    setMultText(fmtField(next, 2));
    if (linked && hasGrams) setGramsText(fmtField(scalePortion(base, next).grams!));
  };

  const onMult = (text: string) => {
    setMultText(text);
    const mult = parseNum(text);
    if (mult !== null && mult > 0) applyRatio(mult);
  };

  const toggleLink = () => {
    // Re-linking lets energy lead: weight snaps back in line with the kcal.
    if (!linked && typedKcal !== null && base.kcal > 0) applyRatio(typedKcal / base.kcal);
    setLinked(!linked);
  };

  const update = useOptimisticMutation<FoodUpdateInput, unknown>({
    mutationFn: (input) => client.food.update(input),
    patch: (input, cache) => {
      patchFoodEdit(cache, row, {
        ...row,
        ...values,
        name: input.name ?? row.name,
        date: input.date ?? row.date,
        meal: input.meal ?? row.meal,
      });
    },
    invalidate: () => [orpc.food.key(), orpc.plate.key(), orpc.day.key()],
    success: (input) => {
      const moved = input.date !== undefined && input.date !== row.date;
      const slotMoved = input.meal !== undefined && input.meal !== row.meal;
      return {
        message: moved
          ? t("portionSheet.toast.movedDay", { date: relativeDayLabel(input.date!, jakartaToday()) })
          : slotMoved
            ? t("portionSheet.toast.movedSlot", { meal: MEAL_EDIT_LABELS[input.meal!] })
            : t("portionSheet.toast.updated", { name: input.name ?? row.name }),
        undo: () => {
          const cache = new OptimisticCache(queryClient);
          patchFoodEdit(
            cache,
            {
              ...row,
              ...values,
              name: input.name ?? row.name,
              date: input.date ?? row.date,
              meal: input.meal ?? row.meal,
            },
            row,
          );
          void client.food
            .update(
              updateInput(row, base, {
                name: row.name,
                ...(moved ? { date: row.date } : {}),
                ...(slotMoved ? { meal: row.meal as Meal } : {}),
              }),
            )
            .finally(() => {
              for (const key of [orpc.food.key(), orpc.plate.key(), orpc.day.key()]) {
                void queryClient.invalidateQueries({ queryKey: key });
              }
            });
        },
      };
    },
  });

  const submit = () => {
    if (!valid || !changed) return;
    update.mutate(
      updateInput(row, values, {
        ...(name.trim() !== row.name ? { name: name.trim() } : {}),
        ...(dateChanged ? { date } : {}),
        ...(mealChanged ? { meal } : {}),
      }),
    );
    onClose();
  };

  return (
    <>
      <Sheet
        visible
        onClose={onClose}
        title={t("portionSheet.title")}
        footer={
          <Button
            label={t("common:actions.save")}
            onPress={submit}
            disabled={!valid || !changed}
            loading={update.isPending}
          />
        }
      >
        <View style={styles.body}>
          <StickerHero scanId={row.scanId} name={row.name} />
          <Field label={t("portionSheet.name")}>
            <Input
              value={name}
              onChangeText={setName}
              maxLength={200}
              accessibilityLabel={t("portionSheet.nameAria")}
            />
          </Field>

          {hasGrams ? (
            <View style={styles.pair}>
              <View style={styles.pairField}>
                <Field label={t("portionSheet.weightLabel")} macro="grams">
                  <Input
                    value={gramsText}
                    onChangeText={onGrams}
                    keyboardType="decimal-pad"
                    accessibilityLabel={t("portionSheet.weightAria")}
                  />
                </Field>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: linked }}
                accessibilityLabel={
                  linked ? t("portionSheet.link.linkedAria") : t("portionSheet.link.unlinkedAria")
                }
                onPress={toggleLink}
                style={({ pressed }) => [
                  styles.link,
                  { backgroundColor: linked ? theme.colors.makanSoft : theme.colors.muted },
                  pressed && styles.pressed,
                ]}
              >
                <MaterialCommunityIcons
                  name={linked ? "link-variant" : "link-variant-off"}
                  size={20}
                  color={linked ? theme.colors.makanText : theme.colors.mutedForeground}
                />
              </Pressable>
              <View style={styles.pairField}>
                <Field label={t("portionSheet.kcalLabel")} macro="kcal">
                  <Input
                    value={kcalText}
                    onChangeText={onKcal}
                    keyboardType="decimal-pad"
                    accessibilityLabel={t("portionSheet.kcalAria")}
                  />
                </Field>
              </View>
            </View>
          ) : (
            <>
              <Field label={t("portionSheet.portion")}>
                <View style={styles.chips}>
                  {PORTION_MULTIPLIERS.map((mult) => (
                    <Chip
                      key={mult}
                      label={`${fmtField(mult, 1)}x`}
                      selected={ratio === mult}
                      onPress={() => applyRatio(mult)}
                    />
                  ))}
                  <Input
                    value={multText}
                    onChangeText={onMult}
                    keyboardType="decimal-pad"
                    accessibilityLabel={t("portionSheet.customMultiplier")}
                    style={styles.multInput}
                  />
                </View>
              </Field>
              <Field label={t("portionSheet.kcalLabel")} macro="kcal">
                <Input
                  value={kcalText}
                  onChangeText={onKcal}
                  keyboardType="decimal-pad"
                  accessibilityLabel={t("portionSheet.kcalAria")}
                />
              </Field>
            </>
          )}

          <View style={styles.preview} accessibilityLiveRegion="polite">
            <View style={styles.previewLine}>
              <View style={styles.previewItem}>
                <MacroIcon macro="kcal" size={16} />
                <Num style={styles.previewKcal}>{fmtKcalLabel(values.kcal)}</Num>
              </View>
              {hasGrams && values.grams !== null ? (
                <View style={styles.previewItem}>
                  <MacroIcon macro="grams" size={16} />
                  <Num style={[styles.previewKcal, styles.previewGram]}>
                    {fmtGramsLabel(values.grams)}
                  </Num>
                </View>
              ) : null}
            </View>
            <MacroLine
              protein={values.protein}
              carbs={values.carbs}
              fat={values.fat}
              fiber={values.fiber}
            />
            <Text style={styles.hint}>
              {hasGrams && !linked ? t("portionSheet.hint.unlinked") : t("portionSheet.hint.linked")}
            </Text>
          </View>

          <Field label={t("portionSheet.loggedOn")}>
            <View style={styles.dateBox}>
              <DayChips value={date} onChange={setDate} />
              <Button
                variant="ghost"
                size="sm"
                icon="calendar"
                label={relativeDayLabel(date, jakartaToday())}
                onPress={() => setPickingDate(true)}
              />
              {dateChanged ? (
                <Text style={styles.hint}>
                  {t("portionSheet.movedHint", { date: fmtDateMedium(date) })}
                </Text>
              ) : null}
            </View>
          </Field>

          <MealSlotField
            value={meal}
            current={row.meal as Meal}
            onChange={setMeal}
            hint={
              mealChanged
                ? t("portionSheet.slotMovedHint", { meal: MEAL_EDIT_LABELS[meal] })
                : t("portionSheet.slotHint")
            }
          />

          <SheetActions
            favorite={favorite}
            onFavorite={onFavorite}
            onShare={onShare}
            onDelete={onDelete}
          />
        </View>
      </Sheet>
      <DateSheet
        visible={pickingDate}
        value={date}
        onPick={setDate}
        onClose={() => setPickingDate(false)}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing.md,
    paddingBottom: theme.spacing.md,
  },
  pair: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing.sm,
  },
  pairField: {
    flex: 1,
  },
  link: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  pressed: {
    opacity: 0.7,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  multInput: {
    width: 88,
  },
  preview: {
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.tile,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  previewLine: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: theme.spacing.md,
  },
  previewItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  previewGram: {
    color: theme.colors.gramText,
  },
  previewKcal: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.kcalText,
  },
  hint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  dateBox: {
    gap: theme.spacing.sm,
  },
}));
