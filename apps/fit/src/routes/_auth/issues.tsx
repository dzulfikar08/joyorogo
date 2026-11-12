import { Button } from "@joyorogo/ui/components/button";
import { createFileRoute } from "@tanstack/react-router";
import { Bug, Inbox, Lightbulb, PartyPopper } from "lucide-react";
import { Suspense, lazy, useState } from "react";
import { useTranslation } from "react-i18next";

import { PageHeader, Segmented } from "@/components/kit";
import { BlockSkeleton } from "@/components/states";
import type { ReportKind } from "@/lib/issues";
import { usePageTitle } from "@/lib/page-title";

const TABS = ["ide", "laporan", "selesai"] as const;
type Tab = (typeof TABS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The default tab (ideas) stays out of the URL; an open idea or ticket is in it, so it can be linked and survives a reload. */
type Search = {
  tab?: Exclude<Tab, "ide">;
  ide?: string;
  tiket?: number;
  proyek?: string;
};

export const Route = createFileRoute("/_auth/issues")({
  component: IssuesPage,
  validateSearch: (search: Record<string, unknown>): Search => {
    const tiket = Number(search.tiket);
    return {
      tab: search.tab === "laporan" || search.tab === "selesai" ? search.tab : undefined,
      ide: typeof search.ide === "string" && UUID.test(search.ide) ? search.ide : undefined,
      tiket: Number.isInteger(tiket) && tiket > 0 ? tiket : undefined,
      proyek:
        typeof search.proyek === "string" && UUID.test(search.proyek) ? search.proyek : undefined,
    };
  },
});

const PANELS = {
  ide: lazy(() => import("@/components/issues/tab-ideas")),
  laporan: lazy(() => import("@/components/issues/tab-reports")),
  selesai: lazy(() => import("@/components/issues/tab-changelog")),
} satisfies Record<Tab, unknown>;
const IdeaSheet = lazy(() =>
  import("@/components/issues/tab-ideas").then((m) => ({ default: m.IdeaSheet })),
);
const TicketSheet = lazy(() =>
  import("@/components/issues/tab-reports").then((m) => ({ default: m.TicketSheet })),
);
const ComposeSheet = lazy(() =>
  import("@/components/issues/compose-sheet").then((m) => ({ default: m.ComposeSheet })),
);

const TAB_ICON = { ide: Lightbulb, laporan: Inbox, selesai: PartyPopper } as const;

/**
 * Feedback, as the signed-in account (no Atur sign-in): ideas to vote on and discuss, the account's own reports with
 * the team's replies, and what shipped; new reports and ideas come from the page's own form (compose-sheet.tsx). Open to every
 * signed-in account, Pro or not (_auth/route.tsx lets this page past the wall).
 */
function IssuesPage() {
  const { t } = useTranslation("fitWebIssues");
  usePageTitle(t("title"));
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [composing, setComposing] = useState<ReportKind | undefined>();
  const tab: Tab = search.tab ?? "ide";

  const setSearch = (next: Partial<Search>) =>
    void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });
  const openIdea = (id: string) => setSearch({ ide: id, tiket: undefined, proyek: undefined });
  const openTicket = (seq: number, project: string) =>
    setSearch({ tiket: seq, proyek: project, ide: undefined });
  const compose = (kind: ReportKind) => setComposing(kind);
  // A problem or question is a ticket: show it in Laporanku with the thread open. An idea opens on the board.
  const sent = (result: { kind: ReportKind; id: string; sequence_id: number }) => {
    setComposing(undefined);
    if (result.kind === "idea")
      setSearch({ tab: undefined, ide: result.id, tiket: undefined, proyek: undefined });
    else
      setSearch({ tab: "laporan", tiket: result.sequence_id, proyek: undefined, ide: undefined });
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            <Button size="sm" onClick={() => compose("bug")}>
              <Bug aria-hidden />
              {t("actions.report")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => compose("idea")}>
              <Lightbulb aria-hidden />
              {t("actions.idea")}
            </Button>
          </>
        }
      />
      <Segmented<Tab>
        label={t("tabs.label")}
        value={tab}
        className="mb-4 self-start overflow-x-auto"
        onChange={(next) => setSearch({ tab: next === "ide" ? undefined : next })}
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
      <Suspense fallback={<BlockSkeleton className="h-64" />}>
        {tab === "ide" ? (
          <PANELS.ide openIdea={openIdea} onNewIdea={() => compose("idea")} />
        ) : tab === "laporan" ? (
          <PANELS.laporan
            openIdea={openIdea}
            openTicket={openTicket}
            onNewReport={() => compose("bug")}
          />
        ) : (
          <PANELS.selesai openIdea={openIdea} />
        )}
      </Suspense>
      <Suspense fallback={null}>
        {search.ide && <IdeaSheet id={search.ide} onClose={() => setSearch({ ide: undefined })} />}
        {search.tiket !== undefined && (
          <TicketSheet
            seq={search.tiket}
            project={search.proyek}
            onClose={() => setSearch({ tiket: undefined, proyek: undefined })}
          />
        )}
        <ComposeSheet kind={composing} onClose={() => setComposing(undefined)} onSent={sent} />
      </Suspense>
    </div>
  );
}
