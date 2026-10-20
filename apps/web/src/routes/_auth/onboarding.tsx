import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, isRedirect, redirect, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CalendarDays, CircleAlert, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  checkTargetDate,
  idealWeightRange,
  jakartaToday,
  KCAL_PER_KG_FAT,
  MAX_DEFICIT_KCAL,
  MAX_TARGET_DAYS,
} from "@joyorogo/api/lib/engine";
import type { ActivityLevel, Gender } from "@joyorogo/api/lib/engine";
import { activityOptions } from "@joyorogo/api/lib/activity-guide";
import type { ActivityOption } from "@joyorogo/api/lib/activity-guide";
import { resolveMaternalInput } from "@joyorogo/api/lib/maternal";
import type { MaternalState } from "@joyorogo/api/lib/maternal";
import { goalTargetError } from "@joyorogo/api/lib/gain";
import type { Goal } from "@joyorogo/api/lib/gain";
import { Button } from "@joyorogo/ui/components/button";
import { Calendar } from "@joyorogo/ui/components/calendar";
import { Input } from "@joyorogo/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@joyorogo/ui/components/popover";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";
import { ActivityLevelPicker } from "@/components/activity-level-picker";
import { ActivityRecommendations } from "@/components/activity-recommendations";
import { Mascot } from "@/components/mascot";
import { Page } from "@/components/kit/surface";
import { PlanNumbers } from "@/components/plan-numbers";
import { trackConversion } from "@/lib/analytics";
import {
  fmtDateLong,
  fmtDateMedium,
  fmtKcalLabel,
  fmtKg,
  jakartaDatePlusDays,
  parseNum,
} from "@/lib/format";
import { InfoAccordion } from "@/components/onboarding/info-accordion";
import { InviteFriendsStep } from "@/components/onboarding/invite-step";
import { useSession } from "@/lib/auth-client";
import { MaternalDisclaimer } from "@/components/maternal/disclaimer";
import { MaternalOnboardingResult } from "@/components/maternal/onboarding-result";
import {
  emptyMaternalDraft,
  MaternalForm,
  maternalDraftToInput,
} from "@/components/maternal/maternal-form";
import type { MaternalDraft } from "@/components/maternal/maternal-form";
import { GainDateVerdict, isGainCheck } from "@/components/gain/gain-date-verdict";
import { GoalChooser } from "@/components/gain/goal-chooser";
import { GOAL_ERROR_KEY, planForGoal, typedGoal } from "@/components/gain/goal-plan";
import { GainOnboardingResult } from "@/components/gain/onboarding-result";
import { orpc } from "@/utils/orpc";

const profileOptions = orpc.profile.myProfile.queryOptions();

export const Route = createFileRoute("/_auth/onboarding")({
  loader: async ({ context }) => {
    try {
      const existing = await context.queryClient.ensureQueryData(profileOptions);
      if (existing.profile) throw redirect({ to: "/" });
    } catch (error) {
      if (isRedirect(error)) throw error;
      // Server unreachable: still render the form; saving surfaces the error.
    }
  },
  pendingComponent: OnboardingSkeleton,
  component: OnboardingPage,
});

type FormState = {
  birthYear: string;
  gender: Gender | "";
  heightCm: string;
  weightKg: string;
  activityLevel: ActivityLevel;
  targetWeightKg: string;
  targetDate: string;
  /** answer to "Sedang hamil atau menyusui?" (only asked of women) */
  maternalChoice: "pregnant" | "breastfeeding" | "none";
  maternal: MaternalDraft;
  /** the chooser's pick; null = follows the target (above the weight is gain) */
  goal: Goal | null;
};

type StepKey =
  | "birth"
  | "gender"
  | "maternal"
  | "maternalForm"
  | "height"
  | "weight"
  | "activity"
  | "target"
  | "date";

function GuideLink({ label }: { label: string }) {
  return (
    <a
      href="https://joyorogo.com/panduan/kalori"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block px-1 text-sm font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
    >
      {label}
    </a>
  );
}

