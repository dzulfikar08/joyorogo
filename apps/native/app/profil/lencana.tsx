import "@/unistyles";
import { Redirect } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import { BadgeDetailSheet } from "@/components/badges/badge-detail-sheet";
import { BadgeShelf } from "@/components/badges/badge-shelf";
import { Leaderboard } from "@/components/badges/leaderboard";
import { useBadges } from "@/components/badges/use-badges";
import { ProfilPage } from "@/components/profil/page";
import { ErrorState, SectionTitle, Skeleton, Text } from "@/components/ui";
import type { BadgeLike } from "@/src/lib/badges";
import { errorMessage } from "@/utils/format";

/** Lencana: every badge (locked ones greyed), the detail sheet, and the global weekly board. */
export default function Lencana() {
  const { t } = useTranslation("badges");
  return (
    <ProfilPage title={t("board.badgesTitle")}>
      <ShelfContent />
    </ProfilPage>
  );
}

function ShelfContent() {
  const { t } = useTranslation("badges");
  const query = useBadges();
  const [open, setOpen] = useState<BadgeLike | null>(null);

  if (query.isPending) return <Skeleton width="100%" height={320} radius={24} />;
  if (query.isError) return <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />;
  if (!query.data.enabled) return <Redirect href="/" />;

  const badges = query.data.badges;
  const earned = badges.filter((b) => b.tier > 0).length;
  return (
    <>
      <Text style={styles.count}>{t("shelf.count", { earned, total: badges.length })}</Text>
      <BadgeShelf badges={badges} onOpen={setOpen} />
      <SectionTitle title={t("board.title")} />
      <Text style={styles.subtitle}>{t("board.subtitle")}</Text>
      <Leaderboard scope="global" />
      <BadgeDetailSheet badge={open} onClose={() => setOpen(null)} />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  count: { fontSize: theme.fontSize.sm, fontWeight: "700", color: theme.colors.mutedForeground },
  subtitle: { fontSize: theme.fontSize.sm, lineHeight: 20, color: theme.colors.mutedForeground },
}));
