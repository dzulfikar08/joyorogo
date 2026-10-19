import { Plug } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ActivityCard } from "./activity-card";
import { AppsCard } from "./apps-card";
import { ConnectorCard } from "./connector-card";
import { LimitsCard, ReadsCard } from "./mcp-info";
import { SectionBand } from "./shared";

/** Tab "Aplikasi AI": the connector, what it reads, the connected apps and the call log. */
export default function McpTab() {
  const { t } = useTranslation("fitWebConnect");
  return (
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
  );
}
