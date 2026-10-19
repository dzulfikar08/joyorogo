import { useQuery } from "@tanstack/react-query";
import {
  CircleAlert,
  CircleCheck,
  Cookie,
  CupSoda,
  Lightbulb,
  Slice,
  TriangleAlert,
  Undo2,
  Utensils,
} from "lucide-react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";

import { effectiveRamadan, jakartaToday } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { wibMinutes } from "@joyorogo/api/lib/fasting";
import type { FoodKind } from "@joyorogo/api/lib/food-kind";
import { gainRemaining } from "@joyorogo/api/lib/gain";
import { VERDICT_LABELS, adviseSnack, dayImpactLine } from "@joyorogo/api/lib/snack-advice";
import type { AdviceVerdict, SnackAdvice } from "@joyorogo/api/lib/snack-advice";
import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";
import { fmtInt, fmtKcalLabel } from "@/lib/format";
import { orpc } from "@/utils/orpc";

/** Naikin BB: the item read against what is still to eat (never a verdict). */
export type GainScan = {
  state: "short" | "reached";
  leftKcal: number;
  /** Day total with this item added. */
  totalKcal: number;
  targetKcal: number;
  /** The item alone is a third of the day's target: offer the calorie-dense hint. */
  dense: boolean;
};

export type SnackAdviceState = {
  advice: SnackAdvice | null;
  impact: string | null;
  gain?: GainScan;
};

/**
 * Advice for the item about to be saved. Today gets the verdict card; a past
 * day only gets a neutral "Total hari itu jadi ..." line, since "upcoming
 * meals" mean nothing there. Reads the same day.summary / fasting.today
 * queries as the rest of Makan, so it costs no extra request.
 */
export function useSnackAdvice(input: {
  date?: string;
  kcal: number;
  kind: FoodKind;
  slot: Meal;
  name?: string;
}): SnackAdviceState {
  const today = jakartaToday();
  const date = input.date ?? today;
  const isToday = date === today;
  const summary = useQuery(orpc.day.summary.queryOptions({ input: { date } }));
  const fasting = useQuery({ ...orpc.fasting.today.queryOptions({ input: {} }), enabled: isToday });
  const profile = useQuery(orpc.profile.myProfile.queryOptions());
  const targets = summary.data?.targets;
  if (!summary.data || !targets || !(input.kcal > 0)) return { advice: null, impact: null };
  // Hamil / Menyusui: no over-target verdict, no "upcoming meals" budget pressure.
  if (targets.maternal) return { advice: null, impact: null };
  // Naikin BB: under-eating is the problem, so never a verdict, only what is still to eat.
  if (targets.gain) {
    const { state, kcal: leftKcal } = gainRemaining(targets.eatKcal, summary.data.eatenKcal);
    return {
      advice: null,
      impact: null,
      gain: {
        state: state === "short" ? "short" : "reached",
        leftKcal,
        totalKcal: summary.data.eatenKcal + input.kcal,
        targetKcal: targets.eatKcal,
        dense: input.kcal >= targets.eatKcal / 3,
      },
    };
  }
  if (!isToday) {
    return {
      advice: null,
      impact: dayImpactLine(summary.data.eatenKcal, targets.eatKcal, input.kcal),
    };
  }
  return {
    impact: null,
    advice: adviseSnack({
      name: input.name,
      kcal: input.kcal,
      kind: input.kind,
      slot: input.slot,
      eatenKcal: summary.data.eatenKcal,
      eatKcal: targets.eatKcal,
      // What today really burns: TDEE (already holds the factor's daily movement) plus the measured activity beyond it.
      tdeeKcal: targets.tdee + (summary.data.exerciseCredit?.extraKcal ?? 0),
      eatenByMeal: summary.data.eatenByMeal,
      nowMin: wibMinutes(new Date()),
      ramadan: effectiveRamadan(profile.data?.profile?.ramadanMode),
      fasting: fasting.data ?? null,
    }),
  };
}

