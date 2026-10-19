import { fmtDateShort } from "@joyorogo/i18n";
import { Button } from "@joyorogo/ui/components/button";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download, FileJson, Loader2, Route, X } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Card, CardHeader, Segmented } from "@/components/kit";
import { RangeControls } from "@/components/range-controls";
import { orpc } from "@/lib/orpc";
import { type RangeDays, windowOf } from "@/lib/range";

import { Pill } from "./shared";

const FORMATS = ["gpx", "fit", "json"] as const;
type Format = (typeof FORMATS)[number];

/** One ZIP holds at most this many workouts (`BULK_LIMIT` in `lib/export/bulk.ts`, which stays a lazy chunk). */
const BULK_LIMIT = 100;

type Problem = "no_gps" | "not_found" | "unreadable" | "unavailable" | "network";

type Run =
  | { phase: "idle" }
  | { phase: "running"; done: number; total: number; zipping: boolean }
  | {
      phase: "finished";
      files: number;
      problems: { start: number; problem: Problem }[];
      cancelled: boolean;
      unauthorized: boolean;
      tooBig: boolean;
    };

/** Bulk export: a range and a format, workouts fetched one by one with progress and a cancel, one ZIP at the end. */
export function ExportBulkCard() {
  const { t } = useTranslation("fitWebConnect");
  const [range, setRange] = useState<RangeDays>(30);
  const [format, setFormat] = useState<Format>("gpx");
  const [run, setRun] = useState<Run>({ phase: "idle" });
  const abort = useRef<AbortController | null>(null);
  const win = windowOf(range);
  const list = useQuery(orpc.fitWeb.workouts.queryOptions({ input: win }));

  const items = list.data?.items.slice(0, BULK_LIMIT) ?? [];
  const total = list.data?.items.length ?? 0;
  const noGps = format === "gpx" ? items.filter((w) => !w.hasGps).length : 0;
  const running = run.phase === "running";

  const start = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setRun({ phase: "running", done: 0, total: items.length, zipping: false });
    try {
      // Dynamic on purpose: code-splitting keeps the encoders, schema validation and ZIP writer out of the main bundle.
      const { exportWorkouts } = await import("@/lib/export/run");
      const outcome = await exportWorkouts({
        items: items.map((w) => ({ start: w.start, hasGps: w.hasGps })),
        format,
        from: win.from,
        to: win.to,
        signal: controller.signal,
        onProgress: (progress) =>
          setRun({ phase: "running", done: progress.done, total: progress.total, zipping: false }),
        onZipping: () =>
          setRun((prev) => (prev.phase === "running" ? { ...prev, zipping: true } : prev)),
      });
      setRun({ phase: "finished", ...outcome });
    } catch {
      setRun({
        phase: "finished",
        files: 0,
        problems: items.map((w) => ({ start: w.start, problem: "unreadable" as const })),
        cancelled: false,
        unauthorized: false,
        tooBig: false,
      });
    } finally {
      abort.current = null;
    }
  };

  const formatOptions = FORMATS.map((value) => ({
    value,
    label: t(`export.formats.${value}.name`),
  }));

  return (
    <Card className="flex flex-col gap-4">
      <CardHeader
        className="mb-0"
        title={t("export.bulk.title")}
        subtitle={t("export.bulk.subtitle")}
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold text-muted-foreground">{t("export.bulk.range")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <RangeControls
              range={range}
              onRange={(next) => {
                if (running) return;
                setRange(next);
                setRun({ phase: "idle" });
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {fmtDateShort(win.from)} – {fmtDateShort(win.to)}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold text-muted-foreground">{t("export.bulk.format")}</p>
          <Segmented<Format>
            className="self-start"
            label={t("export.bulk.format")}
            value={format}
            onChange={(next) => {
              if (running) return;
              setFormat(next);
              setRun({ phase: "idle" });
            }}
            options={formatOptions}
          />
          <p className="text-xs text-muted-foreground">{t(`export.formats.${format}.desc`)}</p>
        </div>
      </div>

      {list.isPending ? (
        <Skeleton className="h-16 w-full rounded-2xl" />
      ) : list.isError ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-muted p-3 text-sm">
          <p className="min-w-0 flex-1 text-destructive">{t("export.bulk.listError")}</p>
          <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
            {t("export.bulk.retry")}
          </Button>
        </div>
      ) : total === 0 ? (
        <p className="rounded-2xl bg-muted/60 px-4 py-6 text-center text-sm text-muted-foreground">
          {t("export.bulk.empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-2 rounded-2xl bg-muted/60 p-3.5 text-sm">
          <p className="font-semibold tabular-nums">
            {t("export.bulk.count", { count: items.length })}
          </p>
          {total > BULK_LIMIT && (
            <p className="text-xs text-muted-foreground">
              {t("export.bulk.capNote", { max: BULK_LIMIT })}
            </p>
          )}
          {noGps > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("export.bulk.noGps", { count: noGps })}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={running || items.length === 0 || (format === "gpx" && noGps === items.length)}
          onClick={() => void start()}
        >
          {running ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
          {t("export.bulk.start", { count: items.length })}
        </Button>
        {running && (
          <Button variant="outline" onClick={() => abort.current?.abort()}>
            <X aria-hidden />
            {t("export.bulk.cancel")}
          </Button>
        )}
      </div>

      <div role="status" aria-live="polite" className="flex flex-col gap-2 empty:hidden">
        {run.phase === "running" && (
          <div>
            <p className="text-sm font-semibold tabular-nums">
              {run.zipping
                ? t("export.bulk.zipping")
                : t("export.bulk.progress", { done: run.done, total: run.total })}
            </p>
            <div
              role="progressbar"
              aria-label={t("export.bulk.title")}
              aria-valuemin={0}
              aria-valuemax={run.total}
              aria-valuenow={run.done}
              className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${run.total > 0 ? (run.done / run.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
        {run.phase === "finished" && (
          <>
            <p
              className={
                run.unauthorized || run.tooBig || (run.files === 0 && !run.cancelled)
                  ? "text-sm text-destructive"
                  : "text-sm text-recovery"
              }
            >
              {run.unauthorized
                ? t("export.bulk.unauthorized")
                : run.tooBig
                  ? t("export.bulk.tooBig")
                  : run.cancelled
                    ? t("export.bulk.cancelled")
                    : run.files === 0
                      ? t("export.bulk.nothing")
                      : run.files === 1
                        ? t("export.bulk.doneOne")
                        : t("export.bulk.done", { count: run.files })}
            </p>
            {run.problems.length > 0 && (
              <div className="rounded-2xl bg-muted/60 p-3 text-xs">
                <p className="font-bold">
                  {t("export.bulk.problemsTitle")}{" "}
                  <span className="tabular-nums">({run.problems.length})</span>
                </p>
                <ul className="mt-1.5 flex max-h-40 flex-col gap-1 overflow-y-auto">
                  {run.problems.map((p) => (
                    <li key={p.start} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <Link
                        to="/latihan/$start"
                        params={{ start: String(p.start) }}
                        className="font-semibold text-primary underline-offset-4 hover:underline"
                      >
                        {new Date(p.start * 1000).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </Link>
                      <Pill tone="quiet">{t(`export.bulk.problem.${p.problem}`)}</Pill>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

/** What each format holds, and where a single workout is exported from. */
export function ExportFormatsCard() {
  const { t } = useTranslation("fitWebConnect");
  return (
    <Card className="flex flex-col gap-4">
      <CardHeader className="mb-0" title={t("export.formats.title")} />
      <ul className="flex flex-col gap-3">
        {FORMATS.map((format) => (
          <li key={format} className="flex gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              {format === "json" ? (
                <FileJson className="size-4" aria-hidden />
              ) : (
                <Route className="size-4" aria-hidden />
              )}
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-bold">{t(`export.formats.${format}.name`)}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t(`export.formats.${format}.desc`)}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <div className="rounded-2xl bg-muted/60 p-3.5">
        <h3 className="text-sm font-bold">{t("export.single.title")}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("export.single.body")}</p>
        <Link
          to="/latihan"
          className="mt-1 inline-flex min-h-9 items-center text-sm font-semibold text-primary underline underline-offset-4"
        >
          {t("export.single.cta")}
        </Link>
      </div>
    </Card>
  );
}
