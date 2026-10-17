import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { cn } from "@joyorogo/ui/lib/utils";
import {
  CHALLENGE_DURATIONS,
  CHALLENGE_TITLE_MAX,
  defaultChallengeTitle,
  GOAL_ORDER,
  GOALS,
  goalText,
  MAX_START_AHEAD_DAYS,
  validateChallengeInput,
  type ChallengeGoal,
} from "@joyorogo/api/lib/challenge";
import { fmtNumber } from "@joyorogo/i18n";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CircleAlert, Minus, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Chip } from "@/components/chip";
import { FieldLabel, Segmented } from "@/components/kit/surface";
import { isPaywallError } from "@/lib/billing";
import { fmtInt, jakartaDatePlusDays, parseNum } from "@/lib/format";
import { orpc } from "@/utils/orpc";

type StartChoice = "today" | "tomorrow" | "date";

/** Bottom sheet where a Founder sets up a group challenge. */
export function CreateChallengeSheet({
  groupId,
  open,
  onOpenChange,
  onPaywall,
}: {
  groupId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The server refused with the Founder paywall (free account). */
  onPaywall: () => void;
}) {
  const { t } = useTranslation("challenge");
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("create.title")}
      description={t("create.description")}
    >
      <CreateForm groupId={groupId} onPaywall={onPaywall} />
    </Sheet>
  );
}