const TONE: Record<
  AdviceVerdict,
  { card: string; icon: string; Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }> }
> = {
  aman: { card: "bg-makan-soft", icon: "text-makan-ink", Icon: CircleCheck },
  "hati-hati": { card: "bg-kcal/15", icon: "text-kcal", Icon: TriangleAlert },
  lewat: { card: "bg-destructive/10", icon: "text-destructive", Icon: CircleAlert },
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-card/70 px-2 py-2 text-center">
      <dt className="text-[0.6875rem] font-semibold text-foreground/70">{label}</dt>
      <dd className="text-sm font-extrabold tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * Inline verdict card shown before saving. Never blocks the save button; the
 * half-portion action only rescales the form above it.
 */
export function SnackAdviceCard({
  state,
  onHalf,
  halfApplied,
  onUndoHalf,
  className,
}: {
  state: SnackAdviceState;
  /** Scales the pending portion to half; omit when the screen cannot. */
  onHalf?: () => void;
  /** The portion is already halved: show the undo instead of the half action. */
  halfApplied?: boolean;
  onUndoHalf?: () => void;
  className?: string;
}) {
  const { t } = useTranslation(["makan", "gain"]);
  const { advice, impact, gain } = state;
  if (gain) {
    return (
      <section
        role="status"
        aria-label={t("gain:coach.scanTitle")}
        data-verdict="gain"
        className={cn("rounded-3xl bg-makan-soft p-5", className)}
      >
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-card text-makan-ink">
            <CircleCheck className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base leading-tight font-extrabold">{t("gain:coach.scanTitle")}</p>
            <p className="mt-1 text-sm leading-relaxed">
              {gain.state === "short"
                ? t("gain:coach.scanShort", { kcal: fmtInt(gain.leftKcal) })
                : t("gain:coach.scanReached")}
            </p>
            <p className="mt-1 text-sm leading-relaxed tabular-nums text-foreground/70">
              {t("gain:coach.dayImpact", {
                total: fmtInt(gain.totalKcal),
                target: fmtInt(gain.targetKcal),
              })}
            </p>
            {gain.dense && (
              <p className="mt-2 flex items-start gap-2 text-sm">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-foreground/70" aria-hidden />
                <span>{t("gain:coach.dense")}</span>
              </p>
            )}
          </div>
        </div>
      </section>
    );
  }
  if (!advice) {
    return impact ? (
      <p className={cn("px-1 text-sm text-muted-foreground", className)} role="status">
        {impact}
      </p>
    ) : null;
  }
  const tone = TONE[advice.verdict];
  const { numbers } = advice;
  const half = advice.suggestions.find((s) => s.type === "half");
  const swap = advice.suggestions.find((s) => s.type === "swap");
  const lighter = advice.suggestions.find((s) => s.type === "lighter-next");
  const lines = [
    swap?.type === "swap" ? swap.text : null,
    lighter?.type === "lighter-next"
      ? t("snackAdvice.card.lighterLine", {
          label: lighter.label,
          kcal: fmtKcalLabel(lighter.targetKcal),
        })
      : null,
  ].filter((line): line is string => line !== null);
  return (
    <section
      role="status"
      aria-label={t("snackAdvice.card.aria", { title: advice.title })}
      data-verdict={advice.verdict}
      className={cn("rounded-3xl p-5", tone.card, className)}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full bg-card",
            tone.icon,
          )}
        >
          <tone.Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base leading-tight font-extrabold">{advice.title}</p>
          <p className="mt-1 text-sm leading-relaxed">{advice.reason}</p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2">
        <Stat
          label={t("snackAdvice.card.remainingToday")}
          value={fmtKcalLabel(numbers.remainingKcal)}
        />
        <Stat
          label={
            advice.upcoming.length > 0
              ? t("snackAdvice.card.needLater")
              : t("snackAdvice.card.mealsAhead")
          }
          value={
            advice.upcoming.length > 0
              ? fmtKcalLabel(numbers.reserveKcal)
              : t("snackAdvice.card.none")
          }
        />
        <Stat
          label={t("snackAdvice.card.afterThis")}
          value={
            numbers.afterKcal >= 0
              ? fmtKcalLabel(numbers.afterKcal)
              : t("snackAdvice.card.over", { kcal: fmtInt(numbers.overKcal) })
          }
        />
      </dl>

      {(halfApplied || (half && onHalf)) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {halfApplied ? (
            <Button type="button" variant="secondary" size="sm" onClick={onUndoHalf}>
              <Undo2 className="size-4" aria-hidden />
              {t("snackAdvice.card.undoHalf")}
            </Button>
          ) : (
            half?.type === "half" && (
              <>
                <Button type="button" variant="secondary" size="sm" onClick={onHalf}>
                  <Slice className="size-4" aria-hidden />
                  {t("snackAdvice.card.halfButton", { kcal: fmtKcalLabel(half.kcal) })}
                </Button>
                {half.verdict !== advice.verdict && (
                  <span className="text-xs font-semibold text-foreground/70">
                    {t("snackAdvice.card.halfResult", {
                      verdict: VERDICT_LABELS[half.verdict].toLowerCase(),
                    })}
                  </span>
                )}
              </>
            )
          )}
        </div>
      )}

      {lines.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {lines.map((line) => (
            <li key={line} className="flex items-start gap-2 text-sm">
              <Lightbulb className="mt-0.5 size-4 shrink-0 text-foreground/70" aria-hidden />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-xs text-foreground/70">
        {t("snackAdvice.card.note")}
      </p>
    </section>
  );
}

const KIND_ICON = { makanan: Utensils, camilan: Cookie, minuman: CupSoda } as const;

/** Kinds the user can pick; 'lainnya' (supplements) only ever comes from the name list. */
export const PICKABLE_KINDS = ["makanan", "camilan", "minuman"] as const;

export type PickableKind = (typeof PICKABLE_KINDS)[number];

/** A kind the picker can show: 'lainnya' reads as makanan there. */
export function pickable(kind: FoodKind): PickableKind {
  return kind === "lainnya" ? "makanan" : kind;
}

/** Row chip: tap to step Makanan, Camilan, Minuman. Advice only, never saved. */
export function KindCycleChip({
  value,
  onChange,
}: {
  value: FoodKind;
  onChange: (next: PickableKind) => void;
}) {
  const { t } = useTranslation("makan");
  const current = pickable(value);
  const next = PICKABLE_KINDS[(PICKABLE_KINDS.indexOf(current) + 1) % PICKABLE_KINDS.length]!;
  const Icon = KIND_ICON[current];
  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      aria-label={t("snackAdvice.kindCycle.aria", {
        current: t(`kind.${current}`),
        next: t(`kind.${next}`),
      })}
      className="inline-flex min-h-6 items-center gap-1 rounded-full bg-muted px-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-border focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      <Icon className="size-3.5" aria-hidden />
      {t(`kind.${current}`)}
    </button>
  );
}

/** Three pills for forms with a single item (manual add, barcode). */
export function KindPicker({
  value,
  onChange,
  className,
}: {
  value: FoodKind;
  onChange: (next: PickableKind) => void;
  className?: string;
}) {
  const { t } = useTranslation("makan");
  const current = pickable(value);
  return (
    <div
      role="radiogroup"
      aria-label={t("snackAdvice.kindPicker.label")}
      className={cn("flex flex-wrap gap-2", className)}
    >
      {PICKABLE_KINDS.map((kind) => {
        const Icon = KIND_ICON[kind];
        const active = kind === current;
        return (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(kind)}
            className={cn(
              "inline-flex min-h-10 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
              active ? "bg-foreground text-background" : "bg-muted text-foreground hover:bg-border",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {t(`kind.${kind}`)}
          </button>
        );
      })}
    </div>
  );
}
