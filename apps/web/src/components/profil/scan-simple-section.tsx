import { Mic } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { IconChip, ListGroup, ListRow } from "@/components/kit/surface";
import { Switch } from "@/components/kit/switch";
import { saveScanSimple, storedScanSimple } from "@/lib/scan-simple";

/** "Mode simpel setelah scan" (scan.simple, synced): Profil > Makan & puasa, the same place as in the app. */
export function ScanSimpleSection() {
  const { t } = useTranslation("settings");
  const [on, setOn] = useState(storedScanSimple);
  return (
    <ListGroup className="mt-3">
      <ListRow
        icon={
          <IconChip tone="makan">
            <Mic />
          </IconChip>
        }
        title={t("scanSimple.title")}
        subtitle={on ? t("scanSimple.on") : t("scanSimple.off")}
        trailing={
          <Switch
            label={t("scanSimple.label")}
            checked={on}
            onCheckedChange={(next) => {
              setOn(next);
              saveScanSimple(next);
            }}
          />
        }
      />
    </ListGroup>
  );
}
