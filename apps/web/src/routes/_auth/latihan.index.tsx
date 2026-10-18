import { Card, Page, PageHeader, SectionTitle } from "@/components/kit/surface";
import { ScreenError } from "@/components/screen-state";
import { ShareStoryButton } from "@/components/story/share-story-button";
import { MuscleMap } from "@/components/workout/muscle-map";
import { ProgressCard } from "@/components/workout/progress-card";
import { JoyoFitCard } from "@/components/workout/joyofit-card";
import { workoutApi, workoutQueryPrefix } from "@/lib/workout-contract";
import { fmtDateMedium, fmtInt } from "@/lib/format";
import { orpc } from "@/utils/orpc";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { History } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const DRAFT_KEY = "jrg-active-workout";

export const Route = createFileRoute("/_auth/latihan/")({
  component: LatihanPage,
});

/** Read-only archive of old strength logs; training itself lives in JoyoFit. */
function LatihanScreen() {
  const { t } = useTranslation(["olahraga", "common"]);
  const catalog = useQuery({
    queryKey: [...workoutQueryPrefix, "catalog"],
    queryFn: () => workoutApi.catalog(),
  });
  const history = useQuery(orpc.workout.listSessions.queryOptions({ input: { limit: 20 } }));
  const status = useQuery(orpc.workout.status.queryOptions({ input: {} }));

  // A draft from the removed logger: tell the user once, then drop it.
  const [draftNotice, setDraftNotice] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(DRAFT_KEY) !== null) {
        localStorage.removeItem(DRAFT_KEY);
        setDraftNotice(true);
      }
    } catch {
      // storage unavailable: nothing to migrate
    }
  }, []);

  const catalogById = new Map((catalog.data?.exercises ?? []).map((exercise) => [exercise.id, exercise]));
  const nameOf = (exerciseId: string) => catalogById.get(exerciseId)?.name ?? exerciseId;

  return (
    <Page className="max-w-xl lg:max-w-3xl">
      <PageHeader title={t("latihan.title")} />

      {draftNotice && (
        <p role="status" className="mb-3 rounded-2xl bg-muted px-4 py-3 text-sm">
          {t("moved.draftNotice")}
        </p>
      )}

      <div className="mb-3 space-y-3 lg:mb-5">
        <JoyoFitCard />
        <p className="px-1 text-xs text-muted-foreground">{t("moved.archive")}</p>
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-2 lg:gap-5">
        <div className="min-w-0 space-y-3 lg:space-y-5">
          <Card className="space-y-3">
            <SectionTitle>{t("latihan.list.history.title")}</SectionTitle>
            {history.isPending ? (
              <p className="text-sm text-muted-foreground">{t("common:state.loading")}</p>
            ) : (history.data?.items.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">
                <span className="block font-semibold text-foreground">
                  {t("latihan.list.history.emptyTitle")}
                </span>
                {t("latihan.list.history.emptyHint")}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {history.data!.items.map((item) => (
                  <li key={item.session.id} className="py-3">
                    <div className="flex items-center gap-2">
                      <History className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">{item.session.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {[
                            fmtDateMedium(item.session.date),
                            item.session.durationMin != null
                              ? t("latihan.count.minutes", { count: item.session.durationMin })
                              : null,
                            t("latihan.count.sets", { count: item.sets.length }),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <ShareStoryButton
                        label=""
                        aria-label={t("latihan.list.history.shareStory", { name: item.session.name })}
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground"
                        story={{
                          kind: "workout",
                          name: item.session.name,
                          durationMin: item.session.durationMin,
                          volumeKg: item.sets.reduce(
                            (sum, set) =>
                              set.setType === "warmup" || set.weightKg == null || set.reps == null
                                ? sum
                                : sum + set.weightKg * set.reps,
                            0,
                          ),
                          setsDone: item.sets.filter((set) => set.setType !== "warmup").length,
                        }}
                      />
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {[...new Set(item.sets.map((set) => set.exerciseId))].map((exerciseId) => (
                        <Link
                          key={exerciseId}
                          to="/latihan/gerakan/$exerciseId"
                          params={{ exerciseId }}
                          className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-border focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                        >
                          {nameOf(exerciseId)}
                        </Link>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-3 lg:space-y-5">
          <Card className="space-y-3">
            <SectionTitle>{t("latihan.map.title")}</SectionTitle>
            {status.isPending ? (
              <p className="text-sm text-muted-foreground">{t("latihan.map.loading")}</p>
            ) : status.error ? (
              <p className="text-sm text-destructive">{status.error.message}</p>
            ) : (
              <MuscleMap status={status.data} />
            )}
          </Card>

          <Card className="space-y-3">
            <SectionTitle>{t("latihan.progress.title")}</SectionTitle>
            {status.data ? (
              <ProgressCard status={status.data} />
            ) : (
              <p className="text-sm text-muted-foreground">{t("common:state.loading")}</p>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}

function LatihanPage() {
  const catalog = useQuery({
    queryKey: [...workoutQueryPrefix, "catalog"],
    queryFn: () => workoutApi.catalog(),
  });
  if (catalog.error) {
    return <ScreenError message={catalog.error.message} onRetry={() => catalog.refetch()} />;
  }
  return <LatihanScreen />;
}
