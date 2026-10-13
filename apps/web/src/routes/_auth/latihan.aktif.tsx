import { ActiveWorkoutScreen } from "@/components/workout/active-workout";
import { loadActive } from "@/components/workout/active-store";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/latihan/aktif")({
  component: AktifPage,
});

/** The live workout. Resumes a locally persisted draft when there is one. */
function AktifPage() {
  const resume = loadActive();
  return <ActiveWorkoutScreen resume={resume} />;
}
