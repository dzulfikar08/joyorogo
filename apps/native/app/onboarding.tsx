import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Pressable, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import {
  type ActivityLevel,
  checkTargetDate,
  jakartaToday,
  idealWeightRange,
  MAX_TARGET_DAYS,
  shiftDate,
  type TargetDateCheck,
  type Targets,
} from "@joyorogo/api/lib/engine";
import {
  bmiOf,
  goalOf,
  goalTargetError,
  HEALTHY_BMI_MAX,
  MAX_SURPLUS_KCAL,
  suggestedDays,
  suggestGainTarget,
  UNDERWEIGHT_BMI,
  type GainInfo,
  type Goal,
} from "@joyorogo/api/lib/gain";
import { activityOptions } from "@joyorogo/api/lib/activity-guide";
import { resolveMaternalInput, type MaternalInfo } from "@joyorogo/api/lib/maternal";
import { fmtNumber } from "@joyorogo/i18n";

import {
  BootLoader,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  Screen,
  StatTile,
  Text,
} from "@/components/ui";
import { Mascot } from "@/components/mascot";
import { EASE_OUT, PressableScale, useActivePop, useEnter } from "@/components/motion";
import { useSessionGate } from "@/lib/use-session-gate";
import { authClient } from "@/lib/auth-client";
import { InviteFriendsStep } from "@/components/onboarding/invite-step";
import { Disclosure } from "@/components/disclosure";
import { ActivityLevelPicker, ActivityRecommendations } from "@/components/profil/activity-level-picker";
import { GainDisclaimer, GainNotes } from "@/components/gain/gain-notes";
import { GoalChooser } from "@/components/gain/goal-chooser";
import { MaternalDisclaimer } from "@/components/maternal/disclaimer";
import { MaternalFlagNotes } from "@/components/maternal/flag-notes";
import {
  draftToInput,
  emptyDraft,
  MaternalForm,
  type MaternalDraft,
} from "@/components/maternal/maternal-form";
import { useStageText } from "@/components/maternal/use-maternal";
import { ManualTdeeForm } from "@/components/manual-tdee";
import { errorMessage, fmtDateMedium, fmtInt, fmtKg, parseNum } from "@/utils/format";
import { client, orpc } from "@/utils/orpc";

type Gender = "male" | "female";

type StepId = "birth" | "gender" | "maternalEntry" | "maternalForm" | "height" | "weight" | "goal" | "activity";
type MaternalChoice = "none" | "pregnant" | "breastfeeding";

