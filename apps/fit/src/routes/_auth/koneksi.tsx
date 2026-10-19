import { createFileRoute } from "@tanstack/react-router";
import { Bot, Download, Plug } from "lucide-react";
import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";

import { PageHeader, Segmented } from "@/components/kit";
import { BlockSkeleton } from "@/components/states";
import { usePageTitle } from "@/lib/page-title";

const TABS = ["mcp", "coach", "export"] as const;
type Tab = (typeof TABS)[number];

/** The default tab (AI apps) stays out of the URL. */
type Search = { tab?: Exclude<Tab, "mcp"> };

export const Route = createFileRoute("/_auth/koneksi")({
  component: ConnectPage,
  validateSearch: (search: Record<string, unknown>): Search => ({
    tab: search.tab === "coach" || search.tab === "export" ? search.tab : undefined,
  }),
});

// One chunk and one set of queries per tab: a tab fetches nothing until it is opened.
const PANELS = {
  mcp: lazy(() => import("@/components/connect/tab-mcp")),
  coach: lazy(() => import("@/components/connect/tab-coach")),
  export: lazy(() => import("@/components/connect/tab-export")),
} satisfies Record<Tab, unknown>;

const TAB_ICON = { mcp: Plug, coach: Bot, export: Download } as const;

function ConnectPage() {
  const { t } = useTranslation("fitWebConnect");
  usePageTitle(t("title"));
  const tab: Tab = Route.useSearch().tab ?? "mcp";
  const navigate = Route.useNavigate();
  const Panel = PANELS[tab];

  return (
    <div className="flex flex-col">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Segmented<Tab>
            label={t("tabs.label")}
            value={tab}
            className="overflow-x-auto"
            onChange={(next) =>
              void navigate({ search: { tab: next === "mcp" ? undefined : next }, replace: true })
            }
            options={TABS.map((id) => {
              const Icon = TAB_ICON[id];
              return {
                value: id,
                label: (
                  <>
                    <Icon className="size-4" aria-hidden />
                    {t(`tabs.${id}`)}
                  </>
                ),
              };
            })}
          />
        }
      />
      <Suspense fallback={<BlockSkeleton className="h-64" />}>
        <Panel />
      </Suspense>
    </div>
  );
}