function CreateForm({ groupId, onPaywall }: { groupId: string; onPaywall: () => void }) {
  const { t } = useTranslation("challenge");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const today = jakartaDatePlusDays(0);

  const [goal, setGoal] = useState<ChallengeGoal>("steps");
  const [targetText, setTargetText] = useState(String(GOALS.steps.range?.default ?? ""));
  const [durationDays, setDurationDays] = useState<number>(7);
  const [startChoice, setStartChoice] = useState<StartChoice>("today");
  const [customDate, setCustomDate] = useState(jakartaDatePlusDays(2));
  const [title, setTitle] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);

  const spec = GOALS[goal];
  const range = spec.range;
  const fixed = spec.targetKind === "fixed";
  const target = fixed ? parseNum(targetText) : null;
  const startDate =
    startChoice === "today" ? today : startChoice === "tomorrow" ? jakartaDatePlusDays(1) : customDate;
  const invalid = validateChallengeInput({ goal, target, durationDays, startDate }, today);
  const text = goalText(goal);

  const create = useMutation(
    orpc.challenge.create.mutationOptions({
      onSuccess: ({ id }) => {
        void queryClient.invalidateQueries({ queryKey: orpc.challenge.key() });
        toast.success(t("toast.created"));
        void navigate({
          to: "/grup/$groupId/tantangan/$challengeId",
          params: { groupId, challengeId: id },
        });
      },
      onError: (error) => {
        if (isPaywallError(error)) {
          onPaywall();
          return;
        }
        setServerError(error.message);
      },
    }),
  );

  const pickGoal = (next: ChallengeGoal) => {
    setGoal(next);
    setTargetText(String(GOALS[next].range?.default ?? ""));
    setServerError(null);
  };

  const nudgeTarget = (direction: 1 | -1) => {
    if (!range) return;
    const current = target ?? range.default;
    const next = Math.min(range.max, Math.max(range.min, current + direction * range.step));
    setTargetText(String(Math.round(next * 1000) / 1000));
    setServerError(null);
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (invalid) return;
        setServerError(null);
        create.mutate({
          groupId,
          title: title.trim() === "" ? undefined : title.trim(),
          goal,
          target,
          durationDays,
          startDate,
        });
      }}
    >
      <section>
        <FieldLabel>{t("create.goal.label")}</FieldLabel>
        <div role="radiogroup" aria-label={t("create.goal.aria")} className="space-y-2">
          {GOAL_ORDER.map((id) => {
            const active = id === goal;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => pickGoal(id)}
                className={cn(
                  "block min-h-11 w-full rounded-2xl px-4 py-2.5 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
                  active ? "bg-foreground text-background" : "bg-muted hover:bg-border",
                )}
              >
                <span className="block text-[0.9375rem] font-bold">{goalText(id).label}</span>
                {active && (
                  <span className="mt-0.5 block text-[0.8125rem] text-background/80">
                    {goalText(id).blurb}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-2 px-1 text-[0.8125rem] text-muted-foreground">{text.source}</p>
      </section>

      <section>
        <FieldLabel htmlFor="challenge-target">{t("create.target.label")}</FieldLabel>
        {fixed && range ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {range.presets.map((preset) => (
                <Chip
                  key={preset}
                  active={target === preset}
                  onClick={() => {
                    setTargetText(String(preset));
                    setServerError(null);
                  }}
                >
                  {fmtInt(preset)}
                </Chip>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label={t("create.target.decrease")}
                disabled={target !== null && target <= range.min}
                onClick={() => nudgeTarget(-1)}
              >
                <Minus aria-hidden />
              </Button>
              <Input
                id="challenge-target"
                inputMode="decimal"
                aria-label={t("create.target.aria", { unit: text.unit })}
                value={targetText}
                onChange={(event) => {
                  setTargetText(event.target.value);
                  setServerError(null);
                }}
                className="text-center font-bold"
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label={t("create.target.increase")}
                disabled={target !== null && target >= range.max}
                onClick={() => nudgeTarget(1)}
              >
                <Plus aria-hidden />
              </Button>
              <span className="w-16 shrink-0 text-sm font-semibold text-muted-foreground">
                {text.unit}
              </span>
            </div>
            <p className="px-1 text-xs text-muted-foreground">
              {t("create.target.range", {
                min: fmtInt(range.min),
                max: fmtInt(range.max),
                step: fmtNumber(range.step, 1),
              })}
            </p>
          </div>
        ) : (
          <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
            {t("create.target.personal")}
          </p>
        )}
      </section>

      <section>
        <FieldLabel>{t("create.duration.label")}</FieldLabel>
        <Segmented
          label={t("create.duration.aria")}
          value={String(durationDays)}
          onChange={(value) => {
            setDurationDays(Number(value));
            setServerError(null);
          }}
          options={CHALLENGE_DURATIONS.map((days) => ({
            value: String(days),
            label: t("create.duration.days", { count: days }),
          }))}
        />
      </section>

      <section>
        <FieldLabel>{t("create.start.label")}</FieldLabel>
        <Segmented
          label={t("create.start.aria")}
          value={startChoice}
          onChange={(value) => {
            setStartChoice(value);
            setServerError(null);
          }}
          options={[
            { value: "today", label: t("create.start.today") },
            { value: "tomorrow", label: t("create.start.tomorrow") },
            { value: "date", label: t("create.start.pick") },
          ]}
        />
        {startChoice === "date" && (
          <Input
            type="date"
            aria-label={t("create.start.dateAria")}
            className="mt-2"
            min={today}
            max={jakartaDatePlusDays(MAX_START_AHEAD_DAYS)}
            value={customDate}
            onChange={(event) => {
              setCustomDate(event.target.value);
              setServerError(null);
            }}
          />
        )}
      </section>

      <section>
        <FieldLabel htmlFor="challenge-title">{t("create.name.label")}</FieldLabel>
        <Input
          id="challenge-title"
          maxLength={CHALLENGE_TITLE_MAX}
          placeholder={defaultChallengeTitle(goal, target, durationDays)}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </section>

      {(invalid || serverError) && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-2xl bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {serverError ?? invalid}
        </p>
      )}

      <Button
        type="submit"
        className="w-full"
        disabled={create.isPending || invalid !== null}
      >
        {create.isPending ? t("create.submitting") : t("create.submit")}
      </Button>
    </form>
  );
}
