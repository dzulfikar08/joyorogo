import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { jakartaToday, shiftDate } from "@joyorogo/api/lib/engine";
import {
  babyAgeMonths,
  dueDateFromLmp,
  gestationalAge,
  lmpFromDueDate,
  MATERNAL_CONDITIONS,
  MAX_BABY_MONTHS,
  MAX_PREGNANCY_DAYS,
  PREGNANCY_DAYS,
  type FeedingType,
  type MaternalCondition,
  type MaternalInput,
  type PregnancyDateKind,
} from "@joyorogo/api/lib/maternal";

import { Calendar } from "@/components/calendar";
import { PressableScale } from "@/components/motion";
import { Field, Input, Num, Segmented, Text } from "@/components/ui";
import { fmtDateMedium, parseNum } from "@/utils/format";

import { MaternalDisclaimer } from "./disclaimer";

export type MaternalFormMode = "pregnant" | "breastfeeding";

/** What the form edits; strings stay strings until draftToInput validates them. */
export type MaternalDraft = {
  mode: MaternalFormMode;
  dateKind: PregnancyDateKind;
  /** HPHT or HPL, matching dateKind; null until picked */
  date: string | null;
  preWeight: string;
  twins: boolean;
  feeding: FeedingType;
  babyMonths: number;
  conditions: MaternalCondition[];
};

export function emptyDraft(mode: MaternalFormMode): MaternalDraft {
  return {
    mode,
    dateKind: "hpht",
    date: null,
    preWeight: "",
    twins: false,
    feeding: "exclusive",
    babyMonths: 0,
    conditions: [],
  };
}

/** Starting values for editing: the stored profile row, falling back to blanks. */
export function draftFromProfile(
  row: {
    maternalMode: string;
    pregnancyLmp: string | null;
    pregnancyDateKind: string | null;
    prePregnancyWeightKg: number | null;
    pregnancyTwins: boolean | null;
    breastfeedingType: string | null;
    babyBirthDate: string | null;
    maternalConditions: string[] | null;
  },
  fallback: MaternalFormMode = "pregnant",
): MaternalDraft {
  const mode: MaternalFormMode = row.maternalMode === "breastfeeding" ? "breastfeeding" : row.maternalMode === "pregnant" ? "pregnant" : fallback;
  const draft = emptyDraft(mode);
  const conditions = (row.maternalConditions ?? []).filter((c): c is MaternalCondition =>
    (MATERNAL_CONDITIONS as readonly string[]).includes(c),
  );
  const kind: PregnancyDateKind = row.pregnancyDateKind === "hpl" ? "hpl" : "hpht";
  return {
    ...draft,
    dateKind: kind,
    date: row.pregnancyLmp ? (kind === "hpl" ? dueDateFromLmp(row.pregnancyLmp) : row.pregnancyLmp) : null,
    preWeight: row.prePregnancyWeightKg != null ? String(row.prePregnancyWeightKg) : "",
    twins: row.pregnancyTwins === true,
    feeding: row.breastfeedingType === "partial" ? "partial" : "exclusive",
    babyMonths: row.babyBirthDate ? Math.min(babyAgeMonths(row.babyBirthDate), MAX_BABY_MONTHS) : 0,
    conditions,
  };
}

const WEIGHT_MIN = 25;
const WEIGHT_MAX = 250;

/** Draft -> API input, or the i18n key (maternal ns) of what is missing. */
export function draftToInput(
  draft: MaternalDraft,
): { ok: true; input: MaternalInput } | { ok: false; error: "form.error.date" | "form.error.weight" } {
  const weight = parseNum(draft.preWeight);
  const weightOk = weight !== null && weight >= WEIGHT_MIN && weight <= WEIGHT_MAX;
  if (draft.mode === "pregnant") {
    if (!draft.date) return { ok: false, error: "form.error.date" };
    if (!weightOk) return { ok: false, error: "form.error.weight" };
    return {
      ok: true,
      input: {
        mode: "pregnant",
        dateKind: draft.dateKind,
        date: draft.date,
        prePregnancyWeightKg: weight,
        twins: draft.twins,
        conditions: draft.conditions,
      },
    };
  }
  if (draft.preWeight.trim() !== "" && !weightOk) return { ok: false, error: "form.error.weight" };
  return {
    ok: true,
    input: {
      mode: "breastfeeding",
      feeding: draft.feeding,
      babyAgeMonths: draft.babyMonths,
      prePregnancyWeightKg: weightOk ? weight : null,
      conditions: draft.conditions,
    },
  };
}