/**
 * The five levels for the answers so far, computed here (no server call): the plan the server will build on save. Hamil /
 * Menyusui use their own factors, so the draft is resolved to the stored state first. Empty while an answer is missing.
 */
function onboardingActivityOptions(
  form: FormState,
  maternalDraft: MaternalDraft | null,
  goal: Goal,
): ActivityOption[] {
  const birthYear = parseNum(form.birthYear);
  const height = parseNum(form.heightCm);
  const weight = parseNum(form.weightKg);
  if (birthYear === null || form.gender === "" || height === null || weight === null) return [];
  const today = jakartaToday();
  let maternal: MaternalState | null = null;
  if (maternalDraft) {
    const draft = maternalDraftToInput(maternalDraft);
    const resolved = draft.ok ? resolveMaternalInput(draft.input, today) : null;
    if (!resolved?.ok) return [];
    maternal = resolved.state;
  }
  const holding = maternal !== null || goal === "maintain";
  const targetWeight = parseNum(form.targetWeightKg);
  return activityOptions(
    {
      birthYear,
      gender: form.gender,
      heightCm: height,
      weightKg: weight,
      targetWeightKg: holding ? weight : (targetWeight ?? weight),
      targetDate: holding ? jakartaDatePlusDays(365) : form.targetDate,
      activityLevel: form.activityLevel,
      goal: maternal !== null ? undefined : goal,
    },
    maternal,
    weight,
    today,
  );
}

/** Big tappable answer tile; selected state uses the brand tint. */
function ChoiceTile({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "pressable flex min-h-20 items-center justify-center rounded-2xl bg-card px-3 py-4 text-center text-[0.9375rem] leading-snug font-bold focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
        active && "bg-makan-soft ring-2 ring-makan",
      )}
    >
      {children}
    </button>
  );
}

/** Big centered numeric field with a unit suffix; spinners off, they fight the suffix. */
function BigNumberField({
  id,
  label,
  value,
  onValueChange,
  unit,
  step,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  unit: string;
  step?: string;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        aria-label={label}
        autoFocus
        type="number"
        inputMode="decimal"
        step={step}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className="h-16 pr-14 text-center text-3xl font-extrabold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span className="pointer-events-none absolute top-1/2 right-5 -translate-y-1/2 text-base font-semibold text-muted-foreground">
        {unit}
      </span>
    </div>
  );
}

