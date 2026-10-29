import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Label } from "@joyorogo/ui/components/label";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileArchive,
  Loader2,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Card, CardHeader, IconChip } from "@/components/kit";
import { PRICING_URL } from "@/components/pro-wall";
import { fmtDateMedium, fmtDecimal, fmtFileSize, fmtInt, localDay } from "@/lib/format";
import { startConversion } from "@/lib/huawei/convert-client";
import { MAX_IMPORT_BYTES, type SendFailure, sendImport } from "@/lib/huawei/send";
import { ConvertError } from "@/lib/huawei/types";
import type { ConvertErrorKind, ConvertProgress, ConvertResult } from "@/lib/huawei/types";

import { DropZone } from "./drop-zone";

/** Where a person asks Huawei for their data (the same address JoyoFit's phone app opens). */
const REQUEST_URL = "https://privacy.consumer.huawei.com/";
const OBJECT_URL_LIFETIME_MS = 30_000;

type Phase =
  | { kind: "idle" }
  | { kind: "converting" }
  | { kind: "failed"; error: Exclude<ConvertErrorKind, "cancelled">; detail: string }
  | { kind: "cancelled" }
  | { kind: "done"; result: ConvertResult };

type Sending =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "failed"; reason: SendFailure };

/** What `startConversion` hands back. */
interface Job {
  result: Promise<ConvertResult>;
  cancel(): void;
}

/** The reading counts shown live while converting. */
const LIVE_COUNTS = [
  ["workouts", "workouts"],
  ["heartRate", "heartRateMinutes"],
  ["sleep", "sleepSegments"],
  ["weighIns", "weighIns"],
  ["meals", "meals"],
  ["unreadable", "badRecords"],
] as const;

