import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { PressableScale } from "@/components/motion";
import { Text } from "@/components/ui";
import { useNoticeExpanded } from "@/src/lib/notice-store";

/**
 * An explanatory (not an error) notice that costs one row until opened. The open/closed choice is kept per `id` on this
 * phone, so what the person opened stays open and what they never needed stays a line. `id` is stored: never rename it once
 * released. Errors and anything that blocks a task keep their own full-size card.
 */
export function CollapsibleNotice({
  id,
  title,
  icon = "information-circle-outline",
  tone = "muted",
  children,
}: {
  id: string;
  /** The one line shown while collapsed; says what the notice is about, so it is worth opening. */
  title: string;
  icon?: ComponentProps<typeof Ionicons>["name"];
  tone?: "muted" | "warn";
  children: ReactNode;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation("home");
  const [open, setOpen] = useNoticeExpanded(id);
  const fg = tone === "warn" ? theme.colors.bakarText : theme.colors.mutedForeground;
  return (
    <View style={[styles.box, tone === "warn" && styles.warn]}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={open ? t("notice.collapse") : t("notice.expand")}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        scaleTo={0.99}
        style={styles.header}
      >
        <Ionicons name={icon} size={18} color={fg} />
        <Text style={[styles.title, tone === "warn" && { color: theme.colors.bakarText }]} numberOfLines={open ? undefined : 1}>
          {title}
        </Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={fg} />
      </PressableScale>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: {
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.tile,
    overflow: "hidden",
  },
  warn: {
    backgroundColor: theme.colors.bakarSoft,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    minHeight: 44,
    paddingHorizontal: theme.spacing.md,
  },
  title: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  body: {
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.md,
  },
}));
