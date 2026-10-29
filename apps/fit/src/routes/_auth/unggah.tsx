import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";

import { PageHeader, Segmented } from "@/components/kit";
import { BlockSkeleton } from "@/components/states";
import { WatchfaceLibrary } from "@/components/upload/watchface-library";
import { WorkoutUpload } from "@/components/upload/workout-upload";
import { usePageTitle } from "@/lib/page-title";

type Tab = "workouts" | "watchfaces" | "huawei";

/** The default tab (workouts) stays out of the URL. */
type Search = { tab?: Exclude<Tab, "workouts"> };

export const Route = createFileRoute("/_auth/unggah")({
  component: UploadPage,
  validateSearch: (search: Record<string, unknown>): Search => ({
    tab: search.tab === "watchfaces" || search.tab === "huawei" ? search.tab : undefined,
  }),
});

// The Huawei converter (its worker and ZIP reader) is its own chunk, fetched only when the tab is opened.
const HuaweiImport = lazy(() => import("@/components/upload/huawei-import"));

function UploadPage() {
  const { t } = useTranslation("fitWebUpload");
  usePageTitle(t("title"));
  const tab: Tab = Route.useSearch().tab ?? "workouts";
  const navigate = Route.useNavigate();
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Segmented<Tab>
            label={t("tabs.label")}
            value={tab}
            className="overflow-x-auto"
            onChange={(next) =>
              void navigate({
                search: { tab: next === "workouts" ? undefined : next },
                replace: true,
              })
            }
            options={[
              { value: "workouts", label: t("tabs.workouts") },
              { value: "watchfaces", label: t("tabs.watchfaces") },
              { value: "huawei", label: t("tabs.huawei") },
            ]}
          />
        }
      />
      {tab === "watchfaces" ? (
        <WatchfaceLibrary />
      ) : tab === "huawei" ? (
        <Suspense fallback={<BlockSkeleton className="h-64" />}>
          <HuaweiImport />
        </Suspense>
      ) : (
        <WorkoutUpload />
      )}
    </div>
  );
}
