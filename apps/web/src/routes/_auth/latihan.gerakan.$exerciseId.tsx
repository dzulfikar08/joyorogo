import { Page } from "@/components/kit/surface";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { ExerciseDetail } from "@/components/workout/exercise-detail";
import { ScreenError } from "@/components/screen-state";
import { workoutApi, workoutQueryPrefix } from "@/lib/workout-contract";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_auth/latihan/gerakan/$exerciseId")({
  component: GerakanPage,
});

/** Per-exercise history and records. */
function GerakanPage() {
  const { t } = useTranslation(["olahraga", "common"]);
  const { exerciseId } = Route.useParams();
  const catalog = useQuery({
    queryKey: [...workoutQueryPrefix, "catalog"],
    queryFn: () => workoutApi.catalog(),
  });

  const exercise = catalog.data?.exercises.find((item) => item.id === exerciseId);
  if (catalog.isPending) {
    return (
      <Page className="max-w-xl" aria-busy="true" aria-label={t("common:state.loading")}>
        <Skeleton className="h-9 w-56 rounded-full" />
        <Skeleton className="mt-4 h-44 rounded-3xl" />
        <Skeleton className="mt-3 h-64 rounded-3xl" />
      </Page>
    );
  }
  if (!exercise) {
    return (
      <ScreenError
        message={t("latihan.detail.notFound")}
        onRetry={() => void catalog.refetch()}
      />
    );
  }
  return <ExerciseDetail exercise={exercise} />;
}
