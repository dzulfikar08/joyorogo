import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { Text } from "@/components/ui";
import type { AppRouterClient } from "@joyorogo/api/routers/index";
import type { InferClientOutputs } from "@orpc/client";

/** Plate verdict carried by a scan result (`ai.analyzeFood` and retry). */
export type ScanPlate = InferClientOutputs<AppRouterClient>["ai"]["analyzeFood"]["plate"];

/** One muted line under the scan result: which registered plate the model saw. Nothing when `plate` is absent. */
export function PlateNote({ plate }: { plate: ScanPlate | null | undefined }) {
  const { t } = useTranslation("scan");
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