/** Third tab of the Unggah page: a Huawei Privacy Centre ZIP becomes an import file in this browser, saved or sent to the phone. */
export default function HuaweiImport() {
  const { t } = useTranslation("fitWebUpload");
  const passwordId = useId();
  const hintId = useId();
  const [file, setFile] = useState<File | null>(null);
  // The password lives in this state only: it is never stored, logged, put in a URL or in the query cache, and it is cleared once a
  // conversion ends.
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [progress, setProgress] = useState<ConvertProgress | null>(null);
  const [sending, setSending] = useState<Sending>({ kind: "idle" });

  const job = useRef<Job | null>(null);
  const sendAbort = useRef<AbortController | null>(null);
  const frame = useRef(0);
  const latest = useRef<ConvertProgress | null>(null);

  useEffect(
    () => () => {
      job.current?.cancel();
      job.current = null;
      sendAbort.current?.abort();
      sendAbort.current = null;
      cancelAnimationFrame(frame.current);
    },
    [],
  );

  const converting = phase.kind === "converting";

  function choose(files: File[]) {
    const next = files[0];
    if (!next || converting) return;
    sendAbort.current?.abort();
    sendAbort.current = null;
    setFile(next);
    setPhase({ kind: "idle" });
    setProgress(null);
    setSending({ kind: "idle" });
  }

  /** The converter may report many times a second; the page repaints once per frame. */
  function report(next: ConvertProgress) {
    latest.current = next;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (job.current) setProgress(latest.current);
    });
  }

  function convert(event: FormEvent) {
    event.preventDefault();
    if (!file || converting) return;
    sendAbort.current?.abort();
    sendAbort.current = null;
    setSending({ kind: "idle" });
    setProgress(null);
    setPhase({ kind: "converting" });
    const current = startConversion(file, password, report);
    job.current = current;
    void current.result.then(
      (result) => {
        if (job.current === current) setPhase({ kind: "done", result });
      },
      (error: unknown) => {
        if (job.current !== current) return;
        if (error instanceof ConvertError) {
          setPhase(
            error.kind === "cancelled"
              ? { kind: "cancelled" }
              : { kind: "failed", error: error.kind, detail: error.message },
          );
        } else {
          setPhase({ kind: "failed", error: "failed", detail: "" });
        }
      },
    ).finally(() => {
      if (job.current !== current) return;
      job.current = null;
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      setProgress(null);
      setPassword("");
    });
  }

  function save(result: ConvertResult) {
    const url = URL.createObjectURL(result.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = result.fileName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_LIFETIME_MS);
  }

  async function send(result: ConvertResult) {
    const controller = new AbortController();
    sendAbort.current?.abort();
    sendAbort.current = controller;
    setSending({ kind: "sending" });
    const outcome = await sendImport(result.blob, result.fileName, controller.signal);
    if (sendAbort.current !== controller) return;
    sendAbort.current = null;
    setSending(outcome.ok ? { kind: "sent" } : { kind: "failed", reason: outcome.reason });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title={t("huawei.title")} subtitle={t("huawei.intro")} />
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-muted-foreground marker:font-semibold marker:text-foreground">
          <li>{t("huawei.how.steps.1")}</li>
          <li>{t("huawei.how.steps.2")}</li>
          <li>{t("huawei.how.steps.3")}</li>
          <li>{t("huawei.how.steps.4")}</li>
        </ol>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<a href={REQUEST_URL} target="_blank" rel="noopener noreferrer" />}
          >
            {t("huawei.how.link")}
            <ExternalLink aria-hidden />
          </Button>
          <p className="text-xs text-muted-foreground">{t("huawei.how.disclaimer")}</p>
        </div>
        <p className="mt-4 flex items-start gap-2 rounded-2xl bg-muted/50 p-3 text-sm">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-recovery" aria-hidden />
          <span className="min-w-0">{t("huawei.local")}</span>
        </p>
      </Card>

      <Card>
        <CardHeader title={t("huawei.convert.title")} subtitle={t("huawei.convert.subtitle")} />
        {!converting && (
          <DropZone
            accept=".zip,application/zip"
            multiple={false}
            onFiles={choose}
            title={t("huawei.drop.title")}
            activeTitle={t("huawei.drop.active")}
            or={t("huawei.drop.or")}
            button={t("huawei.drop.button")}
            hint={t("huawei.drop.hint")}
          />
        )}
        {file && (
          <div
            role="group"
            aria-label={t("huawei.file.label")}
            className="mt-4 flex items-center gap-3 rounded-2xl bg-muted/50 p-3"
          >
            <IconChip className="size-9 bg-primary/10 text-primary">
              <FileArchive className="size-4" aria-hidden />
            </IconChip>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold break-all">{file.name}</p>
              <p className="text-xs text-muted-foreground tabular-nums">{fmtFileSize(file.size)}</p>
            </div>
          </div>
        )}

        <form onSubmit={convert} className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor={passwordId} className="text-sm font-semibold">
              {t("huawei.password.label")}
            </Label>
            <Input
              id={passwordId}
              name="huawei-zip-password"
              type="password"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              aria-describedby={hintId}
              value={password}
              disabled={converting}
              onChange={(event) => setPassword(event.target.value)}
            />
            <p id={hintId} className="text-xs text-muted-foreground">
              {t("huawei.password.hint")}
            </p>
          </div>
          <div>
            <Button type="submit" disabled={!file || converting}>
              {converting && <Loader2 className="animate-spin" aria-hidden />}
              {t("huawei.action.convert")}
            </Button>
          </div>
        </form>

        {converting && <Progress progress={progress} onCancel={() => job.current?.cancel()} />}

        <div aria-live="polite" className="empty:hidden">
          {phase.kind === "failed" && (
            <p
              role="alert"
              className="mt-4 flex items-start gap-1.5 text-sm text-destructive"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">
                {phase.error === "failed" && phase.detail
                  ? t("huawei.errors.failed_detail", { detail: phase.detail })
                  : t(`huawei.errors.${phase.error}`)}
              </span>
            </p>
          )}
          {phase.kind === "cancelled" && (
            <p className="mt-4 text-sm text-muted-foreground">{t("huawei.cancelled")}</p>
          )}
        </div>
      </Card>

      {phase.kind === "done" && (
        <ResultCard
          result={phase.result}
          sending={sending}
          onSave={() => save(phase.result)}
          onSend={() => void send(phase.result)}
        />
      )}
    </div>
  );
}

