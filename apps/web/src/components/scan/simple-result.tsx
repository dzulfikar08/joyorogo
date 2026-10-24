import { kcalUnit } from "@joyorogo/i18n";
import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";
import { Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { CountUp } from "@/components/kit/count-up";
import { Card, ListGroup, Page, PageHeader, Segmented } from "@/components/kit/surface";
import { CORRECTED_ROW_CLASS, CorrectBadge, LiveCaption } from "@/components/scan/correct-box";
import type { CorrectionKind, ScanCorrection } from "@/components/scan/correct-box";
import { HoldMic } from "@/components/scan/hold-mic";

export interface SimpleRow {
  name: string;
  /** Grams or portion, already formatted. */
  amount: string | null;
  kcal: string;
  thumb: ReactNode;
  changed?: CorrectionKind;
}

/**
 * "Mode simpel": the food list, one mic for a spoken correction and Simpan. Presentational: the screen owns the list
 * and the correction (`useScanCorrection`), so this is the same ai.correctScan path as the "Ada yang kurang pas?" box.
 */
export function SimpleResult<M extends string>({
  rows,
  totalKcal,
  correction,
  notice,
  canUndo,
  onUndo,
  meal,
  meals,
  onMeal,
  mealLabel,
  saveLabel,
  busy,
  onSave,
  onDetail,
  onRetake,
  banner,
}: {
  rows: SimpleRow[];
  totalKcal: number;
  correction: ScanCorrection;
  notice: string | null;
  canUndo: boolean;
  onUndo: () => void;
  meal: M;
  meals: ReadonlyArray<{ value: M; label: string }>;
  onMeal: (meal: M) => void;
  mealLabel: string;
  saveLabel: string;
  busy: boolean;
  onSave: () => void;
  onDetail: () => void;
  onRetake: () => void;
  /** Shown above the list (the screen's own status line). */
  banner?: ReactNode;
}) {
  const { t } = useTranslation(["scan", "common"]);
  const { phase, error, heard, live } = correction;
  const recording = phase === "recording";
  const working = phase === "working";

  return (
    <Page className="stagger-enter md:max-w-3xl">
      <PageHeader
        className="pb-3"
        title={t("simple.title")}
        action={
          <Button variant="ghost" size="sm" onClick={onRetake}>
            {t("result.retake")}
          </Button>
        }
      />

      {banner}

      {rows.length > 1 && (
        <Card className="flex items-baseline justify-between gap-3 px-4 py-3">
          <p className="text-sm font-semibold text-muted-foreground">{t("simple.total")}</p>
          <p className="text-3xl leading-none font-extrabold tracking-tighter tabular-nums">
            <CountUp value={totalKcal} duration={700} />
            <span className="ml-1.5 text-sm font-semibold tracking-normal text-muted-foreground">
              {kcalUnit()}
            </span>
          </p>
        </Card>
      )}

      <section className="mt-3" aria-label={t("result.items.label")}>
        <ListGroup>
          {rows.map((row, index) => (
            <li
              key={`${row.name}-${index}`}
              className={cn(
                "flex min-h-14 items-center gap-2.5 px-4 py-2",
                row.changed && CORRECTED_ROW_CLASS,
              )}
            >
              {row.thumb}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 truncate text-[0.9375rem] font-semibold">
                    {row.name}
                  </span>
                  {row.changed && <CorrectBadge kind={row.changed} />}
                </span>
                {row.amount && (
                  <span className="block text-[0.8125rem] leading-snug text-muted-foreground">
                    {row.amount}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-[0.9375rem] font-bold tabular-nums">
                {row.kcal}
                <span className="ml-1 text-xs font-semibold text-muted-foreground">
                  {kcalUnit()}
                </span>
              </span>
            </li>
          ))}
        </ListGroup>
      </section>

      <div className="mt-4">
        <HoldMic correction={correction} idleLabel={t("simple.mic")} ariaLabel={t("simple.micAria")} />
        <div className="mt-2 space-y-1 text-center text-sm" aria-live="polite">
          {recording && <p className="text-muted-foreground">{t("simple.micRelease")}</p>}
          {heard && <p className="text-muted-foreground">{t("correct.heard", { text: heard })}</p>}
          {error && (
            <p className="font-semibold text-destructive" role="alert">
              {error}
            </p>
          )}
          {!working && !recording && !error && notice && (
            <p className="font-semibold text-primary">{notice}</p>
          )}
          {canUndo && !working && !recording && (
            <Button type="button" variant="ghost" size="xs" onClick={onUndo}>
              <Undo2 aria-hidden />
              {t("correct.undo")}
            </Button>
          )}
          {live?.text ? (
            <LiveCaption live={live} className="font-semibold text-foreground" />
          ) : (
            !recording && <p className="text-xs text-muted-foreground">{t("simple.examples")}</p>
          )}
        </div>
      </div>

      <Segmented
        className="mt-4"
        label={mealLabel}
        value={meal}
        onChange={onMeal}
        options={meals}
      />

      <div className="mt-3 flex justify-center">
        <Button variant="ghost" size="sm" aria-label={t("simple.detailAria")} onClick={onDetail}>
          {t("simple.detail")}
        </Button>
      </div>

      {/* Mobile: the primary pill floats above the tab bar; desktop: inline. */}
      <div
        style={{ animation: "none" }}
        className="fixed inset-x-0 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-30 px-4 md:static md:mt-6 md:px-0"
      >
        <div className="mx-auto flex max-w-[41rem] items-center gap-2 md:max-w-none">
          <Button
            size="lg"
            className="w-full shadow-float md:w-auto"
            onClick={onSave}
            disabled={busy}
          >
            {saveLabel}
          </Button>
        </div>
      </div>
      {/* Clearance so the floating pill never covers the last row. */}
      <div aria-hidden className="h-24 md:hidden" />
    </Page>
  );
}
