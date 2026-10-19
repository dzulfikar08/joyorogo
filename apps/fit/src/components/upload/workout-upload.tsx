import type { FitWebWorkout } from "@joyorogo/api/lib/fit-web";
import { fmtClock, fmtDateMedium } from "@joyorogo/i18n";
import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Check, CheckCircle2, FileUp, Loader2, RotateCw, X } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { Card, CardHeader, IconChip } from "@/components/kit";
import { DropZone } from "./drop-zone";
import { PRICING_URL } from "@/components/pro-wall";
import { kindOf, maxHrFromAge } from "@/lib/import/analysis";
import { MAX_FILE_BYTES } from "@/lib/import/read";
import { type Prepared, prepareFile } from "@/lib/import/pipeline";
import { type UploadResult, uploadWorkout } from "@/lib/import/upload";
import { fmtFileSize, fmtHm, fmtKm, wibDay } from "@/lib/format";
import { orpc } from "@/lib/orpc";
import { sportIcon } from "@/lib/sport";

type ItemState =
  | { kind: "reading" }
  | Prepared
  | { kind: "uploading"; prepared: Extract<Prepared, { kind: "ready" }> }
  | { kind: "done"; prepared: Extract<Prepared, { kind: "ready" }>; result: UploadResult };

interface Item {
  id: number;
  name: string;
  size: number;
  /** A ready file the person has not unticked. */
  selected: boolean;
  state: ItemState;
}

const ACCEPT = ".fit,.gpx,.tcx,application/gpx+xml,application/vnd.garmin.tcx+xml";
let nextId = 1;

const preparedOf = (state: ItemState): Extract<Prepared, { kind: "ready" }> | null =>
  state.kind === "ready"
    ? state
    : state.kind === "uploading" || state.kind === "done"
      ? state.prepared
      : null;

