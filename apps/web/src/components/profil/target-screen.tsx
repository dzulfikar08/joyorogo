import { useQueryClient } from "@tanstack/react-query";
import type { AppRouterClient } from "@joyorogo/api/routers/index";
import { useNavigate } from "@tanstack/react-router";
import { Calculator, CalendarDays, Flag, Footprints, TrendingUp } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ACTIVITY_LABELS,
  checkTargetDate,
  idealWeightRange,
  jakartaToday,
  shiftDate,
} from "@joyorogo/api/lib/engine";
import type { ActivityLevel } from "@joyorogo/api/lib/engine";
import { bmiOf, goalOf, goalTargetError, HEALTHY_BMI_MAX } from "@joyorogo/api/lib/gain";
import type { Goal } from "@joyorogo/api/lib/gain";
import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { IconChip, ListButtonRow, ListGroup, ListRow, SectionTitle } from "@/components/kit/surface";
import { MaternalSettings } from "@/components/maternal/settings-section";
import { PlanNumbers, TargetNotesList } from "@/components/plan-numbers";
import { NeedsSheet } from "@/components/needs-sheet";
import { TargetDateForm } from "@/components/target-date-form";
import { TargetPaceNotice } from "@/components/target-pace-notice";
import { GainDateVerdict, isGainCheck } from "@/components/gain/gain-date-verdict";
import { GainNotes } from "@/components/gain/gain-notes";
import { GoalChooser } from "@/components/gain/goal-chooser";
import {
  GOAL_ERROR_KEY,
  leanPaceDays,
  planForGoal,
  settleableGoal,
} from "@/components/gain/goal-plan";
import { profileOptions } from "@/components/profil/shared";
import type { ProfilCtx } from "@/components/profil/shared";
import type { MyProfileData } from "@/lib/api-types";
import { fmtDateLong, fmtInt, fmtKg, parseNum } from "@/lib/format";
import { useOptimisticMutation } from "@/lib/optimistic";
import { client, orpc } from "@/utils/orpc";

