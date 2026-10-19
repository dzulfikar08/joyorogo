import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import type { PlanPrefs } from "@joyorogo/api/lib/meal/planner";
import { ALLERGENS } from "@joyorogo/api/lib/meal/types";
import type { Allergen } from "@joyorogo/api/lib/meal/types";

import { PressableScale } from "@/components/motion";
import { Button, Field, Input, Segmented, Sheet, Text } from "@/components/ui";

import { useMealPlanMutations } from "./use-meal-plan";

/** Mirrors MAX_DISLIKES of the server (lib/meal/store), which cannot be imported here: it pulls in the database. */
const MAX_DISLIKES = 20;
const MAX_DISLIKE_LENGTH = 30;

function ToggleChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { theme } = useUnistyles();
  return (
    <PressableScale
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      scaleTo={0.96}
      style={[styles.chip, { backgroundColor: selected ? theme.colors.foreground : theme.colors.muted }]}
    >
      {selected ? <Ionicons name="checkmark" size={16} color={theme.colors.background} /> : null}
      <Text style={[styles.chipLabel, { color: selected ? theme.colors.background : theme.colors.foreground }]}>
        {label}
      </Text>
    </PressableScale>
  );
}

function PrefsBody({ prefs, onClose }: { prefs: PlanPrefs; onClose: () => void }) {
  const { t } = useTranslation("mealPlan");
  const { theme } = useUnistyles();
  const { setPrefs, generate } = useMealPlanMutations();
  const [allergens, setAllergens] = useState<Allergen[]>(prefs.allergens);
  const [dislikes, setDislikes] = useState<string[]>(prefs.dislikes);
  const [budget, setBudget] = useState(prefs.budgetFriendly);
  const [cook, setCook] = useState<PlanPrefs["cookPref"]>(prefs.cookPref);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);

  const toggleAllergen = (allergen: Allergen) =>
    setAllergens((current) => (current.includes(allergen) ? current.filter((a) => a !== allergen) : [...current, allergen]));

  const addDislike = () => {
    const value = draft.trim().toLowerCase();
    if (value === "" || dislikes.length >= MAX_DISLIKES) return;
    if (!dislikes.includes(value)) setDislikes([...dislikes, value]);
    setDraft("");
  };

  const save = () =>
    setPrefs.mutate(
      { allergens, dislikes, budgetFriendly: budget, cookPref: cook },
      { onSuccess: () => setSaved(true) },
    );

  if (saved) {
    return (
      <>
        <View style={styles.saved}>
          <Ionicons name="checkmark-circle" size={24} color={theme.colors.makanText} />
          <Text style={styles.savedText}>{t("prefs.saved")}</Text>
        </View>
        <Button
          label={generate.isPending ? t("regen.working") : t("prefs.regenNow")}
          loading={generate.isPending}
          onPress={() => generate.mutate({ regenerate: true }, { onSuccess: onClose })}
        />
        <Button variant="secondary" label={t("prefs.later")} disabled={generate.isPending} onPress={onClose} />
      </>
    );
  }

  return (
    <>
      <Field label={t("prefs.allergies")} hint={t("prefs.allergiesHint")}>
        <View style={styles.chips}>
          {ALLERGENS.map((allergen) => (
            <ToggleChip
              key={allergen}
              label={t(`allergen.${allergen}`)}
              selected={allergens.includes(allergen)}
              onPress={() => toggleAllergen(allergen)}
            />
          ))}
        </View>
      </Field>

      <Field
        label={t("prefs.dislikes")}
        hint={dislikes.length >= MAX_DISLIKES ? t("native.dislikesLimit", { max: MAX_DISLIKES }) : t("prefs.dislikesHint")}
      >
        {dislikes.length > 0 ? (
          <View style={styles.chips}>
            {dislikes.map((name) => (
              <PressableScale
                key={name}
                accessibilityRole="button"
                accessibilityLabel={t("prefs.dislikesRemove", { name })}
                onPress={() => setDislikes(dislikes.filter((d) => d !== name))}
                scaleTo={0.96}
                style={[styles.chip, styles.dislike]}
              >
                <Text style={styles.chipLabel}>{name}</Text>
                <Ionicons name="close" size={16} color={theme.colors.mutedForeground} />
              </PressableScale>
            ))}
          </View>
        ) : null}
        <View style={styles.addRow}>
          <Input
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={addDislike}
            placeholder={t("prefs.dislikesPlaceholder")}
            accessibilityLabel={t("prefs.dislikes")}
            maxLength={MAX_DISLIKE_LENGTH}
            editable={dislikes.length < MAX_DISLIKES}
            returnKeyType="done"
            autoCapitalize="none"
            style={styles.addInput}
          />
          <Button
            variant="secondary"
            label={t("prefs.dislikesAdd")}
            disabled={draft.trim() === "" || dislikes.length >= MAX_DISLIKES}
            onPress={addDislike}
          />
        </View>
      </Field>

      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.switchLabel}>{t("prefs.budget")}</Text>
          <Text style={styles.switchHint}>{t("prefs.budgetHint")}</Text>
        </View>
        <Switch
          value={budget}
          onValueChange={setBudget}
          accessibilityLabel={t("prefs.budget")}
          trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
        />
      </View>

      <Field label={t("prefs.cook")} hint={t("prefs.cookHint")}>
        <Segmented
          value={cook}
          onChange={setCook}
          options={[
            { value: "cook", label: t("prefs.cookCook") },
            { value: "buy", label: t("prefs.cookBuy") },
            { value: "mixed", label: t("prefs.cookMixed") },
          ]}
        />
      </Field>

      <Button label={t("prefs.save")} loading={setPrefs.isPending} onPress={save} />
    </>
  );
}

/** Allergies, dislikes, budget and where the food comes from. Saving offers to plan again with them. */
export function PrefsSheet({ open, prefs, onClose }: { open: boolean; prefs: PlanPrefs; onClose: () => void }) {
  const { t } = useTranslation("mealPlan");
  return (
    <Sheet visible={open} onClose={onClose} title={t("prefs.title")}>
      {open ? <PrefsBody prefs={prefs} onClose={onClose} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: theme.radius.pill,
  },
  chipLabel: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  dislike: {
    backgroundColor: theme.colors.muted,
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  addInput: {
    flex: 1,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    minHeight: 56,
  },
  switchText: {
    flex: 1,
    gap: 2,
  },
  switchLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  switchHint: {
    fontSize: theme.fontSize.xs,
    lineHeight: 17,
    color: theme.colors.mutedForeground,
  },
  saved: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.makanSoft,
  },
  savedText: {
    flex: 1,
    fontSize: theme.fontSize.base,
    lineHeight: 22,
    fontWeight: "600",
    color: theme.colors.makanText,
  },
}));
