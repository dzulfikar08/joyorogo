import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ExportBulkCard, ExportFormatsCard } from "./export-bulk";
import { SectionBand } from "./shared";

/** Tab "Ekspor": bulk download of workouts. */
export default function ExportTab() {
  const { t } = useTranslation("fitWebConnect");
  return (
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
  );
}
