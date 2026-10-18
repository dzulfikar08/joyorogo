import "@/unistyles";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { ACTIVITY_LABELS, idealWeightRange, jakartaToday, MAX_TARGET_DAYS, shiftDate } from "@joyorogo/api/lib/engine";
import {
  bmiOf,
  suggestedDays,
  suggestGainTarget,
  UNDERWEIGHT_BMI,
  type Goal,
} from "@joyorogo/api/lib/gain";

import { Button, Card, ListGroup, ListRow, StatTile, Text } from "@/components/ui";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { ProfilDataPage, type ProfileData } from "@/components/profil/page";
import { NeedsSheet } from "@/components/needs-sheet";
import { TargetPaceNotice } from "@/components/target-pace-notice";
import { TargetDateSheet, TargetWeightSheet } from "@/components/target-sheets";
import { EndPregnancySheet } from "@/components/maternal/end-pregnancy-sheet";
import { MaternalEditSheet, MaternalSettingsSheet, useSetMaternal } from "@/components/maternal/maternal-sheets";
import { GainDisclaimer, GainNotes } from "@/components/gain/gain-notes";
import { GoalChooser } from "@/components/gain/goal-chooser";
import { fmtDateMedium, fmtInt, fmtKg } from "@/utils/format";
import { client, orpc, queryClient } from "@/utils/orpc";
import { useOptimisticMutation } from "@/lib/optimistic";

const SHEET_SWAP_MS = 350;

/** Target & tubuh: daily numbers, goal, target weight/date, maternal mode, personal details. */
export default function Target() {
  const { t } = useTranslation("settings");
  return (
    <ProfilDataPage title={t("hub.rows.body.title")}>
      {(profile) => <TargetContent profile={profile} />}
    </ProfilDataPage>
  );
}

