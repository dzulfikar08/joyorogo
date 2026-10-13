import { RoutineEditor } from "@/components/workout/routine-editor";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/latihan/rutinitas/$id")({
  component: RutinitasPage,
});

/** Routine editor; id "baru" creates a new routine. */
function RutinitasPage() {
  const { id } = Route.useParams();
  return <RoutineEditor routineId={id} />;
}
