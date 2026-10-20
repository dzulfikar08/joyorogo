import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import type { Targets } from "@joyorogo/api/lib/engine";
import {
  MANUAL_TDEE_MAX_KCAL,
  MANUAL_TDEE_MIN_KCAL,
  MANUAL_TDEE_WARN_ABOVE_FACTOR,
  manualTdeeWarning,
} from "@joyorogo/api/lib/manual-tdee";
import type { ManualTdeeInfo } from "@joyorogo/api/lib/manual-tdee";

import { CalibrationLearnLink } from "@/components/calibration-learn-link";
import { useToast } from "@/components/toast";
import { Button, Card, Field, Input, Text } from "@/components/ui";
import { errorMessage, fmtInt } from "@/utils/format";
import { client, orpc, queryClient } from "@/utils/orpc";

/** Everything a changed TDEE moves: the profile (targets, activity guide), the day summaries, fasting and weight views. */
async function refreshPlan() {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: orpc.profile.key() }),
    queryClient.invalidateQueries({ queryKey: orpc.day.key() }),
    queryClient.invalidateQueries({ queryKey: orpc.fasting.today.key() }),
    queryClient.invalidateQueries({ queryKey: orpc.weight.key() }),
  ]);
}

function useManualTdeeMutations(onTargets?: (targets: Targets) => void) {
  const { t } = useTranslation("energy");
  const toast = useToast();
  const done = async (targets: Targets, message: string) => {
    onTargets?.(targets);
    await refreshPlan();
    toast.success(message);
  };
  const onError = (error: unknown) => toast.error(errorMessage(error));
  const save = useMutation({
    mutationFn: (kcal: number) => client.profile.setManualTdee({ kcal }),
    onSuccess: (data, kcal) => done(data.targets as Targets, t("manual.saved", { kcal })),
    onError,
  });
  const clear = useMutation({
    mutationFn: () => client.profile.clearManualTdee(),
    onSuccess: (data) => done(data.targets as Targets, t("manual.resetDone")),
    onError,
  });
  const dismiss = useMutation({
    mutationFn: () => client.profile.dismissManualTdeeSuggestion(),
    onSuccess: (data) => done(data.targets as Targets, t("manual.suggest.dismissed")),
    onError,
  });
  return { save, clear, dismiss };
}

/**
 * The input for "Pakai TDEE sendiri": whole kcal between 1.000 and 6.000, our estimate next to it with the difference,
 * a warning (never a block) when it is under our BMR or far above our TDEE, and the way back to the automatic estimate.
 */
export function ManualTdeeForm({
  info,
  onSaved,
}: {
  info: ManualTdeeInfo;
  /** the targets the server built after the change (onboarding shows them) */
  onSaved?: (targets: Targets) => void;
}) {
  const { t } = useTranslation("energy");
  const { save, clear } = useManualTdeeMutations(onSaved);
  const [draft, setDraft] = useState(info.kcal === null ? "" : String(info.kcal));
  const [touched, setTouched] = useState(false);
  const trimmed = draft.trim().replace(/[.\s]/g, "");
  const typed = trimmed === "" ? null : Number(trimmed.replace(",", "."));
  const valid =
    typed !== null && Number.isInteger(typed) && typed >= MANUAL_TDEE_MIN_KCAL && typed <= MANUAL_TDEE_MAX_KCAL;
  const warning = valid ? manualTdeeWarning(typed, info.bmrKcal, info.computedKcal) : null;
  const diff = valid ? typed - info.computedKcal : null;
  const busy = save.isPending || clear.isPending;
  const error = !touched
    ? null
    : typed === null || Number.isNaN(typed)
      ? t("manual.error.empty")
      : valid
        ? null
        : t("manual.error.range", { min: fmtInt(MANUAL_TDEE_MIN_KCAL), max: fmtInt(MANUAL_TDEE_MAX_KCAL) });

  const submit = () => {
    setTouched(true);
    if (valid) save.mutate(typed);
  };

  return (
    <View style={styles.form}>
      <Field label={t("manual.label")}>
        <Input
          value={draft}
          onChangeText={(text) => {
            setDraft(text);
            setTouched(false);
          }}
          keyboardType="number-pad"
          placeholder={t("manual.placeholder")}
          editable={!busy}
          returnKeyType="done"
          onSubmitEditing={submit}
        />
      </Field>
      <Text style={styles.strong}>{t("manual.reference", { kcal: fmtInt(info.computedKcal) })}</Text>
      {diff !== null ? (
        <Text style={styles.note}>
          {diff === 0
            ? t("manual.diff.same")
            : t(diff > 0 ? "manual.diff.more" : "manual.diff.less", { kcal: fmtInt(Math.abs(diff)) })}
        </Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {warning ? (
        <Text style={styles.warning}>
          {warning === "BELOW_BMR"
            ? t("manual.warn.BELOW_BMR", { bmr: fmtInt(info.bmrKcal) })
            : t("manual.warn.ABOVE_RANGE", {
                kcal: fmtInt(Math.round(info.computedKcal * MANUAL_TDEE_WARN_ABOVE_FACTOR)),
              })}
        </Text>
      ) : null}
      <Button
        label={t("manual.save")}
        loading={save.isPending}
        disabled={busy || draft.trim() === "" || (touched && !valid)}
        onPress={submit}
      />
      {info.kcal !== null ? (
        <Button
          variant="ghost"
          label={t("manual.reset")}
          disabled={busy}
          onPress={() => {
            setDraft("");
            setTouched(false);
            clear.mutate();
          }}
        />
      ) : null}
    </View>
  );
}

/**
 * The calibration's gentle suggestion: shown only after two weekly measurements in a row more than 10% from the typed
 * TDEE. One tap uses the observed estimate, one tap leaves the number alone; nothing is ever applied by itself.
 */
export function ManualTdeeSuggestionCard({ info }: { info: ManualTdeeInfo | null | undefined }) {
  const { t } = useTranslation("energy");
  const { save, dismiss } = useManualTdeeMutations();
  if (!info?.suggestion || info.kcal === null) return null;
  const busy = save.isPending || dismiss.isPending;
  const { kcal: measured } = info.suggestion;
  return (
    <Card style={styles.card}>
      <Text style={styles.cardTitle}>{t("manual.suggest.title")}</Text>
      <Text style={styles.strong}>
        {t("manual.suggest.body", { measured: fmtInt(measured), manual: fmtInt(info.kcal) })}
      </Text>
      <Text style={styles.note}>{t("manual.suggest.hint")}</Text>
      <View style={styles.actions}>
        <Button label={t("manual.suggest.accept")} disabled={busy} onPress={() => save.mutate(measured)} />
        <Button
          variant="secondary"
          label={t("manual.suggest.dismiss")}
          disabled={busy}
          onPress={() => dismiss.mutate()}
        />
        <CalibrationLearnLink label={t("manual.learn")} hash="manual" />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: { gap: theme.spacing.sm },
  card: { gap: theme.spacing.sm },
  cardTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  strong: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  note: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
  },
  error: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    fontWeight: "600",
    color: theme.colors.destructive,
  },
  warning: {
    padding: theme.spacing.md,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.muted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.foreground,
  },
  actions: { gap: theme.spacing.sm, marginTop: theme.spacing.xs },
}));