function TargetContent({ profile: profileData }: { profile: ProfileData }) {
  const { t } = useTranslation(["settings", "common", "maternal", "gain"]);
  type TargetsInput = { targetWeightKg: number; targetDate: string; goal?: Goal };
  type ProfileCache = { profile: Record<string, unknown> | null };
  const myProfileKey = orpc.profile.myProfile.queryOptions().queryKey;

  const updateTargets = useOptimisticMutation<TargetsInput, unknown, TargetsInput | null>({
    mutationFn: (input) => client.profile.updateTargets(input),
    patch: (input, cache) => {
      const row = queryClient.getQueryData<ProfileCache>(myProfileKey);
      const previous =
        row?.profile == null
          ? null
          : {
              targetWeightKg: row.profile.targetWeightKg as number,
              targetDate: row.profile.targetDate as string,
              ...(input.goal ? { goal: row.profile.goal as Goal } : {}),
            };
      cache.value<ProfileCache>(myProfileKey, (old) => ({
        profile: {
          ...old?.profile,
          targetWeightKg: input.targetWeightKg,
          targetDate: input.targetDate,
          ...(input.goal ? { goal: input.goal } : {}),
        },
      }));
      return previous;
    },
    success: (_input, _data, previous) => {
      setSheet(null);
      setGoalDraft(null);
      const undoFrom = previous ?? null;
      return {
        message: t("plan.toast.updated"),
        undo: undoFrom === null ? undefined : () => updateTargets.mutate(undoFrom),
      };
    },
    invalidate: () => [orpc.profile.key()],
  });

  // Focused editors: "weight" and "date" open separately; "needs" is the TDEE breakdown.
  const [sheet, setSheet] = useState<
    null | "weight" | "date" | "needs" | "maternal" | "maternalEdit" | "end"
  >(null);
  // A goal picked in the chooser that needs a new target first (the weight sheet saves both).
  const [goalDraft, setGoalDraft] = useState<"lose" | "gain" | null>(null);
  const [turnOffOpen, setTurnOffOpen] = useState(false);
  const turnOff = useSetMaternal(() => {
    setTurnOffOpen(false);
    setSheet(null);
  });
  /** One Modal at a time: let the leaving sheet finish its slide before the next one opens. */
  const swapTo = (next: "maternal" | "maternalEdit" | "end") => {
    setSheet(null);
    setTimeout(() => setSheet(next), SHEET_SWAP_MS);
  };

  const prof = profileData.profile ?? null;
  const weightNowKg = profileData.latestWeightKg ?? prof?.startWeightKg ?? 0;
  const targets = profileData.targets ?? null;
  const maternal = targets?.maternal ?? null;
  const heightCm = prof?.heightCm ?? null;
  const underweight = heightCm !== null && bmiOf(weightNowKg, heightCm) < UNDERWEIGHT_BMI;

  /** A starting target for a goal that has no valid target yet. */
  const draftTargetKg = (goal: "lose" | "gain") => {
    if (goal === "gain" && heightCm !== null) {
      const range = idealWeightRange(heightCm);
      return Math.round(suggestGainTarget(weightNowKg, heightCm, range.minKg, range.maxKg) * 10) / 10;
    }
    return Math.round((weightNowKg - 1) * 10) / 10;
  };
  const draftTargetDate = (goal: "lose" | "gain", targetKg: number) =>
    shiftDate(
      jakartaToday(),
      goal === "gain"
        ? Math.min(suggestedDays(targetKg - weightNowKg, weightNowKg, underweight), MAX_TARGET_DAYS)
        : 90,
    );
  const closeTargetSheet = () => {
    setSheet(null);
    setGoalDraft(null);
  };

  /** Maintain holds today's weight; lose / gain keep the target when it sits on the right side, else ask for a new one first. */
  const chooseGoal = (next: Goal) => {
    if (!prof || next === prof.goal) {
      setGoalDraft(null);
      return;
    }
    if (next === "maintain") {
      setGoalDraft(null);
      updateTargets.mutate({ goal: next, targetWeightKg: prof.targetWeightKg, targetDate: prof.targetDate });
      return;
    }
    const fits = next === "gain" ? prof.targetWeightKg > weightNowKg : prof.targetWeightKg < weightNowKg;
    if (fits) {
      setGoalDraft(null);
      updateTargets.mutate({ goal: next, targetWeightKg: prof.targetWeightKg, targetDate: prof.targetDate });
      return;
    }
    setGoalDraft(next);
    setSheet("weight");
  };

  const heightIdeal = prof ? idealWeightRange(prof.heightCm) : null;

  return (
    <>
      {prof && targets ? (
        <>
          {/* Tiga angka harian sebagai tile, seperti PlanNumbers web */}
          <View style={styles.planTiles}>
            <StatTile
              icon="restaurant"
              tint="makan"
              label={t("plan.numbers.eat")}
              value={fmtInt(targets.eatKcal)}
              sub={t("plan.numbers.perDay")}
            />
            {maternal ? null : (
              <StatTile
                icon="flame"
                tint="bakar"
                label={t("plan.numbers.burn")}
                value={fmtInt(targets.burnKcal)}
                sub={t("plan.numbers.perDay")}
              />
            )}
            <StatTile
              icon="moon"
              tint="tidur"
              label={t("plan.numbers.sleep")}
              value={fmtKg(targets.sleepHours)}
              sub={t("plan.numbers.perNight")}
            />
          </View>

          {/* TDEE: dari mana target makan datang */}
          <ListGroup>
            <ListRow
              icon="flash"
              iconTint="makan"
              title={t("plan.needs.row")}
              value={t("plan.needs.rowValue", { kcal: fmtInt(targets.tdee) })}
              chevron
              onPress={() => setSheet("needs")}
            />
          </ListGroup>

          {/* Hamil dan menyusui: perempuan saja */}
          {prof.gender === "female" ? (
            <ListGroup>
              <ListRow
                icon="heart"
                iconTint="makan"
                title={t("maternal:settings.title")}
                subtitle={
                  maternal
                    ? maternal.mode === "pregnant"
                      ? t("maternal:settings.rowPregnant", { week: maternal.gestation?.weeks ?? 0 })
                      : t("maternal:settings.rowBreastfeeding", { months: maternal.babyMonths ?? 0 })
                    : t("maternal:settings.rowOff")
                }
                wrapTitle
                chevron
                onPress={() => setSheet("maternal")}
              />
            </ListGroup>
          ) : null}

          {/* Tujuan: Turunin / Jaga / Naikin BB (mati selama Hamil atau Menyusui) */}
          {maternal ? null : (
            <Card>
              <Text style={styles.cardTitle}>{t("gain:goal.title")}</Text>
              <GoalChooser value={goalDraft ?? prof.goal} onChange={chooseGoal} />
            </Card>
          )}

          {/* Rencana rows → sheet editors */}
          <ListGroup>
            {maternal ? null : (
              <ListRow
                icon="flag"
                iconTint="makan"
                title={t("plan.targetWeight.title")}
                subtitle={t("plan.targetWeight.subtitle")}
                value={`${fmtKg(prof.targetWeightKg)} kg`}
                chevron
                onPress={() => setSheet("weight")}
              />
            )}
            {maternal ? null : (
              <ListRow
                icon="calendar"
                iconTint="makan"
                title={t("plan.targetDate.title")}
                subtitle={t("plan.targetDate.subtitle")}
                value={fmtDateMedium(prof.targetDate)}
                chevron
                onPress={() => setSheet("date")}
              />
            )}
            <ListRow
              icon="walk"
              iconTint="makan"
              title={t("plan.activity.title")}
              subtitle={t("plan.activity.subtitle")}
              value={ACTIVITY_LABELS[prof.activityLevel as "low" | "mid" | "high"]}
            />
          </ListGroup>
          {!maternal ? <TargetPaceNotice pace={targets.datePace} /> : null}

          {targets.notes
            .filter((note) => note !== "MATERNAL")
            .map((note) => (
              <Text key={note} style={styles.note}>
                {t(`plan.noteShort.${note}`)}
              </Text>
            ))}
          {!maternal && targets.notes.includes("ADAPTIVE") && targets.formulaTdee ? (
            <Text style={styles.note}>
              {t("plan.formulaEstimate", {
                formula: fmtInt(targets.formulaTdee),
                tdee: fmtInt(targets.tdee),
              })}
            </Text>
          ) : null}
          {maternal ? (
            <Text style={styles.note}>{t("maternal:settings.hiddenNote")}</Text>
          ) : (
            <>
              <Text style={styles.note}>
                {heightIdeal
                  ? t("plan.summary.withRange", {
                      kg: fmtKg(prof.targetWeightKg),
                      date: fmtDateMedium(prof.targetDate),
                      min: fmtKg(heightIdeal.minKg),
                      max: fmtKg(heightIdeal.maxKg),
                    })
                  : t("plan.summary.target", {
                      kg: fmtKg(prof.targetWeightKg),
                      date: fmtDateMedium(prof.targetDate),
                    })}
              </Text>
              <Text style={styles.caption}>{t("plan.recalcNote")}</Text>
              {targets.gain ? (
                <>
                  <GainNotes gain={targets.gain} />
                  <Text style={styles.caption}>{t("gain:plan.estimate")}</Text>
                  <Text style={styles.caption}>
                    {t("gain:estimate.title")}. {t("gain:estimate.body")}
                  </Text>
                  <GainDisclaimer short />
                </>
              ) : null}
            </>
          )}

          {/* Data diri (hanya baca) */}
          <ListGroup>
            <ListRow
              title={t("profile.personal.gender")}
              value={
                prof.gender === "male" || prof.gender === "female"
                  ? t(`profile.gender.${prof.gender}`)
                  : prof.gender
              }
            />
            <ListRow title={t("profile.personal.birthYear")} value={String(prof.birthYear)} />
            <ListRow title={t("profile.personal.height")} value={`${fmtInt(prof.heightCm)} cm`} />
            <ListRow
              title={t("profile.personal.startWeight")}
              value={`${fmtKg(prof.startWeightKg)} kg`}
            />
            <ListRow
              title={t("profile.personal.currentWeight")}
              value={
                profileData.latestWeightKg != null
                  ? `${fmtKg(profileData.latestWeightKg)} kg`
                  : t("profile.personal.currentWeightNone")
              }
            />
          </ListGroup>
          <Text style={styles.caption}>{t("profile.personal.note")}</Text>
        </>
      ) : (
        <Card>
          <Text style={styles.cardTitle}>{t("plan.empty.title")}</Text>
          <Text style={styles.note}>{t("plan.empty.body")}</Text>
          <Button
            variant="secondary"
            label={t("plan.empty.cta")}
            onPress={() => router.replace("/onboarding")}
          />
        </Card>
      )}

      {prof ? (
        <>
          {maternal ? null : (
            <>
              <TargetWeightSheet
                visible={sheet === "weight"}
                onClose={closeTargetSheet}
                heightCm={prof.heightCm}
                weightNowKg={weightNowKg}
                targetWeightKg={goalDraft ? draftTargetKg(goalDraft) : prof.targetWeightKg}
                pending={updateTargets.isPending}
                onSave={async (kg) => {
                  await updateTargets.mutateAsync({
                    targetWeightKg: kg,
                    targetDate: goalDraft ? draftTargetDate(goalDraft, kg) : prof.targetDate,
                    ...(goalDraft ? { goal: goalDraft } : {}),
                  });
                }}
              />
              <TargetDateSheet
                visible={sheet === "date"}
                onClose={() => setSheet(null)}
                targetDate={prof.targetDate}
                weightNowKg={weightNowKg}
                targetWeightKg={prof.targetWeightKg}
                goal={prof.goal}
                heightCm={prof.heightCm}
                pending={updateTargets.isPending}
                onSave={async (date) => {
                  await updateTargets.mutateAsync({
                    targetWeightKg: prof.targetWeightKg,
                    targetDate: date,
                  });
                }}
              />
            </>
          )}
          {targets ? (
            <NeedsSheet visible={sheet === "needs"} onClose={() => setSheet(null)} targets={targets} />
          ) : null}
          <MaternalSettingsSheet
            visible={sheet === "maternal"}
            onClose={() => setSheet(null)}
            onEdit={() => swapTo("maternalEdit")}
            onEnd={() => swapTo("end")}
            onTurnOff={() => {
              setSheet(null);
              setTimeout(() => setTurnOffOpen(true), SHEET_SWAP_MS);
            }}
          />
          <MaternalEditSheet
            visible={sheet === "maternalEdit"}
            onClose={() => (maternal ? swapTo("maternal") : setSheet(null))}
          />
          <EndPregnancySheet visible={sheet === "end"} onClose={() => setSheet(null)} />
        </>
      ) : null}

      <ConfirmSheet
        visible={turnOffOpen}
        onClose={() => setTurnOffOpen(false)}
        title={t("maternal:settings.turnOffTitle")}
        message={t("maternal:settings.turnOffBody")}
        confirmLabel={t("maternal:settings.turnOffConfirm")}
        cancelLabel={t("common:actions.cancel")}
        destructive={false}
        loading={turnOff.isPending}
        onConfirm={() => turnOff.mutate({ mode: "none" })}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  cardTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  planTiles: {
    flexDirection: "row",
    gap: theme.spacing.md,
  },
  caption: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    lineHeight: 18,
    marginTop: -theme.spacing.sm,
  },
  note: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
}));
