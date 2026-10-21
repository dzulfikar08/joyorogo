import { Ionicons } from "@expo/vector-icons";
import { MAKAN_VIEWS } from "@joyorogo/api/lib/diary-view";
import type { MakanView } from "@joyorogo/api/lib/diary-view";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { EASE_OUT, PressableScale } from "@/components/motion";
import { Text } from "@/components/ui";

type IconName = React.ComponentProps<typeof Ionicons>["name"];
type TabOption<T extends string> = {
  value: T;
  label: string;
  icon: IconName;
};

/**
 * Icon-first segmented tabs. Every segment shows its icon; the chosen one
 * grows to show its label as well, so four views fit a 360px phone. Shared by
 * Makan and Feed.
 */
export function IconTabs<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<TabOption<T>>;
  /** Accessible tablist name. */
  label: string;
}) {
  const { theme } = useUnistyles();
  return (
    <View style={styles.rail} accessibilityRole="tablist" accessibilityLabel={label}>
      {options.map((option) => {
        const active = option.value === value;
        const color = active ? theme.colors.foreground : theme.colors.mutedForeground;
        return (
          <PressableScale
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            scaleTo={0.94}
            style={[styles.segment, active ? styles.segmentActive : styles.segmentIdle]}
          >
            <Ionicons name={option.icon} size={20} color={color} />
            {active ? (
              <Animated.View entering={FadeIn.duration(180).easing(EASE_OUT)}>
                <Text style={styles.label} numberOfLines={1}>
                  {option.label}
                </Text>
              </Animated.View>
            ) : null}
          </PressableScale>
        );
      })}
    </View>
  );
}

const MAKAN_ICONS: Record<MakanView, IconName> = {
  daftar: "list",
  kalender: "calendar-outline",
  stiker: "camera-outline",
  tempat: "location-outline",
};

export function MakanViewSwitcher({
  value,
  onChange,
}: {
  value: MakanView;
  onChange: (view: MakanView) => void;
}) {
  const { t } = useTranslation("makan");
  return (
    <IconTabs
      value={value}
      onChange={onChange}
      label={t("viewSwitcher.label")}
      options={MAKAN_VIEWS.map((view) => ({
        value: view.value,
        label: t(`viewSwitcher.view.${view.value}`),
        icon: MAKAN_ICONS[view.value],
      }))}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  rail: {
    flex: 1,
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
