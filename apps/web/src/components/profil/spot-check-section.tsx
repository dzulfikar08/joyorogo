import { ScanSearch } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { IconChip, ListGroup, ListRow } from "@/components/kit/surface";
import { Switch } from "@/components/kit/switch";
import { saveSpotCheck, storedSpotCheck } from "@/lib/spot-check";

/** "Cek sesekali" (logging.spotCheck, synced): Profil > Makan & puasa, the same place as in the app. */
export function SpotCheckSection() {
  const { t } = useTranslation("settings");
  const [on, setOn] = useState(storedSpotCheck);
  return (
    <ListGroup className="mt-3">
      <ListRow
        icon={
          <IconChip tone="makan">
            <ScanSearch />
          </IconChip>
        }
        title={t("spotCheck.title")}
        subtitle={on ? t("spotCheck.on") : t("spotCheck.off")}
        trailing={
          <Switch
            label={t("spotCheck.title")}
            checked={on}
            onCheckedChange={(next) => {
              setOn(next);
              saveSpotCheck(next);
            }}
          />
        }
      />
    </ListGroup>
  );
}
