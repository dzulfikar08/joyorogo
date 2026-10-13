import { ExerciseDetail } from "@/components/workout/exercise-detail";
import { ScreenError } from "@/components/screen-state";
import { workoutApi, workoutQueryPrefix } from "@/lib/workout-contract";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/latihan/gerakan/$exerciseId")({
  component: GerakanPage,
});

/** Per-exercise history and records. */
function GerakanPage() {
  const { exerciseId } = Route.useParams();
  const catalog = useQuery({
    queryKey: [...workoutQueryPrefix, "catalog"],
    queryFn: () => workoutApi.catalog(),
  });

  const exercise = catalog.data?.exercises.find((item) => item.id === exerciseId);
  if (catalog.isPending) {
    return <p className="p-6 text-sm text-muted-foreground">Memuat…</p>;
  }
  if (!exercise) {
    return (
    <ScreenError
      message="Gerakan tidak ditemukan di katalog."
      onRetry={() => void catalog.refetch()}
    />
  );
  }
  return <ExerciseDetail exercise={exercise} />;
}