function defaultTargetDate(): string {
  const day = new Date(`${jakartaToday()}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 90);
  return day.toISOString().slice(0, 10);
}

/** One progress segment: the fill scales in from the left when it becomes reached. */
function ProgressSegment({ filled }: { filled: boolean }) {
  const reduceMotion = useReducedMotion();
  const p = useSharedValue(filled ? 1 : 0);
  useEffect(() => {
    p.value = withTiming(filled ? 1 : 0, { duration: 260, easing: EASE_OUT });
  }, [filled, p]);
  const fillStyle = useAnimatedStyle(() =>
    reduceMotion ? { opacity: p.value } : { opacity: 1, transform: [{ scaleX: p.value }] },
  );
  return (
    <View style={styles.progressTrack}>
      <Animated.View style={[styles.progressFill, fillStyle]} />
    </View>
  );
}

/** Keyed wrapper: remounts per step so the content fades and rises in. */
function StepView({ children }: { children: ReactNode }) {
  const enter = useEnter();
  return (
    <Animated.View entering={enter} style={styles.stepView}>
      {children}
    </Animated.View>
  );
}

/** Big single-select choice row for onboarding questions. */
function ChoiceRow({
  label,
  description,
  selected,
  onPress,
}: {
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { theme } = useUnistyles();
  const iconPop = useActivePop(selected);
  const fill = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    fill.value = withTiming(selected ? 1 : 0, { duration: 200, easing: EASE_OUT });
  }, [selected, fill]);
  const fillStyle = useAnimatedStyle(() => ({ opacity: fill.value }));
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      scaleTo={0.98}
      style={[styles.choice, { backgroundColor: theme.colors.muted }]}
    >
      <Animated.View pointerEvents="none" style={[styles.choiceFill, fillStyle]} />
      <View style={styles.choiceText}>
        <Text
          style={[
            styles.choiceLabel,
            { color: selected ? theme.colors.makanText : theme.colors.foreground },
          ]}
        >
          {label}
        </Text>
        {description ? (
          <Text
            style={[
              styles.choiceDesc,
              { color: selected ? theme.colors.makanText : theme.colors.mutedForeground },
            ]}
          >
            {description}
          </Text>
        ) : null}
      </View>
      <Animated.View style={iconPop}>
        <Ionicons
          name={selected ? "checkmark-circle" : "ellipse-outline"}
          size={24}
          color={selected ? theme.colors.primary : theme.colors.mutedForeground}
        />
      </Animated.View>
    </PressableScale>
  );
}

const GUIDE_URL = "https://joyorogo.com/panduan/kalori";

function GuideLink({ label }: { label: string }) {
  return (
    <Pressable
      accessibilityRole="link"
      hitSlop={8}
      onPress={() => void WebBrowser.openBrowserAsync(GUIDE_URL)}
    >
      <Text style={styles.guideLink}>{label}</Text>
    </Pressable>
  );
}

/** Result of onboarding: deficit plan summary, or the Hamil / Menyusui numbers (no deficit). */
function ResultView({
  targets,
  onTargets,
  onStart,
  onInvite,
}: {
  targets: Targets;
  /** the plan the server rebuilt after a typed TDEE */
  onTargets: (targets: Targets) => void;
  onStart: () => void;
  onInvite: () => void;
}) {
  const { t } = useTranslation(["onboarding", "common", "settings", "maternal", "energy"]);
  const [tdeeOpen, setTdeeOpen] = useState(false);
  return (
    <>
      <Mascot pose="cheer" size="sm" style={styles.resultMascot} />
      <Text style={styles.stepTitle}>{t("result.title")}</Text>
      {targets.maternal ? (
        <MaternalResult targets={targets} info={targets.maternal} />
      ) : (
        <>
          <View style={styles.planTiles}>
            <StatTile
              icon="restaurant"
              tint="makan"
              label={t("settings:plan.numbers.eat")}
              value={fmtInt(targets.eatKcal)}
              sub={t("settings:plan.numbers.perDay")}
            />
            <StatTile
              icon="flame"
              tint="bakar"
              label={t("settings:plan.numbers.burn")}
              value={fmtInt(targets.burnKcal)}
              sub={t("settings:plan.numbers.perDay")}
            />
            <StatTile
              icon="moon"
              tint="tidur"
              label={t("settings:plan.numbers.sleep")}
              value={fmtKg(targets.sleepHours)}
              sub={t("settings:plan.numbers.perNight")}
            />
          </View>
          {targets.gain ? <GainResult targets={targets} gain={targets.gain} /> : null}
          {targets.notes.includes("BELOW_HEALTHY_RANGE") ? (
            <Text style={styles.warning}>
              {t("result.belowRange", {
                min: fmtKg(targets.idealMinKg),
                max: fmtKg(targets.idealMaxKg),
              })}
            </Text>
          ) : null}
          {targets.notes.includes("PLAN_CLAMPED") ? (
            <Text style={styles.warning}>{t("settings:plan.noteShort.PLAN_CLAMPED")}</Text>
          ) : null}
          <Disclosure title={t("result.aboutTitle")}>
            <Text style={styles.hint}>{t("result.meaning.eat")}</Text>
            <Text style={styles.hint}>{t("result.meaning.burn")}</Text>
            <Text style={styles.hint}>{t("result.meaning.sleep")}</Text>
            {targets.notes.includes("MAINTENANCE") ? (
              <Text style={styles.hint}>{t("settings:plan.noteShort.MAINTENANCE")}</Text>
            ) : null}
          </Disclosure>
        </>
      )}
      {targets.manualTdee ? (
        tdeeOpen ? (
          <Card>
            <Text style={styles.hint}>{t("energy:manual.subtitle")}</Text>
            <ManualTdeeForm info={targets.manualTdee} onSaved={onTargets} />
          </Card>
        ) : (
          <Button
            variant="ghost"
            label={
              targets.manualTdee.kcal === null
                ? t("energy:manual.onboardingLink")
                : t("energy:manual.active", { kcal: fmtInt(targets.manualTdee.kcal) })
            }
            onPress={() => setTdeeOpen(true)}
          />
        )
      ) : null}
      <Text style={styles.hint}>{t("guide.later")}</Text>
      <GuideLink label={t("guide.result")} />
      <Button label={t("action.openHome")} onPress={onStart} />
      <Button
        variant="secondary"
        icon="people-outline"
        label={t("action.inviteFriends")}
        onPress={onInvite}
      />
    </>
  );
}

/** Naikin BB result: BMR + surplus = target, then pace, reach date and protein. */
function GainResult({ targets, gain }: { targets: Targets; gain: GainInfo }) {
  const { t } = useTranslation(["gain", "settings"]);
  return (
    <>
      <Card>
        <View style={styles.maternalLine}>
          <Text style={styles.hint}>{t("settings:plan.needs.tdee.label")}</Text>
          <Text style={styles.maternalValue}>
            {fmtInt(targets.tdee)} {t("settings:plan.needs.unit")}
          </Text>
        </View>
        <View style={styles.maternalLine}>
          <Text style={styles.hint}>{t("gain:plan.surplus.label")}</Text>
          <Text style={styles.maternalValue}>
            + {fmtInt(gain.surplusKcal)} {t("settings:plan.needs.unit")}
          </Text>
        </View>
        <View style={styles.maternalLine}>
          <Text style={styles.hint}>{t("settings:plan.needs.target.label")}</Text>
          <Text style={styles.maternalValue}>
            {fmtInt(targets.eatKcal)} {t("settings:plan.needs.unit")}
          </Text>
        </View>
        <Text style={styles.hint}>{t("gain:plan.intro")}</Text>
      </Card>
      <Card>
        <Text style={styles.hint}>
          {t("gain:plan.pace", {
            kg: fmtNumber(gain.paceKgPerWeek, 2),
            pct: fmtNumber(gain.pacePct, 2),
          })}
        </Text>
        <Text style={styles.hint}>
          {t("gain:plan.reach", { date: fmtDateMedium(gain.reachDate) })}
        </Text>
        <Text style={styles.hint}>
          {t("gain:plan.protein", {
            min: gain.protein.minG,
            max: gain.protein.maxG,
            target: gain.protein.targetG,
          })}
        </Text>
        <Text style={styles.hint}>{t("gain:plan.proteinHint")}</Text>
        <Text style={styles.hint}>{t("gain:plan.leanNote")}</Text>
      </Card>
      <GainNotes gain={gain} />
      <GainDisclaimer />
    </>
  );
}

/** Verdict of the typed date for a gain target: a note, or a warning with a button for a later date. Never blocks. */
function GainDateNote({
  check,
  onUseDate,
}: {
  check: TargetDateCheck;
  onUseDate: (date: string) => void;
}) {
  const { t } = useTranslation("gain");
  if (check.status !== "gainOk" && check.status !== "gainFast" && check.status !== "gainSlow") {
    return null;
  }
  const today = jakartaToday();
  const later = shiftDate(today, check.feasibleDays);
  if (check.status === "gainOk") {
    return (
      <Text style={styles.hint}>
        {t(check.band === "lean" ? "date.ok.lean" : "date.ok.brisk", {
          kg: fmtKg(check.gainKg),
          count: check.days,
          perWeek: fmtNumber(check.weeklyKg, 2),
          pct: fmtNumber(check.pacePct, 2),
        })}
      </Text>
    );
  }
  if (check.status === "gainFast") {
    return (
      <>
        <Text style={styles.warning}>
          {check.rawSurplusKcal > MAX_SURPLUS_KCAL
            ? t("date.fast.titleSurplus", { surplus: fmtInt(check.rawSurplusKcal), max: MAX_SURPLUS_KCAL })
            : t("date.fast.title", {
                perWeek: fmtNumber(check.weeklyKg, 2),
                pct: fmtNumber(check.pacePct, 2),
              })}
        </Text>
        <Text style={styles.hint}>
          {t("date.fast.body", { kg: fmtKg(check.gainKg), count: check.feasibleDays })}
        </Text>
        <Button
          variant="secondary"
          label={t("date.fast.useDate", { date: fmtDateMedium(later) })}
          onPress={() => onUseDate(later)}
        />
      </>
    );
  }
  return (
    <>
      <Text style={styles.hint}>{t("date.slow.title")}</Text>
      <Text style={styles.hint}>
        {t("date.slow.body", { surplus: fmtInt(check.surplusKcal), date: fmtDateMedium(later) })}
      </Text>
      <Button
        variant="secondary"
        label={t("date.slow.useDate", { date: fmtDateMedium(later) })}
        onPress={() => onUseDate(later)}
      />
    </>
  );
}

function MaternalResult({ targets, info }: { targets: Targets; info: MaternalInfo }) {
  const { t } = useTranslation(["settings", "maternal"]);
  const stage = useStageText(info);
  const protein = info.nutrients.find((n) => n.key === "protein");
  return (
    <>
      <Text style={styles.stepCaption}>
        {stage.detail ? `${stage.line} · ${stage.detail}` : stage.line}
      </Text>
      <View style={styles.planTiles}>
        <StatTile
          icon="restaurant"
          tint="makan"
          label={t("maternal:target.total")}
          value={fmtInt(targets.eatKcal)}
          sub={t("settings:plan.numbers.perDay")}
        />
        {protein ? (
          <StatTile
            macro="protein"
            tint="makan"
            label={t("maternal:nutrients.protein.name")}
            value={`${fmtInt(protein.target)} ${t("maternal:nutrients.unit.g")}`}
            sub={t("settings:plan.numbers.perDay")}
          />
        ) : null}
        <StatTile
          icon="moon"
          tint="tidur"
          label={t("settings:plan.numbers.sleep")}
          value={fmtKg(targets.sleepHours)}
          sub={t("settings:plan.numbers.perNight")}
        />
      </View>
      <Card>
        <View style={styles.maternalLine}>
          <Text style={styles.hint}>{t("maternal:target.base")}</Text>
          <Text style={styles.maternalValue}>
            {fmtInt(info.baseKcal)} {t("maternal:target.kcal")}
          </Text>
        </View>
        <View style={styles.maternalLine}>
          <Text style={styles.hint}>{t("maternal:target.add")}</Text>
          <Text style={styles.maternalValue}>
            + {fmtInt(info.addKcal)} {t("maternal:target.kcal")}
          </Text>
        </View>
        <Text style={styles.hint}>{t("maternal:target.noDeficit")}</Text>
      </Card>
      <MaternalFlagNotes info={info} />
      <MaternalDisclaimer />
    </>
  );
}

export default function Onboarding() {
  const gate = useSessionGate();
  const { t } = useTranslation(["onboarding", "common", "settings", "maternal", "gain"]);
  const { theme } = useUnistyles();
  const profileQuery = useQuery(orpc.profile.myProfile.queryOptions());
  const queryClient = useQueryClient();

  const [saving, setSaving] = useState(false);
  const [inviting, setInviting] = useState(false);
  const { data: session } = authClient.useSession();
  const [savedTargets, setSavedTargets] = useState<Targets | null>(null);
  const [step, setStep] = useState(0);
  const [gender, setGender] = useState<Gender>("male");
  const [birthYear, setBirthYear] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [targetWeightKg, setTargetWeightKg] = useState("");
  const [targetDate, setTargetDate] = useState(defaultTargetDate);
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>("light");
  const [formError, setFormError] = useState<string | null>(null);
  const [maternalChoice, setMaternalChoice] = useState<MaternalChoice>("none");
  const [draft, setDraft] = useState<MaternalDraft>(() => emptyDraft("pregnant"));
  const [goal, setGoal] = useState<Goal>("lose");
  const [derivedGain, setDerivedGain] = useState(false);
  // Never blocks the step: with no answer yet (or offline) the recommendation just does not show.
  const guide = useQuery({ ...orpc.profile.activityGuide.queryOptions(), retry: false });

  if (gate === "loading" || profileQuery.isPending) {
    return <BootLoader />;
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }
  if (profileQuery.isError) {
    return (
      <Screen>
        <ErrorState
          message={errorMessage(profileQuery.error)}
          onRetry={() => profileQuery.refetch()}
        />
      </Screen>
    );
  }
  if (!savedTargets && profileQuery.data?.profile) {
    return <Redirect href="/" />;
  }

  const height = parseNum(heightCm);
  const weight = parseNum(weightKg);
  const ideal = height ? idealWeightRange(height) : null;
  const target = parseNum(targetWeightKg);
  // Female profiles are asked about Hamil / Menyusui; that path skips the weight-loss goal.
  const isMaternal = gender === "female" && maternalChoice !== "none";
  const steps: StepId[] = [
    "birth",
    "gender",
    ...(gender === "female" ? (["maternalEntry"] as const) : []),
    ...(isMaternal ? (["maternalForm"] as const) : []),
    "height",
    "weight",
    ...(isMaternal ? [] : (["goal"] as const)),
    "activity",
  ];
  const stepId = steps[step] ?? "activity";
  // What each level makes of the answers so far, worked out here: the account has no profile yet to ask the server.
  const maternalState = isMaternal ? draftToInput(draft) : null;
  const resolvedMaternal = maternalState?.ok ? resolveMaternalInput(maternalState.input) : null;
  const birth = parseNum(birthYear);
  const activityChoices =
    stepId === "activity" && weight !== null && height !== null && birth !== null
      ? activityOptions(
          {
            birthYear: birth,
            gender,
            heightCm: height,
            weightKg: weight,
            activityLevel,
            ...(goal === "maintain"
              ? { goal, targetWeightKg: weight, targetDate: shiftDate(jakartaToday(), 365) }
              : { goal, targetWeightKg: target ?? weight, targetDate }),
          },
          resolvedMaternal?.ok ? resolvedMaternal.state : null,
          weight,
        )
      : [];

  const chooseMaternal = (choice: MaternalChoice) => {
    setMaternalChoice(choice);
    if (choice !== "none") setDraft((d) => ({ ...d, mode: choice }));
  };

  const submitMaternal = () => {
    const result = draftToInput(draft);
    if (!result.ok) {
      setFormError(t(`maternal:${result.error}`));
      return;
    }
    nextStep();
  };

  const nextStep = () => {
    setFormError(null);
    setStep((s) => s + 1);
  };

  const submitBirth = () => {
    const year = parseNum(birthYear);
    if (year === null || !Number.isInteger(year) || year < 1930 || year > 2020) {
      setFormError(t("error.birthYear"));
      return;
    }
    nextStep();
  };

  const submitHeight = () => {
    if (height === null || height < 100 || height > 250) {
      setFormError(t("error.height"));
      return;
    }
    nextStep();
  };

  const submitWeight = () => {
    if (weight === null || weight < 25 || weight > 400) {
      setFormError(t("error.weight"));
      return;
    }
    nextStep();
  };

  const submitTarget = () => {
    if (goal === "maintain") {
      nextStep();
      return;
    }
    if (target === null || target < 25 || target > 400) {
      setFormError(t("error.targetWeight"));
      return;
    }
    if (weight !== null) {
      const mismatch = goalTargetError(goal, weight, target);
      if (mismatch) {
        setFormError(
          t(mismatch === "goalGainTarget" ? "gain:nativeSetup.needGainTarget" : "gain:nativeSetup.needLoseTarget"),
        );
        return;
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      setFormError(t("error.targetDateFormat"));
      return;
    }
    if (targetDate < jakartaToday()) {
      setFormError(t("error.targetDatePast"));
      return;
    }
    nextStep();
  };

  /** The chooser is the intent; picking Naikin BB offers a starting target and a lean-pace date. */
  const chooseGoal = (next: Goal) => {
    setGoal(next);
    setDerivedGain(false);
    setFormError(null);
    if (next === "gain" && weight !== null && height !== null && ideal && (target === null || target <= weight)) {
      const suggested = Math.round(suggestGainTarget(weight, height, ideal.minKg, ideal.maxKg) * 10) / 10;
      const days = suggestedDays(suggested - weight, weight, bmiOf(weight, height) < UNDERWEIGHT_BMI);
      setTargetWeightKg(String(suggested));
      setTargetDate(shiftDate(jakartaToday(), Math.min(days, MAX_TARGET_DAYS)));
    } else if (next === "lose" && target !== null && weight !== null && target >= weight) {
      setTargetWeightKg("");
      setTargetDate(defaultTargetDate());
    }
  };

  /** A target on the other side of the weight moves the chooser along. */
  const changeTarget = (text: string) => {
    setTargetWeightKg(text);
    const typed = parseNum(text);
    if (typed === null || weight === null) return;
    const implied = goalOf(weight, typed);
    if (implied === "gain" && goal !== "gain") {
      setGoal("gain");
      setDerivedGain(true);
    } else if (implied === "lose" && goal === "gain") {
      setGoal("lose");
      setDerivedGain(false);
    }
  };

  const gainCheck =
    goal === "gain" && weight !== null && target !== null
      ? checkTargetDate({
          weightNowKg: weight,
          targetWeightKg: target,
          targetDate,
          goal,
          heightCm: height ?? undefined,
        })
      : null;

  const submitAll = async () => {
    const year = parseNum(birthYear);
    const maternalResult = isMaternal ? draftToInput(draft) : null;
    if (
      year === null ||
      height === null ||
      weight === null ||
      (maternalResult ? !maternalResult.ok : goal !== "maintain" && target === null)
    ) {
      setFormError(t("error.incomplete"));
      return;
    }
    setSaving(true);
    try {
      // Native TS resolves this procedure's client type as void; the runtime
      // shape is { targets } (web infers it fine), so pin it here.
      const result = (await client.profile.upsert({
        birthYear: year,
        gender,
        heightCm: height,
        weightKg: weight,
        activityLevel,
        ...(maternalResult?.ok
          ? { maternal: maternalResult.input }
          : goal === "maintain"
            ? { goal, targetWeightKg: weight, targetDate: shiftDate(jakartaToday(), 365) }
            : { goal, targetWeightKg: target ?? undefined, targetDate }),
      })) as unknown as { targets: Targets };
      setSavedTargets(result.targets);
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const targets = savedTargets;

  const firstName = session?.user.name?.trim().split(/\s+/)[0];

  /** Beranda's cached "no profile yet" summary would redirect straight back
   * here; drop it so whatever opens next loads the new plan. */
  const openAfterOnboarding = (go: () => void) => {
    queryClient.removeQueries({ queryKey: orpc.profile.key() });
    queryClient.removeQueries({ queryKey: orpc.day.key() });
    void queryClient.invalidateQueries();
    go();
  };

  // Skippable Founder paywall; "Later" lands on Beranda.
  const startApp = () =>
    openAfterOnboarding(() =>
      router.replace({ pathname: "/founder", params: { from: "onboarding" } }),
    );

  const goBack = () => {
    setFormError(null);
    setStep((s) => Math.max(0, s - 1));
  };

  return (
    <Screen>
      {/* Progress bar */}
      <View style={styles.progressRow}>
        {steps.map((id, i) => (
          <ProgressSegment key={i} filled={i <= step && !targets} />
        ))}
      </View>

      <StepView key={targets ? (inviting ? "invite" : "result") : step}>
        {targets && inviting ? (
          <InviteFriendsStep
            defaultName={
              firstName
                ? t("invite.defaultName", { name: firstName }).slice(0, 40)
                : t("invite.defaultNameBare")
            }
            onSkip={startApp}
            onOpenGroup={(groupId) => openAfterOnboarding(() => router.replace(`/grup/${groupId}`))}
          />
        ) : targets ? (
          <ResultView targets={targets} onTargets={setSavedTargets} onStart={startApp} onInvite={() => setInviting(true)} />
        ) : (
          <>
            {step > 0 ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t("common:actions.back")}
                onPress={goBack}
                hitSlop={8}
                scaleTo={0.94}
                dimTo={0.7}
                style={styles.backButton}
              >
                <Ionicons name="chevron-back" size={24} color={theme.colors.foreground} />
              </PressableScale>
            ) : null}

            {stepId === "birth" ? (
              <>
                <Text style={styles.stepTitle}>{t("question.birth.title")}</Text>
                <Text style={styles.stepCaption}>{t("question.birth.hint")}</Text>
                <Card>
                  <Field label={t("question.birth.label")}>
                    <Input
                      value={birthYear}
                      onChangeText={setBirthYear}
                      keyboardType="number-pad"
                      placeholder="1995"
                      maxLength={4}
                    />
                  </Field>
                  {formError ? <Text style={styles.error}>{formError}</Text> : null}
                  <Button label={t("action.next")} onPress={submitBirth} />
                </Card>
              </>
            ) : null}

            {stepId === "gender" ? (
              <>
                <Text style={styles.stepTitle}>{t("question.gender.title")}</Text>
                <Text style={styles.stepCaption}>{t("question.gender.hint")}</Text>
                <View style={styles.choiceList}>
                  <ChoiceRow
                    label={t("settings:profile.gender.male")}
                    selected={gender === "male"}
                    onPress={() => setGender("male")}
                  />
                  <ChoiceRow
                    label={t("settings:profile.gender.female")}
                    selected={gender === "female"}
                    onPress={() => setGender("female")}
                  />
                </View>
                {formError ? <Text style={styles.error}>{formError}</Text> : null}
                <Button label={t("action.next")} onPress={nextStep} />
              </>
            ) : null}

            {stepId === "maternalEntry" ? (
              <>
                <Text style={styles.stepTitle}>{t("maternal:entry.question")}</Text>
                <Text style={styles.stepCaption}>{t("maternal:entry.hint")}</Text>
                <View style={styles.choiceList}>
                  <ChoiceRow
                    label={t("maternal:entry.pregnant")}
                    description={t("maternal:entry.pregnantHint")}
                    selected={maternalChoice === "pregnant"}
                    onPress={() => chooseMaternal("pregnant")}
                  />
                  <ChoiceRow
                    label={t("maternal:entry.breastfeeding")}
                    description={t("maternal:entry.breastfeedingHint")}
                    selected={maternalChoice === "breastfeeding"}
                    onPress={() => chooseMaternal("breastfeeding")}
                  />
                  <ChoiceRow
                    label={t("maternal:entry.neither")}
                    selected={maternalChoice === "none"}
                    onPress={() => chooseMaternal("none")}
                  />
                </View>
                <Button label={t("action.next")} onPress={nextStep} />
              </>
            ) : null}

            {stepId === "maternalForm" ? (
              <>
                <MaternalForm draft={draft} onChange={setDraft} error={formError} />
                <Button label={t("maternal:form.continue")} onPress={submitMaternal} />
              </>
            ) : null}

            {stepId === "height" ? (
              <>
                <Text style={styles.stepTitle}>{t("question.height.title")}</Text>
                <Card>
                  <Field label={t("question.height.label")}>
                    <Input
                      value={heightCm}
                      onChangeText={setHeightCm}
                      keyboardType="decimal-pad"
                      placeholder="170"
                    />
                  </Field>
                  {formError ? <Text style={styles.error}>{formError}</Text> : null}
                  <Button label={t("action.next")} onPress={submitHeight} />
                </Card>
              </>
            ) : null}

            {stepId === "weight" ? (
              <>
                <Text style={styles.stepTitle}>{t("question.weight.title")}</Text>
                <Text style={styles.stepCaption}>{t("question.weight.hint")}</Text>
                <Card>
                  <Field label={t("question.weight.label")}>
                    <Input
                      value={weightKg}
                      onChangeText={setWeightKg}
                      keyboardType="decimal-pad"
                      placeholder="80"
                    />
                  </Field>
                  {formError ? <Text style={styles.error}>{formError}</Text> : null}
                  <Button label={t("action.next")} onPress={submitWeight} />
                </Card>
                <Disclosure title={t("info.title")}>
                  <Text style={styles.hint}>{t("question.weight.why")}</Text>
                </Disclosure>
              </>
            ) : null}

            {stepId === "goal" ? (
              <>
                <Text style={styles.stepTitle}>{t("question.goal.title")}</Text>
                <Card>
                  <GoalChooser value={goal} onChange={chooseGoal} />
                  {goal === "maintain" ? (
                    <Text style={styles.hint}>{t("gain:goal.maintainNote")}</Text>
                  ) : (
                    <>
                      <Field
                        label={t("question.target.label")}
                        hint={
                          ideal
                            ? t("question.target.healthyRange", {
                                min: fmtKg(ideal.minKg),
                                max: fmtKg(ideal.maxKg),
                              })
                            : undefined
                        }
                      >
                        <Input
                          value={targetWeightKg}
                          onChangeText={changeTarget}
                          keyboardType="decimal-pad"
                          placeholder="70"
                        />
                      </Field>
                      {derivedGain && goal === "gain" ? (
                        <Text style={styles.hint}>{t("gain:goal.derivedGain")}</Text>
                      ) : null}
                      {goal !== "gain" && ideal && target !== null && target < ideal.minKg ? (
                        <Text style={styles.warning}>{t("question.target.belowRange")}</Text>
                      ) : null}
                      {goal === "gain" && ideal && target !== null && height !== null && bmiOf(target, height) > HEALTHY_BMI_MAX ? (
                        <Text style={styles.hint}>
                          {t("gain:target.aboveHealthy", {
                            min: fmtKg(ideal.minKg),
                            max: fmtKg(ideal.maxKg),
                          })}
                        </Text>
                      ) : null}
                      <Field label={t("question.date.label")} hint={t("question.date.hint")}>
                        <Input
                          value={targetDate}
                          onChangeText={setTargetDate}
                          placeholder="2026-12-15"
                        />
                      </Field>
                      {gainCheck ? (
                        <GainDateNote check={gainCheck} onUseDate={setTargetDate} />
                      ) : null}
                    </>
                  )}
                  {formError ? <Text style={styles.error}>{formError}</Text> : null}
                  <Button label={t("action.next")} onPress={submitTarget} />
                </Card>
                <Disclosure title={t("info.title")}>
                  <Text style={styles.hint}>{t("question.date.why")}</Text>
                </Disclosure>
              </>
            ) : null}

            {stepId === "activity" ? (
              <>
                <Text style={styles.stepTitle}>{t("question.activity.title")}</Text>
                <Card>
                  <ActivityLevelPicker
                    options={activityChoices}
                    value={activityLevel}
                    maternal={isMaternal}
                    onSelect={setActivityLevel}
                  />
                  <ActivityRecommendations
                    steps={guide.data?.steps ?? null}
                    calibration={null}
                    current={activityLevel}
                    applying={null}
                    showEmpty={false}
                    onApply={setActivityLevel}
                  />
                </Card>
                <GuideLink label={t("guide.activity")} />
                {formError ? <Text style={styles.error}>{formError}</Text> : null}
                <Button
                  label={t("action.save")}
                  onPress={() => void submitAll()}
                  loading={saving}
                />
              </>
            ) : null}
          </>
        )}
      </StepView>
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  stepView: {
    gap: theme.spacing.md,
  },
  choiceFill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.makanSoft,
  },
  progressTrack: {
    flex: 1,
    height: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.muted,
    overflow: "hidden",
  },
  progressFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.primary,
    transformOrigin: "left center",
  },
  progressRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: theme.spacing.md,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  resultMascot: {
    alignSelf: "center",
  },
  stepTitle: {
    fontSize: theme.fontSize.title,
    fontWeight: "800",
    letterSpacing: -0.5,
    color: theme.colors.foreground,
    marginTop: theme.spacing.sm,
  },
  stepCaption: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    marginTop: -theme.spacing.sm,
  },
  choiceList: {
    gap: theme.spacing.md,
  },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    borderRadius: theme.radius.tile,
    padding: 16,
    minHeight: 56,
  },
  choiceText: {
    flex: 1,
    gap: 2,
  },
  choiceLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
  },
  choiceDesc: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
  },
  planTiles: {
    flexDirection: "row",
    gap: theme.spacing.md,
  },
  hint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
  maternalLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  maternalValue: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  warning: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.warning,
    lineHeight: 20,
  },
  guideLink: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    textDecorationLine: "underline",
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
}));