/** Goal, target weight/date, daily needs, notes and read-only personal data. */
export function TargetScreen({
  ctx,
  needs,
  openMaternal,
}: {
  ctx: ProfilCtx;
  /** `?needs=1`: open the daily-needs sheet on arrival. */
  needs: boolean;
  /** `?maternal=1`: open the maternal settings on arrival. */
  openMaternal: boolean;
}) {
  const { t } = useTranslation(["settings", "common", "gain", "maternal"]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { row, targets, latestWeightKg } = ctx;

  // Optimistic targets patch; undo re-applies the previous target values.
  const previousTargets = useRef<{
    targetWeightKg: number;
    targetDate: string;
    goal: Goal;
    weightNowKg: number;
  } | null>(null);
  const edit = useOptimisticMutation<
    Parameters<AppRouterClient["profile"]["updateTargets"]>[0],
    unknown
  >({
    mutationFn: (input) => client.profile.updateTargets(input),
    patch: (input, cache) => {
      const old = queryClient.getQueryData<MyProfileData>(profileOptions.queryKey);
      previousTargets.current =
        old?.profile?.targetWeightKg != null && old.profile.targetDate != null
          ? {
              targetWeightKg: old.profile.targetWeightKg,
              targetDate: old.profile.targetDate,
              goal: old.profile.goal,
              weightNowKg: old.latestWeightKg ?? row.startWeightKg,
            }
          : null;
      cache.value<MyProfileData>(profileOptions.queryKey, (data) =>
        data?.profile
          ? {
              ...data,
              profile: {
                ...data.profile,
                targetWeightKg: input.targetWeightKg,
                targetDate: input.targetDate,
                goal: input.goal ?? data.profile.goal,
              },
            }
          : data,
      );
    },
    invalidate: () => [orpc.profile.key(), orpc.day.key(), orpc.weight.key()],
    success: () => {
      const prev = previousTargets.current;
      previousTargets.current = null;
      if (!prev) return { message: t("plan.toast.updated") };
      return {
        message: t("plan.toast.updated"),
        undo: () =>
          void client.profile.updateTargets({
            targetWeightKg: prev.targetWeightKg,
            targetDate: prev.targetDate,
            goal: settleableGoal(prev.goal, prev.weightNowKg, prev.targetWeightKg),
          }),
      };
    },
  });

  const [sheet, setSheet] = useState<null | "goal" | "weight" | "date" | "needs">(needs ? "needs" : null);
  const weightNowKg = latestWeightKg ?? row.startWeightKg;
  const [dateError, setDateError] = useState<string | null>(null);
  const closeSheet = () => {
    setSheet(null);
    setDateError(null);
    if (needs) navigate({ to: "/profil/target", search: {}, replace: true });
  };

  return (
    <>
      <SectionTitle>{t("section.plan")}</SectionTitle>
      <ListGroup>
        {(row.gender === "female" || targets.maternal) && (
          <MaternalSettings
            row={row}
            info={targets.maternal}
            defaultOpen={openMaternal}
            onClosed={() => {
              if (openMaternal) navigate({ to: "/profil/target", search: {}, replace: true });
            }}
          />
        )}
        {!targets.maternal && (
          <>
            <ListButtonRow
              icon={
            <IconChip tone="makan">
              <TrendingUp />
            </IconChip>
          }
              title={t("gain:goal.title")}
              value={t(`gain:goal.${row.goal}`)}
              onClick={() => setSheet("goal")}
            />
            {row.goal !== "maintain" && (
              <>
                <ListButtonRow
                  icon={
            <IconChip tone="makan">
              <Flag />
            </IconChip>
          }
                  title={t("plan.targetWeight.title")}
                  value={`${fmtKg(row.targetWeightKg)} kg`}
                  onClick={() => setSheet("weight")}
                />
                <ListButtonRow
                  icon={
            <IconChip tone="bakar">
              <CalendarDays />
            </IconChip>
          }
                  title={t("plan.targetDate.title")}
                  value={fmtDateLong(row.targetDate).replace(/^\w+, /, "")}
                  onClick={() => setSheet("date")}
                />
              </>
            )}
          </>
        )}
        <ListRow
          icon={
            <IconChip tone="tidur">
              <Footprints />
            </IconChip>
          }
          title={t("plan.activity.title")}
          value={ACTIVITY_LABELS[row.activityLevel as ActivityLevel] ?? row.activityLevel}
        />
      </ListGroup>
      {!targets.maternal && <TargetPaceNotice pace={targets.datePace} className="mt-3" />}
      <div className="mt-3">
        <PlanNumbers targets={targets} />
      </div>
      <ListGroup className="mt-3">
        <ListButtonRow
          icon={
            <IconChip tone="makan">
              <Calculator />
            </IconChip>
          }
          title={t("plan.needs.row")}
          value={t("plan.needs.rowValue", { kcal: fmtInt(targets.tdee) })}
          onClick={() => setSheet("needs")}
        />
      </ListGroup>
      {targets.notes.some((note) => note !== "MATERNAL") && (
        <div className="mt-3">
          <TargetNotesList notes={targets.notes} />
        </div>
      )}
      {targets.gain && <GainNotes gain={targets.gain} className="mt-3" />}
      {!targets.maternal && (
        <p className="mt-3 px-1 text-xs leading-relaxed text-muted-foreground">
          {t("plan.recalcNote")}
        </p>
      )}

      <Sheet
        open={sheet === "goal"}
        onOpenChange={(open) => {
          if (!open) closeSheet();
        }}
        title={t("gain:goal.title")}
      >
        <GoalForm
          goal={row.goal}
          weightNowKg={weightNowKg}
          heightCm={row.heightCm}
          targetWeightKg={row.targetWeightKg}
          targetDate={row.targetDate}
          pending={edit.isPending}
          serverError={dateError}
          onSave={(input) => {
            setDateError(null);
            edit.mutate(input, {
              onSuccess: () => setSheet(null),
              onError: (error) => setDateError(error.message),
            });
          }}
        />
      </Sheet>

      <Sheet
        open={sheet === "weight"}
        onOpenChange={(open) => {
          if (!open) closeSheet();
        }}
        title={t("plan.targetWeight.title")}
        description={t("plan.targetWeight.hint")}
      >
        <TargetWeightForm
          heightCm={row.heightCm}
          weightNowKg={weightNowKg}
          targetWeightKg={row.targetWeightKg}
          pending={edit.isPending}
          onSave={(kg) => {
            const goal = kg === row.targetWeightKg ? undefined : goalOf(weightNowKg, kg);
            const targetDate =
              goal === "gain" && row.goal !== "gain"
                ? shiftDate(jakartaToday(), leanPaceDays(weightNowKg, kg, row.heightCm))
                : row.targetDate;
            edit.mutate({ targetWeightKg: kg, targetDate, goal }, { onSuccess: () => setSheet(null) });
          }}
        />
      </Sheet>

      <Sheet
        open={sheet === "date"}
        onOpenChange={(open) => {
          if (!open) closeSheet();
        }}
        title={t("plan.targetDate.title")}
        description={t("plan.targetDate.hint")}
      >
        <TargetDateForm
          targetDate={row.targetDate}
          weightNowKg={weightNowKg}
          targetWeightKg={row.targetWeightKg}
          heightCm={row.heightCm}
          goal={row.goal}
          pending={edit.isPending}
          serverError={dateError}
          onSave={(date) => {
            setDateError(null);
            edit.mutate(
              {
                targetWeightKg: row.targetWeightKg,
                targetDate: date,
                goal: settleableGoal(row.goal, weightNowKg, row.targetWeightKg),
              },
              {
                onSuccess: () => setSheet(null),
                onError: (error) => setDateError(error.message),
              },
            );
          }}
        />
      </Sheet>

      <NeedsSheet
        open={sheet === "needs"}
        onOpenChange={(open) => {
          if (!open) closeSheet();
        }}
        targets={targets}
        activityLabel={String(ACTIVITY_LABELS[row.activityLevel as ActivityLevel] ?? row.activityLevel)}
      />

      <SectionTitle className="mt-7">{t("section.personal")}</SectionTitle>
      <ListGroup>
        <ListRow
          title={t("profile.personal.gender")}
          value={
            row.gender === "male" || row.gender === "female"
              ? t(`profile.gender.${row.gender}`)
              : row.gender
          }
        />
        <ListRow title={t("profile.personal.birthYear")} value={String(row.birthYear)} />
        <ListRow title={t("profile.personal.height")} value={`${fmtInt(row.heightCm)} cm`} />
        <ListRow
          title={t("profile.personal.startWeight")}
          value={`${fmtKg(row.startWeightKg)} kg`}
        />
        <ListRow
          title={t("profile.personal.currentWeight")}
          value={
            latestWeightKg !== null
              ? `${fmtKg(latestWeightKg)} kg`
              : t("profile.personal.currentWeightNone")
          }
        />
      </ListGroup>
      <p className="mt-3 px-1 text-xs leading-relaxed text-muted-foreground">
        {t("profile.personal.note")}
      </p>
    </>
  );
}

function TargetWeightForm({
  heightCm,
  weightNowKg,
  targetWeightKg,
  pending,
  onSave,
}: {
  heightCm: number;
  weightNowKg: number;
  targetWeightKg: number;
  pending: boolean;
  onSave: (targetWeightKg: number) => void;
}) {
  const { t } = useTranslation(["settings", "common", "gain"]);
  const [weight, setWeight] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shownWeight = weight ?? String(targetWeightKg);
  const ideal = idealWeightRange(heightCm);
  const parsedWeight = parseNum(shownWeight);
  const gaining = parsedWeight !== null && goalOf(weightNowKg, parsedWeight) === "gain";
  const belowRange = parsedWeight !== null && !gaining && parsedWeight < ideal.minKg;
  const aboveHealthy = gaining && bmiOf(parsedWeight, heightCm) > HEALTHY_BMI_MAX;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const kg = parseNum(shownWeight);
        if (kg === null || kg < 25 || kg > 400) {
          setError(t("plan.targetWeight.error"));
          return;
        }
        setError(null);
        onSave(kg);
      }}
    >
      <div className="relative">
        <Input
          aria-label={t("plan.targetWeight.inputLabel")}
          autoFocus
          type="number"
          step="0.1"
          min="25"
          max="400"
          inputMode="decimal"
          value={shownWeight}
          onChange={(event) => {
            setWeight(event.target.value);
            setError(null);
          }}
          className="h-16 pr-14 text-center text-3xl font-extrabold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="pointer-events-none absolute top-1/2 right-5 -translate-y-1/2 text-base font-semibold text-muted-foreground">
          kg
        </span>
      </div>
      <p className="text-sm text-muted-foreground tabular-nums">
        {t("plan.targetWeight.healthyRange", { min: fmtKg(ideal.minKg), max: fmtKg(ideal.maxKg) })}
      </p>
      {belowRange && (
        <p className="text-sm leading-relaxed text-destructive">
          {t("plan.targetWeight.belowRange")}
        </p>
      )}
      {gaining && (
        <p className="text-sm leading-relaxed text-muted-foreground">{t("gain:target.hint")}</p>
      )}
      {aboveHealthy && (
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("gain:target.aboveHealthy", { min: fmtKg(ideal.minKg), max: fmtKg(ideal.maxKg) })}
        </p>
      )}
      {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t("state.saving") : t("common:actions.save")}
      </Button>
    </form>
  );
}