function OnboardingPage() {
  const { t } = useTranslation(["onboarding", "common", "settings", "maternal", "gain"]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [done, setDone] = useState(false);
  const [inviting, setInviting] = useState(false);
  const session = useSession();
  const [form, setForm] = useState<FormState>({
    birthYear: "1995",
    gender: "",
    heightCm: "165",
    weightKg: "70",
    activityLevel: "light",
    targetWeightKg: "65",
    targetDate: jakartaDatePlusDays(90),
    maternalChoice: "none",
    maternal: emptyMaternalDraft("pregnant"),
    goal: null,
  });
  const [error, setError] = useState<string | null>(null);

  const save = useMutation(
    orpc.profile.upsert.mutationOptions({
      onSuccess: () => {
        // Everything (summary, weigh-in, plan) derives from the profile. The
        // cached "no profile yet" answers must go, not just turn stale: route
        // loaders (ensureQueryData) would serve them again and bounce
        // Beranda straight back here until a manual refresh.
        queryClient.removeQueries({ queryKey: orpc.profile.key() });
        queryClient.removeQueries({ queryKey: orpc.day.key() });
        queryClient.invalidateQueries();
        setDone(true);
        trackConversion("onboarding_complete");
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  const set = (patch: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...patch }));
    setError(null);
  };

  const height = parseNum(form.heightCm);
  const weight = parseNum(form.weightKg);
  const birthYear = parseNum(form.birthYear);
  const targetWeight = parseNum(form.targetWeightKg);
  const ideal = height !== null && height >= 100 && height <= 250 ? idealWeightRange(height) : null;
  const effectiveGoal: Goal = form.goal ?? typedGoal(weight, targetWeight);
  const derivedGain = form.goal === null && effectiveGoal === "gain";

  // Hamil / Menyusui: only asked of women. The maternal path swaps the two
  // target-weight questions for the maternal form (no deficit, no target).
  const maternalMode =
    form.gender === "female" &&
    (form.maternalChoice === "pregnant" || form.maternalChoice === "breastfeeding")
      ? form.maternalChoice
      : null;
  const steps: StepKey[] = [
    "birth",
    "gender",
    ...(form.gender === "female" ? (["maternal"] as const) : []),
    ...(maternalMode ? (["maternalForm"] as const) : []),
    "height",
    "weight",
    ...(maternalMode
      ? []
      : effectiveGoal === "maintain"
        ? (["target"] as const)
        : (["target", "date"] as const)),
    "activity",
  ];
  const STEP_COUNT = steps.length;
  const key: StepKey = steps[step - 1] ?? "birth";
  const last = step === STEP_COUNT;
  const maternalDraft: MaternalDraft | null = maternalMode
    ? { ...form.maternal, mode: maternalMode }
    : null;

  // What each level would give THIS person, from the answers so far (the plan the server will build on save).
  // The step comes last so the target weight and date are the real ones. Never blocks: no data, no options.
  const guide = useQuery(orpc.profile.activityGuide.queryOptions({ enabled: key === "activity", retry: false }));
  const activityChoices =
    key === "activity" ? onboardingActivityOptions(form, maternalDraft, effectiveGoal) : [];

  // Same checks as before, now one step at a time so the error always sits
  // next to the question it belongs to. The final step re-validates the whole
  // form exactly like the old single submit did.
  const validateStep = (current: StepKey): boolean => {
    switch (current) {
      case "birth":
        if (
          birthYear === null ||
          !Number.isInteger(birthYear) ||
          birthYear < 1930 ||
          birthYear > 2020
        ) {
          setError(t("error.birthYear"));
          return false;
        }
        return true;
      case "gender":
        if (form.gender === "") {
          setError(t("error.gender"));
          return false;
        }
        return true;
      case "maternalForm": {
        const result = maternalDraft ? maternalDraftToInput(maternalDraft) : null;
        if (result && !result.ok) {
          setError(t(`maternal:form.error.${result.error}`));
          return false;
        }
        return true;
      }
      case "height":
        if (height === null || height < 100 || height > 250) {
          setError(t("error.height"));
          return false;
        }
        return true;
      case "weight":
        if (weight === null || weight < 25 || weight > 400) {
          setError(t("error.weight"));
          return false;
        }
        return true;
      case "target": {
        if (effectiveGoal === "maintain") return true;
        if (targetWeight === null || targetWeight < 25 || targetWeight > 400) {
          setError(t("error.targetWeight"));
          return false;
        }
        const goalError = weight === null ? null : goalTargetError(effectiveGoal, weight, targetWeight);
        if (goalError) {
          setError(t(GOAL_ERROR_KEY[goalError]));
          return false;
        }
        return true;
      }
      default:
        return true;
    }
  };

  const next = () => {
    if (last) {
      if (birthYear === null || form.gender === "" || height === null || weight === null) {
        setStep(1);
        return;
      }
      if (maternalDraft) {
        const result = maternalDraftToInput(maternalDraft);
        if (!result.ok) {
          setError(t(`maternal:form.error.${result.error}`));
          setStep(steps.indexOf("maternalForm") + 1);
          return;
        }
        setError(null);
        save.mutate({
          birthYear,
          gender: form.gender,
          heightCm: height,
          weightKg: weight,
          activityLevel: form.activityLevel,
          maternal: result.input,
        });
        return;
      }
      if (effectiveGoal === "maintain") {
        setError(null);
        save.mutate({
          birthYear,
          gender: form.gender,
          heightCm: height,
          weightKg: weight,
          goal: "maintain",
          targetWeightKg: weight,
          targetDate: jakartaDatePlusDays(365),
          activityLevel: form.activityLevel,
        });
        return;
      }
      if (targetWeight === null || targetWeight < 25 || targetWeight > 400) {
        setError(t("error.targetWeight"));
        setStep(steps.indexOf("target") + 1);
        return;
      }
      const goalError = goalTargetError(effectiveGoal, weight, targetWeight);
      if (goalError) {
        setError(t(GOAL_ERROR_KEY[goalError]));
        setStep(steps.indexOf("target") + 1);
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.targetDate) || form.targetDate < jakartaToday()) {
        setError(t("error.targetDatePast"));
        setStep(steps.indexOf("date") + 1);
        return;
      }
      setError(null);
      save.mutate({
        birthYear,
        gender: form.gender,
        heightCm: height,
        weightKg: weight,
        goal: effectiveGoal,
        targetWeightKg: targetWeight,
        targetDate: form.targetDate,
        activityLevel: form.activityLevel,
      });
      return;
    }
    if (!validateStep(key)) return;
    setError(null);
    setStep(step + 1);
  };

  const back = () => {
    setError(null);
    setStep(step - 1);
  };

  const openApp = () =>
    navigate({ to: "/pro", search: { from: "onboarding", next: "/beranda" } });

  if (done && save.data?.targets && inviting) {
    const firstName = session.data?.user.name?.trim().split(/\s+/)[0];
    return (
      <InviteFriendsStep
        defaultName={
          firstName
            ? t("invite.defaultName", { name: firstName }).slice(0, 40)
            : t("invite.defaultNameBare")
        }
        onSkip={openApp}
        onOpenGroup={(groupId) => navigate({ to: "/grup/$groupId", params: { groupId } })}
      />
    );
  }

  if (done && save.data?.targets) {
    const { targets } = save.data;
    return (
      <Page className="max-w-xl">
        <header className="px-1 pt-2 pb-4">
          <Mascot pose="cheer" size="sm" eager className="mx-0 mb-2" />
          <h1 className="text-[1.75rem] leading-tight font-extrabold tracking-tight">
            {t("result.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("result.subtitle")}</p>
        </header>
        {targets.maternal ? (
          <MaternalOnboardingResult targets={targets} info={targets.maternal} />
        ) : targets.gain ? (
          <GainOnboardingResult targets={targets} gain={targets.gain} />
        ) : (
          <>
            <PlanNumbers targets={targets} />
            {targets.notes.includes("BELOW_HEALTHY_RANGE") && (
              <p className="mt-3 rounded-2xl bg-destructive/10 px-4 py-3 text-sm leading-snug font-medium text-destructive">
                {t("result.belowRange", {
                  min: fmtKg(targets.idealMinKg),
                  max: fmtKg(targets.idealMaxKg),
                })}
              </p>
            )}
            {targets.notes.includes("PLAN_CLAMPED") && (
              <p className="mt-3 rounded-2xl bg-muted px-4 py-3 text-sm leading-snug font-medium text-muted-foreground">
                {t("settings:plan.noteShort.PLAN_CLAMPED")}
              </p>
            )}
            {targets.notes.includes("MAINTENANCE") && (
              <div className="mt-3">
                <InfoAccordion title={t("result.aboutTitle")}>
                  <p>{t("settings:plan.noteShort.MAINTENANCE")}</p>
                </InfoAccordion>
              </div>
            )}
          </>
        )}
        <p className="mt-4 px-1 text-sm leading-snug text-muted-foreground">{t("guide.later")}</p>
        <div className="mt-1">
          <GuideLink label={t("guide.result")} />
        </div>
        <Button className="mt-6 w-full" onClick={openApp}>
          {t("action.openHome")}
        </Button>
        <Button variant="secondary" className="mt-2 w-full" onClick={() => setInviting(true)}>
          <Users aria-hidden />
          {t("action.inviteFriends")}
        </Button>
      </Page>
    );
  }

  const dateCheck =
    weight !== null && targetWeight !== null && height !== null
      ? checkTargetDate({
          weightNowKg: weight,
          targetWeightKg: targetWeight,
          targetDate: form.targetDate,
          goal: effectiveGoal,
          heightCm: height,
        })
      : null;
  const lossCheck = dateCheck?.status === "fast" ? dateCheck : null;
  const tooFast = lossCheck && {
    days: lossCheck.days,
    lossKg: lossCheck.lossKg,
    rawDeficit: lossCheck.rawDeficitKcal,
    feasibleDays: lossCheck.feasibleDays,
  };
  const gainCheck = dateCheck && isGainCheck(dateCheck) ? dateCheck : null;

  const chooseGoal = (goal: Goal) => {
    const plan = goal === effectiveGoal || weight === null ? null : planForGoal(goal, weight, height);
    set(
      plan
        ? { goal, targetWeightKg: String(plan.targetKg), targetDate: jakartaDatePlusDays(plan.days) }
        : { goal },
    );
  };

  const titles: Record<StepKey, string> = {
    birth: t("question.birth.title"),
    gender: t("question.gender.title"),
    maternal: t("maternal:entry.question"),
    maternalForm: maternalMode
      ? t(maternalMode === "pregnant" ? "maternal:form.pregnantTitle" : "maternal:form.breastfeedingTitle")
      : "",
    height: t("question.height.title"),
    weight: t("question.weight.title"),
    activity: t("question.activity.title"),
    target: t("question.target.title"),
    date: t("question.date.title"),
  };
  const hints: Record<StepKey, string> = {
    birth: t("question.birth.hint"),
    gender: t("question.gender.hint"),
    maternal: t("maternal:entry.hint"),
    maternalForm: "",
    height: "",
    weight: maternalMode ? t("maternal:form.currentWeight.hint") : t("question.weight.hint"),
    activity: t("question.activity.hint"),
    target: "",
    date: "",
  };
  const hint = hints[key];

  return (
    <Page className="max-w-xl">
      <header className="pt-2">
        <div className="flex items-center justify-between px-1">
          <img src="/brand/logo-mark.svg" alt="" className="h-7 w-auto" />
          <p className="text-xs font-semibold text-muted-foreground tabular-nums">
            {step}/{STEP_COUNT}
          </p>
        </div>
        <div
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={STEP_COUNT}
          aria-valuenow={step}
          aria-label={t("progress", { step, total: STEP_COUNT })}
          className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
            style={{ width: `${(step / STEP_COUNT) * 100}%` }}
          />
        </div>
      </header>

      <div className="mt-8">
        <h1 className="text-[1.75rem] leading-tight font-extrabold tracking-tight">
          {titles[key]}
        </h1>
        {hint && (
          <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">{hint}</p>
        )}

        <div className="mt-6">
          {key === "birth" && (
            <div className="relative">
              <Input
                id="birth-year"
                aria-label={t("question.birth.label")}
                autoFocus
                type="number"
                inputMode="numeric"
                min="1930"
                max="2020"
                value={form.birthYear}
                onChange={(event) => set({ birthYear: event.target.value })}
                className="h-16 pr-14 text-center text-3xl font-extrabold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="pointer-events-none absolute top-1/2 right-5 -translate-y-1/2 text-base font-semibold text-muted-foreground">
                {t("question.birth.unit")}
              </span>
            </div>
          )}

          {key === "gender" && (
            <div className="grid grid-cols-2 gap-3">
              <ChoiceTile active={form.gender === "male"} onClick={() => set({ gender: "male" })}>
                {t("settings:profile.gender.male")}
              </ChoiceTile>
              <ChoiceTile
                active={form.gender === "female"}
                onClick={() => set({ gender: "female" })}
              >
                {t("settings:profile.gender.female")}
              </ChoiceTile>
            </div>
          )}

          {key === "maternal" && (
            <div className="space-y-3">
              {(
                [
                  ["pregnant", "entry.pregnant", "entry.pregnantHint"],
                  ["breastfeeding", "entry.breastfeeding", "entry.breastfeedingHint"],
                  ["none", "entry.neither", null],
                ] as const
              ).map(([choice, title, hintKey]) => (
                <button
                  key={choice}
                  type="button"
                  aria-pressed={form.maternalChoice === choice}
                  onClick={() => set({ maternalChoice: choice })}
                  className={cn(
                    "pressable flex min-h-16 w-full flex-col justify-center rounded-2xl bg-card px-5 py-3 text-left focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
                    form.maternalChoice === choice && "bg-makan-soft ring-2 ring-makan",
                  )}
                >
                  <span className="text-[0.9375rem] font-bold">{t(`maternal:${title}`)}</span>
                  {hintKey && (
                    <span className="text-sm text-muted-foreground">{t(`maternal:${hintKey}`)}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {key === "maternalForm" && maternalMode && (
            <div className="space-y-6">
              <MaternalForm
                draft={{ ...form.maternal, mode: maternalMode }}
                onChange={(patch) => set({ maternal: { ...form.maternal, ...patch } })}
              />
              <MaternalDisclaimer />
            </div>
          )}

          {key === "height" && (
            <BigNumberField
              id="height"
              label={t("question.height.label")}
              value={form.heightCm}
              onValueChange={(value) => set({ heightCm: value })}
              unit="cm"
            />
          )}

          {key === "weight" && (
            <BigNumberField
              id="weight-now"
              label={t("question.weight.label")}
              value={form.weightKg}
              onValueChange={(value) => set({ weightKg: value })}
              unit="kg"
              step="0.1"
            />
          )}

          {key === "activity" && (
            <div className="space-y-4">
              <ActivityLevelPicker
                options={activityChoices}
                value={form.activityLevel}
                onSelect={(level) => set({ activityLevel: level })}
                maternal={maternalMode !== null}
              />
              <ActivityRecommendations
                steps={guide.data?.steps ?? null}
                calibration={null}
                options={activityChoices}
                current={form.activityLevel}
                applyingLevel={null}
                onApply={(level) => set({ activityLevel: level })}
                showEmpty={false}
              />
              <GuideLink label={t("guide.activity")} />
            </div>
          )}

          {key === "target" && (
            <div className="space-y-3">
              <GoalChooser value={effectiveGoal} onChange={chooseGoal} />
              {derivedGain && (
                <p className="px-1 text-sm leading-snug text-muted-foreground">
                  {t("gain:goal.derivedGain")}
                </p>
              )}
              {effectiveGoal === "maintain" ? (
                <p className="px-1 text-sm leading-snug text-muted-foreground">
                  {t("gain:goal.maintainNote")}
                </p>
              ) : (
                <>
                  <BigNumberField
                    id="target-weight"
                    label={t("question.target.label")}
                    value={form.targetWeightKg}
                    onValueChange={(value) => set({ targetWeightKg: value, goal: null })}
                    unit="kg"
                    step="0.1"
                  />
                  {ideal && (
                    <p className="text-sm text-muted-foreground tabular-nums">
                      {t("question.target.healthyRange", {
                        min: fmtKg(ideal.minKg),
                        max: fmtKg(ideal.maxKg),
                      })}
                    </p>
                  )}
                  {ideal && effectiveGoal === "lose" && targetWeight !== null && targetWeight < ideal.minKg && (
                    <p className="text-sm leading-snug text-destructive">
                      {t("question.target.belowRange")}
                    </p>
                  )}
                  {ideal && effectiveGoal === "gain" && targetWeight !== null && targetWeight > ideal.maxKg && (
                    <p className="text-sm leading-snug text-muted-foreground">
                      {t("gain:target.aboveHealthy", {
                        min: fmtKg(ideal.minKg),
                        max: fmtKg(ideal.maxKg),
                      })}
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {key === "date" && (
            <div className="space-y-3">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    id="target-date"
                    aria-label={t("question.date.label")}
                    variant="secondary"
                    className="h-16 w-full justify-center rounded-xl text-lg font-extrabold tracking-tight"
                  >
                    <CalendarDays className="size-5 text-muted-foreground" aria-hidden />
                    {fmtDateLong(form.targetDate).replace(/^\w+, /, "")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={new Date(`${form.targetDate}T00:00:00`)}
                    defaultMonth={new Date(`${form.targetDate}T00:00:00`)}
                    disabled={{ before: new Date() }}
                    onSelect={(day) => {
                      if (day) {
                        set({
                          targetDate: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`,
                        });
                      }
                    }}
                  />
                </PopoverContent>
              </Popover>

              {tooFast && (
                <div className="rounded-2xl bg-bakar-soft p-3.5">
                  <p className="flex items-start gap-1.5 text-sm leading-snug font-bold text-bakar-ink">
                    <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {t("tooFast.title", { kcal: fmtKcalLabel(tooFast.rawDeficit) })}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="mt-2.5"
                    onClick={() => set({ targetDate: jakartaDatePlusDays(tooFast.feasibleDays) })}
                  >
                    {t("tooFast.cta", { count: tooFast.feasibleDays })}
                  </Button>
                </div>
              )}

              {gainCheck && (
                <GainDateVerdict
                  check={gainCheck}
                  today={jakartaToday()}
                  onUseDate={(days) =>
                    set({ targetDate: jakartaDatePlusDays(Math.min(days, MAX_TARGET_DAYS)) })
                  }
                />
              )}
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-4 text-sm font-semibold text-destructive">
            {error}
          </p>
        )}

        {key === "weight" && (
          <div className="mt-4">
            <InfoAccordion title={t("info.title")}>
              <p>{t("question.weight.why")}</p>
            </InfoAccordion>
          </div>
        )}
        {key === "date" && (
          <div className="mt-4">
            <InfoAccordion title={t("info.title")}>
              <p>{t("question.date.why")}</p>
              {tooFast && (
                <p>
                  {t("tooFast.detail", {
                    count: tooFast.feasibleDays,
                    cap: fmtKcalLabel(MAX_DEFICIT_KCAL),
                    kg: fmtKg(tooFast.lossKg),
                    reach: fmtKg(
                      Math.round(((MAX_DEFICIT_KCAL * tooFast.days) / KCAL_PER_KG_FAT) * 10) / 10,
                    ),
                    date: fmtDateMedium(form.targetDate),
                  })}
                </p>
              )}
            </InfoAccordion>
          </div>
        )}
      </div>

      <div className="mt-8 flex items-center gap-3">
        {step > 1 && (
          <Button variant="secondary" onClick={back} disabled={save.isPending}>
            <ArrowLeft className="size-[1.125rem]" aria-hidden />
            {t("common:actions.back")}
          </Button>
        )}
        <Button className="flex-1" onClick={next} disabled={save.isPending}>
          {last
            ? save.isPending
              ? t("action.saving")
              : t("action.save")
            : t("action.next")}
        </Button>
      </div>
    </Page>
  );
}

function OnboardingSkeleton() {
  const { t } = useTranslation("onboarding");
  return (
    <Page className="max-w-xl" aria-busy="true" aria-label={t("loading")}>
      <div className="flex items-center justify-between px-1 pt-2">
        <Skeleton className="h-7 w-28 rounded-full" />
        <Skeleton className="h-4 w-10 rounded-full" />
      </div>
      <Skeleton className="mt-4 h-1.5 rounded-full" />
      <div className="mt-8 px-1">
        <Skeleton className="h-8 w-64 rounded-full" />
        <Skeleton className="mt-2 h-4 w-52 rounded-full" />
      </div>
      <Skeleton className="mt-6 h-16 rounded-xl" />
      <div className="mt-8 flex gap-3">
        <Skeleton className="h-12 flex-1 rounded-full" />
      </div>
    </Page>
  );
}
