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
  MAX_START_AHEAD_DAYS,
  validateChallengeInput,
  type ChallengeGoal,
} from "@joyorogo/api/lib/challenge";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CircleAlert, Minus, Plus } from "lucide-react";
import { useState } from "react";
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
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Buat tantangan"
      description="Satu tujuan, satu durasi. Semua anggota grup bisa ikut gratis."
    >
      <CreateForm groupId={groupId} onPaywall={onPaywall} />
    </Sheet>
  );
}

function CreateForm({ groupId, onPaywall }: { groupId: string; onPaywall: () => void }) {
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

  const create = useMutation(
    orpc.challenge.create.mutationOptions({
      onSuccess: ({ id }) => {
        void queryClient.invalidateQueries({ queryKey: orpc.challenge.key() });
        toast.success("Tantangan dibuat");
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
        <FieldLabel>Tujuan</FieldLabel>
        <div role="radiogroup" aria-label="Tujuan tantangan" className="space-y-2">
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
                  "block min-h-14 w-full rounded-2xl px-4 py-3 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
                  active ? "bg-foreground text-background" : "bg-muted hover:bg-border",
                )}
              >
                <span className="block text-[0.9375rem] font-bold">{GOALS[id].label}</span>
                <span
                  className={cn(
                    "mt-0.5 block text-[0.8125rem]",
                    active ? "text-background/80" : "text-muted-foreground",
                  )}
                >
                  {GOALS[id].blurb}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 px-1 text-[0.8125rem] text-muted-foreground">{spec.source}</p>
      </section>

      <section>
        <FieldLabel htmlFor="challenge-target">Target harian</FieldLabel>
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
                aria-label="Kurangi target"
                disabled={target !== null && target <= range.min}
                onClick={() => nudgeTarget(-1)}
              >
                <Minus aria-hidden />
              </Button>
              <Input
                id="challenge-target"
                inputMode="decimal"
                aria-label={`Target ${spec.unit}`}
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
                aria-label="Tambah target"
                disabled={target !== null && target >= range.max}
                onClick={() => nudgeTarget(1)}
              >
                <Plus aria-hidden />
              </Button>
              <span className="w-16 shrink-0 text-sm font-semibold text-muted-foreground">
                {spec.unit}
              </span>
            </div>
            <p className="px-1 text-xs text-muted-foreground">
              Antara {fmtInt(range.min)} dan {fmtInt(range.max)}, kelipatan{" "}
              {range.step.toLocaleString("id-ID")}.
            </p>
          </div>
        ) : (
          <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
            Target ikut profil tiap anggota dan dibekukan saat mereka bergabung. Kamu tidak perlu
            mengisi apa-apa.
          </p>
        )}
      </section>

      <section>
        <FieldLabel>Durasi</FieldLabel>
        <Segmented
          label="Durasi tantangan"
          value={String(durationDays)}
          onChange={(value) => {
            setDurationDays(Number(value));
            setServerError(null);
          }}
          options={CHALLENGE_DURATIONS.map((days) => ({
            value: String(days),
            label: `${days} hari`,
          }))}
        />
      </section>

      <section>
        <FieldLabel>Mulai</FieldLabel>
        <Segmented
          label="Tanggal mulai"
          value={startChoice}
          onChange={(value) => {
            setStartChoice(value);
            setServerError(null);
          }}
          options={[
            { value: "today", label: "Hari ini" },
            { value: "tomorrow", label: "Besok" },
            { value: "date", label: "Pilih tanggal" },
          ]}
        />
        {startChoice === "date" && (
          <Input
            type="date"
            aria-label="Tanggal mulai tantangan"
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
        <FieldLabel htmlFor="challenge-title">Nama tantangan (opsional)</FieldLabel>
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
        {create.isPending ? "Membuat..." : "Buat tantangan"}
      </Button>
    </form>
  );
}
