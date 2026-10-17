import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import {
  checkTargetDate,
  idealWeightRange,
  jakartaToday,
  MAX_TARGET_DAYS,
  shiftDate,
} from "@joyorogo/api/lib/engine";

import { Calendar } from "@/components/calendar";
import { Button, Chip, Field, Input, Sheet, Text } from "@/components/ui";
import { errorMessage, fmtDateMedium, fmtInt, fmtKg, parseNum } from "@/utils/format";
import { orpc } from "@/utils/orpc";

/**
 * Sheet "Berat target": one focused input, healthy-range hint, and the web's
 * below-healthy-range warning (profil.tsx TargetWeightForm).
 */
export function TargetWeightSheet({
  visible,
  onClose,
  heightCm,
  targetWeightKg,
  pending,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  heightCm: number;
  targetWeightKg: number;
  pending: boolean;
  onSave: (targetWeightKg: number) => Promise<void>;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const [weight, setWeight] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Fresh form per open: an unsaved edit must not leak into the next visit.
  useEffect(() => {
    if (visible) {
      setWeight(null);
      setError(null);
      setSaveError(null);
    }
  }, [visible]);

  const shown = weight ?? String(targetWeightKg);
  const ideal = idealWeightRange(heightCm);
  const parsed = parseNum(shown);
  const belowRange = parsed !== null && parsed < ideal.minKg;

  const submit = async () => {
    if (parsed === null || parsed < 25 || parsed > 400) {
      setError(t("plan.targetWeight.error"));
      return;
    }
    setError(null);
    setSaveError(null);
    try {
      await onSave(parsed);
    } catch (e) {
      setSaveError(errorMessage(e));
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t("plan.targetWeight.title")}
      footer={
        <Button label={t("common:actions.save")} onPress={() => void submit()} loading={pending} />
      }
    >
      <Field label={t("plan.targetWeight.inputLabel")}>
        <Input
          value={shown}
          onChangeText={(text) => {
            setWeight(text);
            setError(null);
          }}
          keyboardType="decimal-pad"
          style={styles.bigInput}
        />
      </Field>
      <Text style={styles.note}>
        {t("plan.targetWeight.healthyRange", { min: fmtKg(ideal.minKg), max: fmtKg(ideal.maxKg) })}
      </Text>
      {belowRange ? (
        <Text style={styles.warnText}>{t("plan.targetWeight.belowRange")}</Text>
      ) : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {saveError ? <Text style={styles.errorText}>{saveError}</Text> : null}
      <Text style={styles.note}>{t("plan.targetWeight.hint")}</Text>
    </Sheet>
  );
}

/**
 * Sheet "Tanggal target": in-app calendar (future days only), quick chips, a
 * pace verdict from the shared engine check, and the live daily eat target the
 * date would give (profile.previewTargets, never blocks Save).
 */
export function TargetDateSheet({
  visible,
  onClose,
  targetDate,
  weightNowKg,
  targetWeightKg,
  pending,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  targetDate: string;
  weightNowKg: number;
  targetWeightKg: number;
  pending: boolean;
  onSave: (targetDate: string) => Promise<void>;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const [date, setDate] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setDate(null);
      setSaveError(null);
    }
  }, [visible]);

  const today = jakartaToday();
  const minDate = shiftDate(today, 1);
  const maxDate = shiftDate(today, MAX_TARGET_DAYS);
  const shown = date ?? targetDate;
  const check = useMemo(
    () => checkTargetDate({ weightNowKg, targetWeightKg, targetDate: shown, today }),
    [weightNowKg, targetWeightKg, shown, today],
  );
  const valid =
    check.status === "ok" ||
    check.status === "fast" ||
    check.status === "slow" ||
    check.status === "maintenance";

  const preview = useQuery({
    ...orpc.profile.previewTargets.queryOptions({
      input: { targetWeightKg, targetDate: shown },
    }),
    enabled: visible && valid,
    placeholderData: (prev) => prev,
    retry: false,
  });

  const pick = (iso: string) => {
    setDate(iso);
    setSaveError(null);
  };

  const quick = [
    { key: "month1", days: 30 },
    { key: "month3", days: 91 },
    { key: "month6", days: 182 },
    { key: "year1", days: 365 },
  ] as const;

  const submit = async () => {
    if (!valid) return;
    setSaveError(null);
    try {
      await onSave(shown);
    } catch (e) {
      setSaveError(errorMessage(e));
    }
  };

  const days = valid && "days" in check ? check.days : null;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t("plan.targetDate.title")}
      footer={
        <Button
          label={t("common:actions.save")}
          onPress={() => void submit()}
          loading={pending}
          disabled={!valid}
        />
      }
    >
      <View style={styles.chipRow} accessibilityLabel={t("plan.targetDate.pickLabel")}>
        {quick.map(({ key, days: n }) => {
          const iso = shiftDate(today, n);
          return (
            <Chip
              key={key}
              label={t(`plan.targetDate.quick.${key}`)}
              selected={shown === iso}
              onPress={() => pick(iso)}
            />
          );
        })}
      </View>
      <Calendar
        value={shown}
        onChange={pick}
        minDate={minDate}
        maxDate={maxDate}
        prevLabel={t("plan.targetDate.prevMonth")}
        nextLabel={t("plan.targetDate.nextMonth")}
      />
      <View style={styles.summary}>
        <Text style={styles.summaryDate}>{fmtDateMedium(shown)}</Text>
        {days !== null ? (
          <Text style={styles.summaryAway}>{t("plan.targetDate.daysAway", { count: days })}</Text>
        ) : null}
      </View>

      {check.status === "fast" ? (
        <View style={styles.warnBox}>
          <Text style={styles.warnTitle}>
            {t("plan.targetDate.tooFast.title", { deficit: fmtInt(check.rawDeficitKcal) })}
          </Text>
          <Text style={styles.warnBody}>
            {t("plan.targetDate.tooFast.body", {
              kg: fmtKg(check.lossKg),
              count: check.feasibleDays,
            })}
          </Text>
          <Button
            variant="secondary"
            size="sm"
            label={t("plan.targetDate.tooFast.useDate", { count: check.feasibleDays })}
            onPress={() => pick(shiftDate(today, check.feasibleDays))}
            style={styles.warnAction}
          />
        </View>
      ) : null}
      {check.status === "slow" ? (
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>{t("plan.targetDate.slow.title")}</Text>
          <Text style={styles.warnBody}>
            {t("plan.targetDate.slow.body", {
              deficit: fmtInt(check.deficitKcal),
              date: fmtDateMedium(shiftDate(today, check.feasibleDays)),
            })}
          </Text>
          <Button
            variant="secondary"
            size="sm"
            label={t("plan.targetDate.slow.useDate", {
              date: fmtDateMedium(shiftDate(today, check.feasibleDays)),
            })}
            onPress={() => pick(shiftDate(today, check.feasibleDays))}
            style={styles.warnAction}
          />
        </View>
      ) : null}
      {check.status === "ok" ? (
        <Text style={styles.note}>
          {t("plan.targetDate.ok", {
            kg: fmtKg(check.lossKg),
            count: check.days,
            perWeek: fmtKg((check.lossKg / check.days) * 7),
          })}
        </Text>
      ) : null}
      {check.status === "maintenance" ? (
        <Text style={styles.note}>{t("plan.targetDate.maintenance")}</Text>
      ) : null}
      {!valid ? <Text style={styles.errorText}>{t("plan.targetDate.error")}</Text> : null}

      {valid && preview.data ? (
        <Text style={styles.previewText}>
          {preview.data.next.eatKcal === preview.data.current.eatKcal
            ? t("plan.targetDate.preview.same", { kcal: fmtInt(preview.data.next.eatKcal) })
            : t("plan.targetDate.preview.changed", {
                next: fmtInt(preview.data.next.eatKcal),
                current: fmtInt(preview.data.current.eatKcal),
              })}
        </Text>
      ) : null}
      {valid && preview.isError ? (
        <Text style={styles.note}>{t("plan.targetDate.previewFailed")}</Text>
      ) : null}
      {saveError ? <Text style={styles.errorText}>{saveError}</Text> : null}
      <Text style={styles.note}>{t("plan.targetDate.hint")}</Text>
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  bigInput: {
    textAlign: "center",
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
  },
  note: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
  warnText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
    lineHeight: 20,
  },
  errorText: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.destructive,
  },
  warnBox: {
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.bakarSoft,
  },
  warnTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.bakarText,
    lineHeight: 20,
  },
  warnBody: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
  warnAction: {
    alignSelf: "flex-start",
  },
  infoBox: {
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.muted,
  },
  infoTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    lineHeight: 20,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  summary: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  summaryDate: {
    fontSize: theme.fontSize.md,
    fontWeight: "800",
  },
  summaryAway: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  previewText: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.makanText,
    lineHeight: 22,
  },
}));