/** Files to read (drag and drop or the picker), prepare one by one, tick, and upload to the cloud. */
export function WorkoutUpload() {
  const { t } = useTranslation("fitWebUpload");
  const queryClient = useQueryClient();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const profile = useQuery(orpc.profile.myProfile.queryOptions());

  // Maximum heart rate for the zones: the app's age rule, from the profile's birth year when there is one.
  const birthYear = profile.data?.profile?.birthYear;
  const age = birthYear ? new Date().getFullYear() - birthYear : null;
  const analysisOptions = { maxHr: maxHrFromAge(age), maxHrSource: "age" as const };

  const patch = useCallback((id: number, change: Partial<Item>) => {
    setItems((all) => all.map((item) => (item.id === id ? { ...item, ...change } : item)));
  }, []);

  const lookup = useCallback(
    async (from: string, to: string): Promise<readonly FitWebWorkout[]> =>
      (
        await queryClient.fetchQuery({
          ...orpc.fitWeb.workouts.queryOptions({ input: { from, to } }),
          staleTime: 0,
        })
      ).items,
    [queryClient],
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const added: Item[] = files.map((file) => ({
        id: nextId++,
        name: file.name,
        size: file.size,
        selected: true,
        state: { kind: "reading" },
      }));
      setItems((all) => [...added, ...all]);
      // One at a time: a day of 1 Hz points is a lot of memory, and the lookups are cached per day.
      for (const [index, file] of files.entries()) {
        const id = (added[index] as Item).id;
        try {
          patch(id, { state: await prepareFile(file, analysisOptions, lookup) });
        } catch {
          patch(id, { state: { kind: "failed", reason: "corrupt" } });
        }
      }
    },
    // The options only change with the profile; reading a file always uses the latest render's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [patch, lookup, analysisOptions.maxHr],
  );

  const uploadable = items.filter(
    (item) => item.state.kind === "ready" && item.selected && !item.state.collision,
  );
  const finished = items.filter((item) => item.state.kind === "done").length;

  async function upload(targets: Item[]) {
    setBusy(true);
    try {
      for (const item of targets) {
        const prepared = preparedOf(item.state);
        if (!prepared) continue;
        patch(item.id, { state: { kind: "uploading", prepared } });
        const result = await uploadWorkout(prepared.built.start, prepared.built.gzip);
        patch(item.id, { state: { kind: "done", prepared, result } });
        // A paywall or an ended session will not get better for the next file.
        if (!result.ok && (result.reason === "paywall" || result.reason === "unauthorized")) break;
      }
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: orpc.fitWeb.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.watchWorkout.key() });
    }
  }

  return (
    <Card>
      <CardHeader title={t("workouts.title")} subtitle={t("workouts.intro")} />

      <DropZone
        accept={ACCEPT}
        onFiles={(files) => void addFiles(files)}
        title={t("workouts.drop.title")}
        activeTitle={t("workouts.drop.active")}
        or={t("workouts.drop.or")}
        button={t("workouts.drop.button")}
        hint={t("workouts.drop.hint", { mb: MAX_FILE_BYTES / 1024 / 1024 })}
      />

      {items.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-muted-foreground" aria-live="polite">
              {t("workouts.list.summary", {
                done: finished,
                total: items.filter((i) => i.state.kind !== "failed").length,
              })}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="xs" disabled={busy} onClick={() => setItems([])}>
                {t("workouts.action.clear")}
              </Button>
              <Button
                size="sm"
                disabled={busy || uploadable.length === 0}
                onClick={() => void upload(uploadable)}
              >
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {t("workouts.action.upload", { count: uploadable.length })}
              </Button>
            </div>
          </div>
          <ul aria-label={t("workouts.list.label")} className="flex flex-col gap-2">
            {items.map((item) => (
              <FileRow
                key={item.id}
                item={item}
                busy={busy}
                onToggle={() => patch(item.id, { selected: !item.selected })}
                onRemove={() => setItems((all) => all.filter((i) => i.id !== item.id))}
                onRetry={() => {
                  const prepared = preparedOf(item.state);
                  if (prepared) void upload([{ ...item, state: prepared }]);
                }}
              />
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">{t("workouts.notes.analysis")}</p>
        </div>
      )}
    </Card>
  );
}

function FileRow({
  item,
  busy,
  onToggle,
  onRemove,
  onRetry,
}: {
  item: Item;
  busy: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation("fitWebUpload");
  const prepared = preparedOf(item.state);
  const activity = prepared?.activity;
  const Icon = activity ? sportIcon(activity.name, kindOf(activity.sport.kind)) : FileUp;
  const selectable = item.state.kind === "ready" && !item.state.collision;

  return (
    <li className="rounded-2xl bg-muted/50 p-3">
      <div className="flex items-start gap-3">
        {selectable ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={item.selected}
            aria-label={t("workouts.action.select", { name: item.name })}
            onClick={onToggle}
            className={cn(
              "mt-1 grid size-6 shrink-0 place-items-center rounded-md border-2 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              item.selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card",
            )}
          >
            {item.selected && <Check className="size-4" aria-hidden />}
          </button>
        ) : (
          <IconChip className="mt-0.5 size-7 bg-card text-muted-foreground">
            <Icon className="size-4" aria-hidden />
          </IconChip>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p className="text-sm font-bold break-words">{activity?.name ?? item.name}</p>
            {activity && (
              <span className="rounded-full bg-card px-2 py-0.5 text-[0.6875rem] font-bold text-muted-foreground">
                {t(`workouts.format.${activity.format}`)}
              </span>
            )}
          </div>
          <p className="text-xs break-all text-muted-foreground">
            {activity ? item.name : fmtFileSize(item.size)}
          </p>
          {activity && (
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs tabular-nums sm:grid-cols-4">
              <Fact
                label={t("workouts.meta.at", {
                  date: fmtDateMedium(wibDay(activity.start)),
                  time: fmtClock(new Date(activity.start * 1000)),
                })}
              />
              <Fact label={activity.distance > 0 ? fmtKm(activity.distance) : "–"} />
              <Fact label={fmtHm(activity.timerSeconds)} />
              <Fact label={t("workouts.meta.points", { count: prepared?.built.pointCount ?? 0 })} />
            </dl>
          )}
          <Status item={item} onRetry={onRetry} busy={busy} />
        </div>
        {item.state.kind !== "uploading" && (
          <button
            type="button"
            aria-label={t("workouts.action.remove", { name: item.name })}
            onClick={onRemove}
            className="-mt-1 -mr-1 grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-card hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
    </li>
  );
}

function Fact({ label }: { label: string }) {
  return <dd className="min-w-0 break-words">{label}</dd>;
}

function Note({
  tone,
  icon,
  children,
}: {
  tone: "muted" | "good" | "bad";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "mt-2 flex items-start gap-1.5 text-xs",
        tone === "good"
          ? "text-recovery"
          : tone === "bad"
            ? "text-destructive"
            : "text-muted-foreground",
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function Status({ item, onRetry, busy }: { item: Item; onRetry: () => void; busy: boolean }) {
  const { t } = useTranslation("fitWebUpload");
  const { state } = item;
  if (state.kind === "reading") {
    return (
      <Note tone="muted" icon={<Loader2 className="size-3.5 animate-spin" aria-hidden />}>
        {t("workouts.state.reading")}
      </Note>
    );
  }
  if (state.kind === "failed") {
    const reason =
      state.reason === "too-large"
        ? t("workouts.errors.too-large")
        : t(`workouts.errors.${state.reason}`);
    return (
      <Note tone="bad" icon={<AlertTriangle className="size-3.5" aria-hidden />}>
        {reason}
      </Note>
    );
  }
  if (state.kind === "uploading") {
    return (
      <Note tone="muted" icon={<Loader2 className="size-3.5 animate-spin" aria-hidden />}>
        {t("workouts.state.uploading")}
      </Note>
    );
  }
  if (state.kind === "done") {
    const { result } = state;
    if (result.ok) {
      return (
        <div>
          <Note tone="good" icon={<CheckCircle2 className="size-3.5" aria-hidden />}>
            {t(`workouts.state.${result.status}`)}{" "}
            <Link
              to="/latihan/$start"
              params={{ start: String(result.start) }}
              className="font-semibold underline underline-offset-2"
            >
              {t("workouts.action.open")}
            </Link>
          </Note>
          {!state.prepared.built.hasAnalysis && (
            <Note tone="muted" icon={<AlertTriangle className="size-3.5" aria-hidden />}>
              {t("workouts.notes.noAnalysis")}
            </Note>
          )}
        </div>
      );
    }
    return (
      <div>
        <Note tone="bad" icon={<AlertTriangle className="size-3.5" aria-hidden />}>
          {result.reason === "invalid" && result.detail
            ? `${t("workouts.errors.invalid")} (${result.detail})`
            : t(`workouts.errors.${result.reason === "too-large" ? "too-large" : result.reason}`)}
        </Note>
        {result.reason === "paywall" ? (
          <Button size="xs" className="mt-2" nativeButton={false} render={<a href={PRICING_URL} />}>
            {t("workouts.action.pricing")}
          </Button>
        ) : result.reason === "network" || result.reason === "server" ? (
          <Button size="xs" variant="outline" className="mt-2" disabled={busy} onClick={onRetry}>
            <RotateCw aria-hidden />
            {t("workouts.action.retry")}
          </Button>
        ) : null}
      </div>
    );
  }
  // ready
  if (state.collision) {
    const { kind, with: other } = state.collision;
    const params = { name: other.sportName, date: fmtDateMedium(other.date) };
    return (
      <Note tone="muted" icon={<AlertTriangle className="size-3.5" aria-hidden />}>
        {t(`workouts.collision.${kind}`, params)}
      </Note>
    );
  }
  return (
    <div>
      <Note tone="muted" icon={<Check className="size-3.5" aria-hidden />}>
        {t("workouts.state.ready")}
      </Note>
      {!state.built.hasAnalysis && (
        <Note tone="muted" icon={<AlertTriangle className="size-3.5" aria-hidden />}>
          {t("workouts.notes.noAnalysis")}
        </Note>
      )}
      {state.built.thinned && (
        <Note tone="muted" icon={<AlertTriangle className="size-3.5" aria-hidden />}>
          {t("workouts.notes.thinned")}
        </Note>
      )}
    </div>
  );
}
