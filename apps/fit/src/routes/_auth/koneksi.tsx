import { createFileRoute } from "@tanstack/react-router";
import { Bot, Download, Plug } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ActivityCard } from "@/components/connect/activity-card";
import { AppsCard } from "@/components/connect/apps-card";
import { CoachAside, CoachChat } from "@/components/connect/coach-chat";
import { ConnectorCard } from "@/components/connect/connector-card";
import { ExportBulkCard, ExportFormatsCard } from "@/components/connect/export-bulk";
import { LimitsCard, ReadsCard } from "@/components/connect/mcp-info";
import { SectionBand } from "@/components/connect/shared";
import { PageHeader } from "@/components/kit";
import { useSession } from "@/lib/auth-client";
import { usePageTitle } from "@/lib/page-title";

export const Route = createFileRoute("/_auth/koneksi")({
  component: ConnectPage,
});

const SECTIONS = ["mcp", "coach", "export"] as const;

function ConnectPage() {
  const { t } = useTranslation("fitWebConnect");
  usePageTitle(t("title"));
  const session = useSession();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <nav aria-label={t("jump.label")} className="-mt-2 flex flex-wrap gap-2">
          {SECTIONS.map((id) => (
            <a
              key={id}
              href={`#${id}`}
              className="inline-flex h-10 items-center rounded-full bg-card px-4 text-[0.8125rem] font-semibold text-muted-foreground ring-1 ring-foreground/10 transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              {t(`jump.${id}`)}
            </a>
          ))}
        </nav>
      </div>

      <SectionBand id="mcp" Icon={Plug} title={t("mcp.title")} subtitle={t("mcp.subtitle")}>
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            <ConnectorCard />
            <ReadsCard />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <AppsCard />
            <LimitsCard />
          </div>
          <div className="min-w-0 xl:col-span-2">
            <ActivityCard />
          </div>
        </div>
      </SectionBand>

      <SectionBand id="coach" Icon={Bot} title={t("coach.title")} subtitle={t("coach.subtitle")}>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          {session.data ? <CoachChat userId={session.data.user.id} /> : null}
          <CoachAside />
        </div>
      </SectionBand>

      <SectionBand
        id="export"
        Icon={Download}
        title={t("export.title")}
        subtitle={t("export.subtitle")}
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <ExportBulkCard />
          <ExportFormatsCard />
        </div>
      </SectionBand>
    </div>
  );
}
