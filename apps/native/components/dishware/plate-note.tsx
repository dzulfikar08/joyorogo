import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { Text } from "@/components/ui";
import type { AppRouterClient } from "@joyorogo/api/routers/index";
import type { InferClientOutputs } from "@orpc/client";

type ScanResult = InferClientOutputs<AppRouterClient>["ai"]["analyzeFood"];

/** What a scan result (`ai.analyzeFood` and retry) says about its size references: the card and the registered plate. */
export type ScanReferences = Pick<ScanResult, "plate" | "card">;

/**
 * One muted line under the scan result. A card the model was sure of is the reference ("Kartu terdeteksi");
 * without one, the registered plate it saw or "Piring tidak dikenali". Nothing when neither was asked.
 */
export function PlateNote({ note }: { note: ScanReferences | null | undefined }) {
  const { t } = useTranslation("scan");
  if (!note) return null;
  const { plate, card } = note;
  if (card) return <Text style={styles.note}>{t("dishware.card")}</Text>;
  if (!plate) return null;
  if (plate.status === "none") {
    return <Text style={styles.note}>{t("dishware.none")}</Text>;
  }
  const cm = plate.widthCm ? `${plate.diameterCm}×${plate.widthCm}` : String(plate.diameterCm);
  return <Text style={styles.note}>{t("dishware.matched", { name: plate.name, cm })}</Text>;
}

const styles = StyleSheet.create((theme) => ({
  note: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
}));
