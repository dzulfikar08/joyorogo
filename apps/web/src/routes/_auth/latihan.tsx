import { Button } from "@joyorogo/ui/components/button";
import { Card, Page, PageHeader, SectionTitle } from "@/components/kit/surface";
import { ScreenError } from "@/components/screen-state";
import { MuscleMap } from "@/components/workout/muscle-map";
import {
  type SessionDraft,
  SessionEditor,
  draftFromSession,
  draftFromTemplate,
} from "@/components/workout/session-editor";
import type { WorkoutStatus } from "@/lib/api-types";
import { fmtDateIndo, fmtInt } from "@/lib/format";
import { orpc } from "@/utils/orpc";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown, Dumbbell, Plus, RotateCcw, Trophy } from "lucide-react";
import { useState } from "react";

import { jakartaToday } from "@joyorogo/api/lib/engine";

export const Route = createFileRoute("/_auth/latihan")({
  component: LatihanPage,
});

const emptyDraft = (): SessionDraft => ({
  date: jakartaToday(),
  name: "",
  durationMin: "45",
  note: "",
  exercises: [],
});

function prLine(pr: WorkoutStatus["prs"][number]): string {
  const best = pr.bestSet;
  if (!best) return "–";
  const weight = best.weightKg != null ? `${fmtInt(best.weightKg)} kg` : "tanpa beban";
  return `${best.reps}× ${weight}`;
}

function e1rmLine(pr: WorkoutStatus["prs"][number]): string | null {
  if (pr.best1RM === null) return null;
  return `e1RM ${fmtInt(pr.best1RM.e1rm ?? 0)} kg`;
}

