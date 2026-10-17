import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { MAKAN_VIEWS } from "@joyorogo/api/lib/diary-view";
import type { MakanView } from "@joyorogo/api/lib/diary-view";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { EASE_OUT, PressableScale } from "@/components/motion";
import { Text } from "@/components/ui";

function ViewIcon({ view, color }: { view: MakanView; color: string }) {
  if (view === "daftar") return <Ionicons name="list" size={20} color={color} />;
  if (view === "kalender") return <Ionicons name="calendar-outline" size={20} color={color} />;
  if (view === "stiker")
    return <MaterialCommunityIcons name="sticker-outline" size={20} color={color} />;
  return <Ionicons name="location-outline" size={20} color={color} />;
}

/**
 * Segmented view switcher for Makan. Every segment shows its icon; the chosen
 * one grows to show its label as well, so four views fit a 360px phone.
 */
export function MakanViewSwitcher({
  value,
  onChange,
}: {
  value: MakanView;
  onChange: (view: MakanView) => void;
}) {
  const { t } = useTranslation("makan");
  const { theme } = useUnistyles();
  return (
    <View style={styles.rail} accessibilityRole="tablist" accessibilityLabel={t("viewSwitcher.label")}>
      {MAKAN_VIEWS.map((view) => {
        const active = view.value === value;
        return (
          <PressableScale
            key={view.value}
            accessibilityRole="tab"
            accessibilityLabel={t(`viewSwitcher.view.${view.value}`)}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(view.value)}
            scaleTo={0.94}
            style={[styles.segment, active ? styles.segmentActive : styles.segmentIdle]}
          >
            <ViewIcon
              view={view.value}
              color={active ? theme.colors.foreground : theme.colors.mutedForeground}
            />
            {active ? (
              <Animated.View entering={FadeIn.duration(180).easing(EASE_OUT)}>
                <Text style={styles.label} numberOfLines={1}>
                  {t(`viewSwitcher.view.${view.value}`)}
                </Text>
              </Animated.View>
            ) : null}
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  rail: {
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.muted,
  },
  segment: {
    minHeight: 44,
    borderRadius: theme.radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  segmentActive: {
    flex: 2.4,
    backgroundColor: theme.colors.card,
    paddingHorizontal: theme.spacing.md,
  },
  segmentIdle: {
    flex: 1,
  },
  label: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
}));
