import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { PageHeader, Segmented } from "@/components/kit";
import { WatchfaceLibrary } from "@/components/upload/watchface-library";
import { WorkoutUpload } from "@/components/upload/workout-upload";
import { usePageTitle } from "@/lib/page-title";

/** The default tab (workouts) stays out of the URL. */
type Search = { tab?: "watchfaces" };

export const Route = createFileRoute("/_auth/unggah")({
  component: UploadPage,
  validateSearch: (search: Record<string, unknown>): Search => ({
    tab: search.tab === "watchfaces" ? "watchfaces" : undefined,
  }),
});

function UploadPage() {
  const { t } = useTranslation("fitWebUpload");
  usePageTitle(t("title"));
  const tab = Route.useSearch().tab ?? "workouts";
  const navigate = Route.useNavigate();
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Segmented<"workouts" | "watchfaces">
            label={t("tabs.label")}
            value={tab}
            onChange={(next) =>
              void navigate({
                search: { tab: next === "watchfaces" ? "watchfaces" : undefined },
                replace: true,
              })
            }
            options={[
              { value: "workouts", label: t("tabs.workouts") },
              { value: "watchfaces", label: t("tabs.watchfaces") },
            ]}
          />
        }
      />
      {tab === "watchfaces" ? <WatchfaceLibrary /> : <WorkoutUpload />}
    </div>
  );
}
