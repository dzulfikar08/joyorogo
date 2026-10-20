import type { AppRouterClient } from "@joyorogo/api/routers/index";
import { useTranslation } from "react-i18next";

export type PlateNoteData = Awaited<ReturnType<AppRouterClient["ai"]["analyzeFood"]>>["plate"];

/** One muted line under the scan total: which registered plate the model saw. Nothing when `plate` is absent. */
export function PlateNote({ plate }: { plate: PlateNoteData | null | undefined }) {
  const { t } = useTranslation("scan");
  if (!plate) return null;
  return (
    <p className="mt-2 px-1 text-center text-xs text-muted-foreground">
      {plate.status === "matched"
        ? t("dishware.matched", {
            name: plate.name,
            cm:
              plate.kind === "lunchbox" && plate.widthCm != null
                ? `${plate.diameterCm} x ${plate.widthCm}`
                : plate.diameterCm,
          })
        : t("dishware.none")}
    </p>
  );
}
