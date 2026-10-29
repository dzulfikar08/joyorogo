import type { AppRouterClient } from "@joyorogo/api/routers/index";
import { useTranslation } from "react-i18next";

type ScanResult = Awaited<ReturnType<AppRouterClient["ai"]["analyzeFood"]>>;

/** What a scan result says about its size references: the card beside the food and the registered plate. */
export type PlateNoteData = Pick<ScanResult, "plate" | "card">;

/**
 * One muted line under the scan total. A plate the card in the photo measured says its size ("Piring ±24 cm, diukur dari
 * kartu"); otherwise a card the model was sure of is "seen, a size hint only" (nothing turns it into grams); without
 * one, the registered plate it saw or "Piring tidak dikenali". Nothing when none of it was asked.
 */
export function PlateNote({ note }: { note: PlateNoteData | null | undefined }) {
  const { t } = useTranslation("scan");
  if (!note) return null;
  const { plate, card } = note;
  if (!card && !plate) return null;
  return (
    <p className="mt-2 px-1 text-center text-xs text-muted-foreground">
      {plate?.status === "matched" && plate.source === "card"
        ? t("dishware.measured", { cm: plate.diameterCm })
        : card
          ? t("dishware.card")
          : plate?.status === "matched"
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
