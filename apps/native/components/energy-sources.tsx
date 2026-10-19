import { Ionicons } from "@expo/vector-icons";
import { Linking, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { ENERGY_SOURCES } from "@joyorogo/api/lib/energy-sources";

import { PressableScale } from "@/components/motion";
import { SITE_ORIGIN } from "@/src/lib/share-links";
import { Card, Text } from "@/components/ui";

/**
 * "Sumber": every reference behind the energy model, what it is used for, and a link to open it. `plain` drops the
 * Card wrapper for use inside a sheet.
 */
export function EnergySources({ plain = false }: { plain?: boolean }) {
  const { t } = useTranslation("energy");
  const { theme } = useUnistyles();
  const Wrap = plain ? View : Card;
  return (
    <Wrap>
      <Text style={styles.title}>{t("sources.title")}</Text>
      <Text style={styles.intro}>{t("sources.intro")}</Text>
      <View style={styles.list}>
        {ENERGY_SOURCES.map((source) => (
          <View key={source.id} style={styles.item}>
            <Text style={styles.ref}>{t(`sources.items.${source.id}.ref`)}</Text>
            <Text style={styles.use}>{t(`sources.items.${source.id}.use`)}</Text>
            <PressableScale
              accessibilityRole="link"
              accessibilityLabel={`${t("sources.open")}: ${t(`sources.items.${source.id}.ref`)}`}
              onPress={() => void Linking.openURL(source.url)}
              hitSlop={8}
              scaleTo={1}
              dimTo={0.7}
              style={styles.link}
            >
              <Text style={styles.linkLabel}>{t("sources.open")}</Text>
              <Ionicons name="open-outline" size={14} color={theme.colors.makanText} />
            </PressableScale>
          </View>
        ))}
      </View>
      <PressableScale
        accessibilityRole="link"
        onPress={() => void Linking.openURL(`${SITE_ORIGIN}/panduan/kalori`)}
        hitSlop={8}
        scaleTo={1}
        dimTo={0.7}
        style={[styles.link, styles.readMore]}
      >
        <Text style={styles.linkLabel}>{t("readMore")}</Text>
        <Ionicons name="open-outline" size={14} color={theme.colors.makanText} />
      </PressableScale>
    </Wrap>
  );
}

const styles = StyleSheet.create((theme) => ({
  title: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  intro: {
    marginTop: theme.spacing.xs,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
  },
  list: { marginTop: theme.spacing.md, gap: theme.spacing.md },
  item: {
    gap: theme.spacing.xs,
    padding: theme.spacing.md,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.muted,
  },
  ref: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  use: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
  },
  link: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
    minHeight: 36,
  },
  readMore: { marginTop: theme.spacing.md },
  linkLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.makanText,
  },
}));
