import "@/unistyles";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { BadgeMedal } from "@/components/badges/badge-medal";
import { BadgeShareSheet } from "@/components/story/badge-share-sheet";
import { Button, Sheet, Text } from "@/components/ui";
import { badgeKey, nextThreshold, ruleCount, wibDate, type BadgeLike } from "@/src/lib/badges";
import { fmtDateMedium } from "@/utils/format";

/** Name, rule, earned date, tier, next-level threshold and a share button (earned badges only). */
export function BadgeDetailSheet({ badge, onClose }: { badge: BadgeLike | null; onClose: () => void }) {
  const { t } = useTranslation("badges");
  const [sharing, setSharing] = useState(false);
  const earned = badge !== null && badge.tier > 0;
  const next = badge ? nextThreshold(badge) : null;
  return (
    <>
      <Sheet
        visible={badge !== null && !sharing}
        onClose={onClose}
        title={badge ? t(badgeKey(badge.id, "name")) : ""}
        footer={earned ? <Button label={t("share.cta")} icon="share-social" onPress={() => setSharing(true)} /> : undefined}
      >
        {badge ? (
          <View style={styles.body}>
            <BadgeMedal badge={badge} size={132} />
            <Text style={styles.label}>{t("detail.ruleLabel")}</Text>
            <Text style={styles.rule}>{t(badgeKey(badge.id, "desc"), { n: ruleCount(badge) })}</Text>
            {earned ? (
              <>
                {badge.tiers.length > 1 ? <Text style={styles.meta}>{t("board.tier", { n: badge.tier })}</Text> : null}
                {badge.awardedAt !== null ? (
                  <Text style={styles.meta}>{t("detail.earned", { date: fmtDateMedium(wibDate(badge.awardedAt)) })}</Text>
                ) : null}
                {next !== null ? <Text style={styles.meta}>{t("detail.next", { n: next })}</Text> : null}
              </>
            ) : (
              <Text style={styles.meta}>{t("board.locked")}</Text>
            )}
          </View>
        ) : null}
      </Sheet>
      <BadgeShareSheet
        badge={badge}
        visible={sharing}
        onClose={() => {
          setSharing(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { alignItems: "center", gap: theme.spacing.sm, paddingBottom: theme.spacing.md },
  label: { marginTop: theme.spacing.sm, fontSize: theme.fontSize.xs, fontWeight: "700", color: theme.colors.mutedForeground },
  rule: { fontSize: theme.fontSize.base, lineHeight: 22, color: theme.colors.foreground, textAlign: "center" },
  meta: { fontSize: theme.fontSize.sm, fontWeight: "600", color: theme.colors.mutedForeground, textAlign: "center" },
}));