/** Goal chooser sheet: Turunin / Jaga / Naikin BB with the same rules as onboarding. */
function GoalForm({
  goal: storedGoal,
  weightNowKg,
  heightCm,
  targetWeightKg,
  targetDate,
  pending,
  serverError,
  onSave,
}: {
  goal: Goal;
  weightNowKg: number;
  heightCm: number;
  targetWeightKg: number;
  targetDate: string;
  pending: boolean;
  serverError: string | null;
  onSave: (input: { goal: Goal; targetWeightKg: number; targetDate: string }) => void;
}) {
  const { t } = useTranslation(["settings", "common", "gain"]);
  const today = jakartaToday();
  const [draft, setDraft] = useState({
    goal: storedGoal,
    target: String(targetWeightKg),
    date: targetDate,
  });
  const [error, setError] = useState<string | null>(null);

  const target = parseNum(draft.target);
  const ideal = idealWeightRange(heightCm);
  const gainCheck =
    draft.goal === "gain" && target !== null
      ? checkTargetDate({
          weightNowKg,
          targetWeightKg: target,
          targetDate: draft.date,
          today,
          goal: "gain",
          heightCm,
        })
      : null;

  const choose = (goal: Goal) => {
    const plan = goal === draft.goal ? null : planForGoal(goal, weightNowKg, heightCm);
    setDraft(
      plan
        ? { goal, target: String(plan.targetKg), date: shiftDate(today, plan.days) }
        : { ...draft, goal },
    );
    setError(null);
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.goal === "maintain") {
          onSave({ goal: "maintain", targetWeightKg: weightNowKg, targetDate: shiftDate(today, 365) });
          return;
        }
        if (target === null || target < 25 || target > 400) {
          setError(t("plan.targetWeight.error"));
          return;
        }
        const goalError = goalTargetError(draft.goal, weightNowKg, target);
        if (goalError) {
          setError(t(GOAL_ERROR_KEY[goalError]));
          return;
        }
        setError(null);
        onSave({ goal: draft.goal, targetWeightKg: target, targetDate: draft.date });
      }}
    >
      <GoalChooser value={draft.goal} onChange={choose} />

      {draft.goal === "maintain" ? (
        <p className="px-1 text-sm leading-relaxed text-muted-foreground">{t("gain:goal.maintainNote")}</p>
      ) : (
        <>
          <div className="relative">
            <Input
              aria-label={t("plan.targetWeight.inputLabel")}
              type="number"
              step="0.1"
              min="25"
              max="400"
              inputMode="decimal"
              value={draft.target}
              onChange={(event) => {
                const value = event.target.value;
                const typed = parseNum(value);
                setDraft({
                  ...draft,
                  target: value,
                  goal: typed === null ? draft.goal : goalOf(weightNowKg, typed) === "gain" ? "gain" : "lose",
                });
                setError(null);
              }}
              className="h-16 pr-14 text-center text-3xl font-extrabold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span className="pointer-events-none absolute top-1/2 right-5 -translate-y-1/2 text-base font-semibold text-muted-foreground">
              kg
            </span>
          </div>
          <p className="text-sm text-muted-foreground tabular-nums">
            {t("plan.targetWeight.healthyRange", { min: fmtKg(ideal.minKg), max: fmtKg(ideal.maxKg) })}
          </p>
          {draft.goal === "gain" && target !== null && bmiOf(target, heightCm) > HEALTHY_BMI_MAX && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("gain:target.aboveHealthy", { min: fmtKg(ideal.minKg), max: fmtKg(ideal.maxKg) })}
            </p>
          )}
          <p className="text-sm text-muted-foreground tabular-nums">
            {t("plan.targetDate.title")}: {fmtDateLong(draft.date).replace(/^\w+, /, "")}
          </p>
          {gainCheck && isGainCheck(gainCheck) && (
            <GainDateVerdict
              check={gainCheck}
              today={today}
              onUseDate={(days) => setDraft({ ...draft, date: shiftDate(today, days) })}
            />
          )}
        </>
      )}

      {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
      {serverError && <p className="text-sm font-semibold text-destructive">{serverError}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t("state.saving") : t("common:actions.save")}
      </Button>
    </form>
  );
}
