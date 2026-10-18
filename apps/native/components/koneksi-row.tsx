import "@/unistyles";
import { useQuery } from "@tanstack/react-query";
import { router, type Href } from "expo-router";
import { useTranslation } from "react-i18next";

import { ListRow } from "@/components/ui";
import { fmtInt } from "@/utils/format";
import { orpc } from "@/utils/orpc";

/**
 * Row opening the Koneksi AI screen; the value shows how many apps are connected. Not a card of
 * its own: it sits in the Koneksi group of the Profil hub. Claude and ChatGPT are named in the
 * subtitle only, no logos (docs/brand-marks.md).
 */
export function KoneksiRow() {
  const { t } = useTranslation(["koneksi", "settings"]);
  const list = useQuery(orpc.mcpConnection.list.queryOptions());
  const count = list.data?.length ?? 0;
  return (
    <ListRow
      icon="sparkles"
      iconTint="tidur"
      title={t("koneksi:title")}
      subtitle={t("settings:hub.rows.ai.subtitle")}
      value={count > 0 ? fmtInt(count) : undefined}
      chevron
      onPress={() => router.push("/koneksi" as Href)}
    />
  );
}