/**
 * The Hamil / Menyusui answers: shared by onboarding and Settings. Fields
 * only; the caller owns the surrounding screen, validation timing and save.
 * `showModePicker` adds the pregnant/breastfeeding switch (Settings setup).
 */
export function MaternalForm({
  draft,
  onChange,
  showModePicker = false,
  showDisclaimer = true,
  error,
}: {
  draft: MaternalDraft;
  onChange: (next: MaternalDraft) => void;
  showModePicker?: boolean;
  showDisclaimer?: boolean;
  error?: string | null;
}) {
  const { t } = useTranslation(["maternal", "settings"]);
  const { theme } = useUnistyles();
  const set = (patch: Partial<MaternalDraft>) => onChange({ ...draft, ...patch });
  const today = jakartaToday();

  // HPHT: at most 42 weeks back, not in the future. HPL: the same window moved by 40 weeks.
  const hpht = draft.dateKind === "hpht";
  const minDate = hpht
    ? shiftDate(today, -MAX_PREGNANCY_DAYS)
    : shiftDate(today, PREGNANCY_DAYS - MAX_PREGNANCY_DAYS);
  const maxDate = hpht ? today : shiftDate(today, PREGNANCY_DAYS);
  const lmp = draft.date ? (hpht ? draft.date : lmpFromDueDate(draft.date)) : null;
  const preview = lmp ? gestationalAge(lmp, today) : null;

  const toggleCondition = (c: MaternalCondition) =>
    set({
      conditions: draft.conditions.includes(c)
        ? draft.conditions.filter((x) => x !== c)
        : [...draft.conditions, c],
    });

  const stepMonths = (delta: number) =>
    set({ babyMonths: Math.min(Math.max(draft.babyMonths + delta, 0), MAX_BABY_MONTHS) });

  return (
    <View style={styles.form}>
      {showModePicker ? (
        <Segmented<MaternalFormMode>
          options={[
            { value: "pregnant", label: t("maternal:mode.pregnant") },
            { value: "breastfeeding", label: t("maternal:mode.breastfeeding") },
          ]}
          value={draft.mode}
          onChange={(mode) => set({ mode })}
        />
      ) : null}

      <Text style={styles.title}>
        {draft.mode === "pregnant" ? t("maternal:form.pregnantTitle") : t("maternal:form.breastfeedingTitle")}
      </Text>

      {draft.mode === "pregnant" ? (
        <>
          <Field label={t("maternal:form.dateKind.label")} hint={hpht ? t("maternal:form.dateKind.hphtHint") : t("maternal:form.dateKind.hplHint")}>
            <Segmented<PregnancyDateKind>
              options={[
                { value: "hpht", label: t("maternal:form.dateKind.hpht") },
                { value: "hpl", label: t("maternal:form.dateKind.hpl") },
              ]}
              value={draft.dateKind}
              onChange={(dateKind) => set({ dateKind, date: null })}
            />
          </Field>

          <Field
            label={hpht ? t("maternal:form.date.hpht") : t("maternal:form.date.hpl")}
            hint={hpht ? t("maternal:form.date.hphtHelp") : t("maternal:form.date.hplHelp")}
          >
            <Calendar
              key={draft.dateKind}
              value={draft.date}
              onChange={(date) => set({ date })}
              minDate={minDate}
              maxDate={maxDate}
              initialMonth={today}
              prevLabel={t("settings:plan.targetDate.prevMonth")}
              nextLabel={t("settings:plan.targetDate.nextMonth")}
            />
          </Field>
          <Text style={styles.picked}>
            {draft.date ? fmtDateMedium(draft.date) : t("maternal:form.date.pick")}
            {preview
              ? `  ·  ${t("maternal:summary.weekDay", { week: preview.weeks, day: preview.dayOfWeek })}`
              : ""}
          </Text>

          <Field label={t("maternal:form.preWeight.label")} hint={t("maternal:form.preWeight.hint")}>
            <Input
              value={draft.preWeight}
              onChangeText={(preWeight) => set({ preWeight })}
              keyboardType="decimal-pad"
              placeholder="55"
            />
          </Field>

          <Field label={t("maternal:form.fetuses.label")}>
            <Segmented<"single" | "twins">
              options={[
                { value: "single", label: t("maternal:form.fetuses.single") },
                { value: "twins", label: t("maternal:form.fetuses.twins") },
              ]}
              value={draft.twins ? "twins" : "single"}
              onChange={(v) => set({ twins: v === "twins" })}
            />
          </Field>
        </>
      ) : (
        <>
          <Field
            label={t("maternal:form.feeding.label")}
            hint={
              draft.feeding === "exclusive"
                ? t("maternal:form.feeding.exclusiveHint")
                : t("maternal:form.feeding.partialHint")
            }
          >
            <Segmented<FeedingType>
              options={[
                { value: "exclusive", label: t("maternal:form.feeding.exclusive") },
                { value: "partial", label: t("maternal:form.feeding.partial") },
              ]}
              value={draft.feeding}
              onChange={(feeding) => set({ feeding })}
            />
          </Field>

          <Field label={t("maternal:form.babyAge.label")}>
            <View style={styles.stepper}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t("maternal:form.babyAge.decrease")}
                disabled={draft.babyMonths <= 0}
                onPress={() => stepMonths(-1)}
                style={[styles.stepButton, draft.babyMonths <= 0 && styles.stepDisabled]}
              >
                <Ionicons name="remove" size={22} color={theme.colors.foreground} />
              </PressableScale>
              <Num style={styles.stepValue}>
                {t("maternal:form.babyAge.months", { months: draft.babyMonths })}
              </Num>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t("maternal:form.babyAge.increase")}
                disabled={draft.babyMonths >= MAX_BABY_MONTHS}
                onPress={() => stepMonths(1)}
                style={[styles.stepButton, draft.babyMonths >= MAX_BABY_MONTHS && styles.stepDisabled]}
              >
                <Ionicons name="add" size={22} color={theme.colors.foreground} />
              </PressableScale>
            </View>
          </Field>

          <Field label={t("maternal:form.preWeight.label")} hint={t("maternal:form.preWeight.hintOptional")}>
            <Input
              value={draft.preWeight}
              onChangeText={(preWeight) => set({ preWeight })}
              keyboardType="decimal-pad"
              placeholder="55"
            />
          </Field>
        </>
      )}

      <Field label={t("maternal:form.conditions.title")} hint={t("maternal:form.conditions.optional")}>
        <View style={styles.conditions}>
          {MATERNAL_CONDITIONS.map((c) => {
            const selected = draft.conditions.includes(c);
            return (
              <PressableScale
                key={c}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={t(`maternal:form.conditions.${c}`)}
                onPress={() => toggleCondition(c)}
                scaleTo={0.98}
                style={styles.condition}
              >
                <Ionicons
                  name={selected ? "checkbox" : "square-outline"}
                  size={22}
                  color={selected ? theme.colors.primary : theme.colors.mutedForeground}
                />
                <Text style={styles.conditionLabel}>{t(`maternal:form.conditions.${c}`)}</Text>
              </PressableScale>
            );
          })}
        </View>
      </Field>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {showDisclaimer ? <MaternalDisclaimer /> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: {
    gap: theme.spacing.md,
  },
  title: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  picked: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  stepButton: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.input,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.muted,
  },
  stepDisabled: {
    opacity: 0.4,
  },
  stepValue: {
    flex: 1,
    textAlign: "center",
    fontSize: theme.fontSize.lg,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  conditions: {
    gap: theme.spacing.xs,
  },
  condition: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.input,
    backgroundColor: theme.colors.muted,
  },
  conditionLabel: {
    flex: 1,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
}));