function Progress({
  progress,
  onCancel,
}: {
  progress: ConvertProgress | null;
  onCancel: () => void;
}) {
  const { t } = useTranslation("fitWebUpload");
  const percent = Math.min(100, Math.max(0, Math.round((progress?.fraction ?? 0) * 100)));
  const reading = progress && progress.fileIndex > 0;
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-muted/50 p-3">
      <div role="status" aria-live="polite">
        <p className="text-sm font-semibold tabular-nums">
          {reading
            ? t("huawei.progress.file", { index: progress.fileIndex, count: progress.fileCount })
            : t("huawei.progress.opening")}
        </p>
        {progress?.fileName && (
          <p className="mt-0.5 text-xs break-all text-muted-foreground">{progress.fileName}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div
          role="progressbar"
          aria-label={t("huawei.progress.label")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="w-11 text-right text-sm font-bold tabular-nums">{percent}%</span>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {LIVE_COUNTS.map(([label, field]) => (
          <Count
            key={label}
            label={t(`huawei.found.${label}`)}
            value={progress?.found[field] ?? 0}
          />
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">{t("huawei.progress.keepOpen")}</p>
      <div>
        <Button variant="outline" size="sm" onClick={onCancel}>
          <X aria-hidden />
          {t("huawei.action.cancel")}
        </Button>
      </div>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-xl bg-card p-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-base font-bold tabular-nums">{fmtInt(value)}</dd>
    </div>
  );
}

function ResultCard({
  result,
  sending,
  onSave,
  onSend,
}: {
  result: ConvertResult;
  sending: Sending;
  onSave: () => void;
  onSend: () => void;
}) {
  const { t } = useTranslation("fitWebUpload");
  const { summary, profile } = result;
  const empty = summary.oldestSec === null || summary.newestSec === null;

  const counts: { key: string; label: string; value: number }[] = [
    { key: "workouts", label: t("huawei.found.workouts"), value: summary.workoutsFound },
    { key: "heartRate", label: t("huawei.found.heartRate"), value: summary.heartRateReadings },
    { key: "sleep", label: t("huawei.found.sleep"), value: summary.sleepSegmentsFound },
    { key: "weighIns", label: t("huawei.found.weighIns"), value: summary.weighInsFound },
    { key: "meals", label: t("huawei.found.meals"), value: summary.mealsFound },
  ];
  // Kinds that most exports have none of stay out of the way until they have something.
  const optional: { key: string; label: string; value: number }[] = [
    { key: "restingHr", label: t("huawei.found.restingHr"), value: summary.restingHeartRateReadings },
    { key: "spo2", label: t("huawei.found.spo2"), value: summary.spo2Readings },
    { key: "stress", label: t("huawei.found.stress"), value: summary.stressReadings },
    { key: "metrics", label: t("huawei.found.metrics"), value: summary.metricsFound },
    { key: "sleepScores", label: t("huawei.found.sleepScores"), value: summary.sleepScoresFound },
    { key: "dayTotals", label: t("huawei.found.dayTotals"), value: summary.dayTotalsFound },
    { key: "waterDays", label: t("huawei.found.waterDays"), value: summary.waterDaysFound },
  ];
  for (const entry of optional) if (entry.value > 0) counts.push(entry);

  const profileParts: string[] = [];
  if (profile.heightCm !== undefined)
    profileParts.push(t("huawei.result.profile.height", { value: fmtInt(profile.heightCm) }));
  if (profile.weightKg !== undefined)
    profileParts.push(
      t("huawei.result.profile.weight", {
        value: fmtDecimal(profile.weightKg, Number.isInteger(profile.weightKg) ? 0 : 1),
      }),
    );
  if (profile.sex !== undefined)
    profileParts.push(
      t("huawei.result.profile.sex", { value: t(`huawei.result.profile.${profile.sex}`) }),
    );
  if (profile.birthYear !== undefined)
    profileParts.push(t("huawei.result.profile.birthYear", { value: profile.birthYear }));

  const unreadable: string[] = [];
  if (summary.badRecords > 0)
    unreadable.push(t("huawei.result.unreadable.badRecords", { count: summary.badRecords }));
  if (summary.filesFailed > 0)
    unreadable.push(t("huawei.result.unreadable.filesFailed", { count: summary.filesFailed }));
  if (summary.rejectedSamples > 0)
    unreadable.push(t("huawei.result.unreadable.rejected", { count: summary.rejectedSamples }));

  return (
    <Card aria-labelledby="huawei-result-title">
      <div role="status" aria-live="polite">
        <CardHeader
          title={<span id="huawei-result-title">{t("huawei.result.title")}</span>}
          subtitle={
            empty
              ? undefined
              : t("huawei.result.range", {
                  from: fmtDateMedium(localDay(summary.oldestSec as number)),
                  to: fmtDateMedium(localDay(summary.newestSec as number)),
                })
          }
        />
        {empty ? (
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="min-w-0">{t("huawei.result.empty")}</span>
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {counts.map((entry) => (
                <Count key={entry.key} label={entry.label} value={entry.value} />
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground tabular-nums">
              {t("huawei.result.fileSize", { size: fmtFileSize(result.blob.size) })}
            </p>
            {profileParts.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("huawei.result.profile.line", { parts: profileParts.join(", ") })}
              </p>
            )}
            {unreadable.length > 0 && (
              <div className="mt-3 rounded-2xl bg-muted/50 p-3 text-xs">
                <p className="font-bold">{t("huawei.result.unreadable.title")}</p>
                <ul className="mt-1.5 flex flex-col gap-1 text-muted-foreground">
                  {unreadable.map((line) => (
                    <li key={line} className="tabular-nums">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      {!empty && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2 rounded-2xl bg-muted/50 p-3">
              <Button variant="outline" onClick={onSave}>
                <Download aria-hidden />
                {t("huawei.action.save")}
              </Button>
              <p className="text-xs text-muted-foreground">{t("huawei.save.hint")}</p>
            </div>
            <div className="flex flex-col gap-2 rounded-2xl bg-muted/50 p-3">
              <Button
                onClick={onSend}
                disabled={sending.kind === "sending" || sending.kind === "sent"}
              >
                {sending.kind === "sending" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Send aria-hidden />
                )}
                {sending.kind === "sending" ? t("huawei.action.sending") : t("huawei.action.send")}
              </Button>
              <p className="text-xs text-muted-foreground">{t("huawei.send.hint")}</p>
              <div aria-live="polite" className="empty:hidden">
                {sending.kind === "sent" && (
                  <p className="flex items-start gap-1.5 text-xs text-recovery">
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span className="min-w-0">{t("huawei.send.sent")}</span>
                  </p>
                )}
                {sending.kind === "failed" && (
                  <div role="alert">
                    <p className="flex items-start gap-1.5 text-xs text-destructive">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      <span className="min-w-0">
                        {sending.reason === "too_large"
                          ? t("huawei.send.errors.too_large", {
                              mb: MAX_IMPORT_BYTES / 1024 / 1024,
                            })
                          : t(`huawei.send.errors.${sending.reason}`)}
                      </span>
                    </p>
                    {sending.reason === "paywall" && (
                      <Button
                        size="xs"
                        className="mt-2"
                        nativeButton={false}
                        render={<a href={PRICING_URL} />}
                      >
                        {t("huawei.action.pricing")}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{t("huawei.result.memory")}</p>
        </>
      )}
    </Card>
  );
}
