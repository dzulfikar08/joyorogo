import "@/unistyles";
import { useQuery } from "@tanstack/react-query";
import { router, type Href } from "expo-router";
import { useTranslation } from "react-i18next";

import { ListGroup, ListRow } from "@/components/ui";
import { fmtInt } from "@/utils/format";
import { orpc } from "@/utils/orpc";

/** Settings row opening the Koneksi AI screen; the value shows how many apps are connected. */
export function KoneksiRow() {
  const { t } = useTranslation("koneksi");
  const list = useQuery(orpc.mcpConnection.list.queryOptions());
  const count = list.data?.length ?? 0;
  return (
    <ListGroup>
      <ListRow
        icon="sparkles"
        iconTint="tidur"
        title={t("title")}
        subtitle={t("list.title")}
        value={count > 0 ? fmtInt(count) : undefined}
        chevron
        onPress={() => router.push("/koneksi" as Href)}
      />
    </ListGroup>
  );
}