function ProgressCard({ status }: { status: WorkoutStatus }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const history = useQuery(orpc.workout.listSessions.queryOptions({ input: { limit: 20 } }));

  if (status.prs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Belum ada rekor. Selesaikan satu sesi, rekor gerakan muncul di sini.
      </p>
    );
  }

  const open = status.prs.find((pr) => pr.exerciseId === openId) ?? null;
  const openHistory = open
    ? (history.data?.items ?? []).filter((item) =>
        item.sets.some((set) => set.exerciseId === open.exerciseId),
      )
    : [];

  return (
    <div className="space-y-1">
      {status.prs.slice(0, 12).map((pr) => {
        const isOpen = pr.exerciseId === openId;
        return (
          <div key={pr.exerciseId} className="rounded-2xl border border-border">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpenId(isOpen ? null : pr.exerciseId)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              <Trophy className="size-4 shrink-0 text-amber-500" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{pr.name}</span>
                <span className="block text-xs text-muted-foreground">
                  Rekor: {prLine(pr)}
                  {e1rmLine(pr) ? ` · ${e1rmLine(pr)}` : ""}
                </span>
              </span>
              <ChevronDown
                className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                aria-hidden
              />
            </button>
            {isOpen && (
              <ul className="space-y-1 border-t border-border px-4 py-3">
                {openHistory.length === 0 && (
                  <li className="text-xs text-muted-foreground">Memuat riwayat…</li>
                )}
                {openHistory.map((item) => {
                  if (!open) return null;
                  const sets = item.sets.filter((set) => set.exerciseId === open.exerciseId);
                  const best = sets.reduce(
                    (acc, s) =>
                      s.weightKg !== null && s.weightKg > (acc?.weightKg ?? -1) ? s : acc,
                    sets[0],
                  );
                  return (
                    <li key={item.session.id} className="text-xs text-muted-foreground">
                      <span className="font-bold text-foreground">
                        {fmtDateIndo(item.session.date)}
                      </span>
                      {" — "}
                      {sets
                        .map(
                          (s) =>
                            `${s.reps}×${s.weightKg != null ? `${fmtInt(s.weightKg)}kg` : "BW"}`,
                        )
                        .join(", ")}
                      {best?.rpe != null ? ` · RPE ${fmtInt(best.rpe)}` : ""}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LatihanScreen() {
  const status = useQuery(orpc.workout.status.queryOptions({ input: {} }));
  const templates = useQuery(orpc.workout.templates.queryOptions());
  const last = useQuery(orpc.workout.lastSession.queryOptions());
  const history = useQuery(orpc.workout.listSessions.queryOptions({ input: { limit: 20 } }));
  const catalog = useQuery(orpc.workout.catalog.queryOptions());

  const [draft, setDraft] = useState<SessionDraft | null>(null);
  const nameOf = (id: string) => catalog.data?.exercises.find((e) => e.id === id)?.name ?? id;

  const quickStart = [
    ...(last.data
      ? [
          {
            key: "repeat",
            label: `Ulangi: ${last.data.session.name}`,
            icon: <RotateCcw className="size-4" aria-hidden />,
            run: () => setDraft(draftFromSession(last.data!)),
          },
        ]
      : []),
    ...(templates.data ?? []).map((template) => ({
      key: template.id,
      label: template.name,
      icon: <Dumbbell className="size-4" aria-hidden />,
      run: () => setDraft(draftFromTemplate(template.id, templates.data ?? [], nameOf)),
    })),
    {
      key: "empty",
      label: "Sesi kosong",
      icon: <Plus className="size-4" aria-hidden />,
      run: () => setDraft(emptyDraft()),
    },
  ];

  return (
    <Page className="max-w-xl lg:max-w-3xl">
      <PageHeader
        title="Latihan Beban"
        subtitle="Turun berat tanpa kehilangan otot. Catat gerakan, set, dan beban."
      />

      {draft && (
        <div className="mb-5">
          <SessionEditor draft={draft} onClose={() => setDraft(null)} />
        </div>
      )}

      <SectionTitle>Mulai cepat</SectionTitle>
      <div className="mb-5 flex flex-wrap gap-2">
        {quickStart.map((option) => (
          <Button
            key={option.key}
            variant="secondary"
            size="sm"
            onClick={option.run}
            disabled={draft !== null}
          >
            {option.icon} {option.label}
          </Button>
        ))}
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-2 lg:gap-5">
        <Card className="space-y-3">
          <SectionTitle>Peta otot minggu ini</SectionTitle>
          {status.isPending ? (
            <p className="text-sm text-muted-foreground">Menghitung volume otot…</p>
          ) : status.error ? (
            <p className="text-sm text-destructive">{status.error.message}</p>
          ) : (
            <MuscleMap status={status.data} />
          )}
        </Card>

        <div className="min-w-0 space-y-3 lg:space-y-5">
          <Card className="space-y-3">
            <SectionTitle>Progres kekuatan</SectionTitle>
            {status.data ? (
              <ProgressCard status={status.data} />
            ) : (
              <p className="text-sm text-muted-foreground">Memuat rekor…</p>
            )}
          </Card>

          <Card className="space-y-3">
            <SectionTitle>Riwayat sesi</SectionTitle>
            {history.isPending ? (
              <p className="text-sm text-muted-foreground">Memuat riwayat…</p>
            ) : (history.data?.items.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">
                Belum ada sesi. Mulai dari template di atas, dua-tiga sesi seminggu cukup buat jaga
                otot.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {history.data!.items.map((item) => (
                  <li key={item.session.id} className="flex items-center gap-3 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{item.session.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {fmtDateIndo(item.session.date)}
                        {item.session.durationMin != null
                          ? ` · ${fmtInt(item.session.durationMin)} menit`
                          : ""}
                        {` · ${item.sets.length} set`}
                      </span>
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setDraft(draftFromSession(item))}
                    >
                      Edit
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}

function LatihanPage() {
  // The page leans on several queries; only catalog failures break the flow.
  const catalog = useQuery(orpc.workout.catalog.queryOptions());
  if (catalog.error) {
    return <ScreenError message={catalog.error.message} onRetry={() => catalog.refetch()} />;
  }
  return <LatihanScreen />;
}
