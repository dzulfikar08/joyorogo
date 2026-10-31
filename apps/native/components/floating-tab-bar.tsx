import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { CommonActions } from "expo-router/react-navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Keyboard, Platform, Text, View, useWindowDimensions } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { EASE_OUT, PressableScale } from "@/components/motion";
import {
  CAMERA_OUTER,
  CAMERA_RAISE,
  CAMERA_RING,
  CAMERA_SLOT,
  TAB_BAR_BORDER,
  TAB_BAR_MARGIN_X,
  TAB_BAR_PADDING,
  TAB_ICON_SIZE,
  TAB_ITEM_PADDING,
  TAB_LABEL_LINE,
  TAB_LABEL_SIZE,
  tabBarBottomOffset,
  tabBarPillHeight,
  tabItemHeight,
} from "@/src/lib/tab-bar-metrics";

/** Route that is the centre camera button instead of a tab; its screen only forwards to the scan modal. */
const CAMERA_ROUTE = "kamera";
const INDICATOR_MS = 140;
/** Widest the pill gets: on a foldable or tablet it stays a centred bar instead of stretching edge to edge. */
const TAB_BAR_MAX_WIDTH = 480;

/** True while the Android keyboard is up. The window resizes with it, so a visible bar would ride above the keyboard; iOS keeps it. */
function useAndroidKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const show = Keyboard.addListener("keyboardDidShow", () => setOpen(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return open;
}

function TabItem({
  focused,
  height,
  label,
  badge,
  onPress,
  onLongPress,
  testID,
  children,
}: {
  focused: boolean;
  height: number;
  label: string;
  badge: BadgeValue;
  onPress: () => void;
  onLongPress: () => void;
  testID?: string;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    progress.value = reduceMotion
      ? focused
        ? 1
        : 0
      : withTiming(focused ? 1 : 0, { duration: INDICATOR_MS, easing: EASE_OUT });
  }, [focused, progress, reduceMotion]);
  const indicator = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.92 + progress.value * 0.08 }],
  }));

  return (
    <PressableScale
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      scaleTo={0.94}
      style={[styles.item, { height }]}
    >
      <Animated.View pointerEvents="none" style={[styles.indicator, indicator]} />
      <View style={styles.iconBox}>
        {children}
        {badge !== undefined ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{typeof badge === "number" && badge > 9 ? "9+" : badge}</Text>
          </View>
        ) : null}
      </View>
      <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={[styles.label, focused && styles.labelActive]}>
        {label}
      </Text>
    </PressableScale>
  );
}

type BadgeValue = string | number | undefined;

/**
 * The floating tab bar: a solid rounded pill inset from the screen edges and lifted above the bottom inset, with the camera
 * button raised out of its centre. It is absolutely positioned over the screen (no band behind it): content scrolls underneath
 * and every tab screen pads its content end by the footprint (`useTabContentInset`). The camera sits in the strip rather than
 * in the pill so its raised half stays inside the touchable bounds on Android. Draws nothing on Android while the keyboard is open.
 */
export function FloatingTabBar({
  state,
  descriptors,
  navigation,
  insets,
  camera,
}: BottomTabBarProps & { camera: { label: string; onPress: () => void } }) {
  const { theme } = useUnistyles();
  const { fontScale } = useWindowDimensions();
  const sides = useSafeAreaInsets();
  const keyboardOpen = useAndroidKeyboardOpen();
  if (keyboardOpen) return null;

  const itemHeight = tabItemHeight(fontScale);

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.strip,
        {
          paddingBottom: tabBarBottomOffset(insets.bottom, Platform.OS),
          // Landscape / folded hinge sides: keep the pill clear of the cutout and system bars.
          paddingLeft: TAB_BAR_MARGIN_X + sides.left,
          paddingRight: TAB_BAR_MARGIN_X + sides.right,
        },
      ]}
    >
      <View pointerEvents="box-none" style={styles.column}>
      <View accessibilityRole="tablist" style={[styles.pill, { height: tabBarPillHeight(fontScale) }]}>
        {state.routes.map((route, index) => {
          if (route.name === CAMERA_ROUTE) return <View key={route.key} style={styles.cameraSlot} />;
          const { options } = descriptors[route.key];
          const focused = index === state.index;
          const color = focused ? theme.colors.foreground : theme.colors.mutedForeground;
          const label = typeof options.tabBarLabel === "string" ? options.tabBarLabel : (options.title ?? route.name);
          const onPress = () => {
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) {
              navigation.dispatch({ ...CommonActions.navigate(route), target: state.key });
            }
          };
          return (
            <TabItem
              key={route.key}
              focused={focused}
              height={itemHeight}
              label={label}
              badge={options.tabBarBadge as BadgeValue}
              onPress={onPress}
              onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })}
              testID={options.tabBarButtonTestID}
            >
              {options.tabBarIcon?.({ focused, color, size: TAB_ICON_SIZE })}
            </TabItem>
          );
        })}
      </View>
      <View pointerEvents="box-none" style={styles.cameraRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={camera.label}
          onPress={camera.onPress}
          scaleTo={0.92}
          style={styles.camera}
        >
          <Ionicons name="camera" size={26} color={theme.colors.primaryForeground} />
        </PressableScale>
      </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Absolute over the screen, full width but only as tall as its content (pill, camera rise, gap, inset); box-none lets touches
  // fall through to the content around the pill.
  strip: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
  },
  column: {
    width: "100%",
    maxWidth: TAB_BAR_MAX_WIDTH,
    paddingTop: CAMERA_RAISE,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    padding: TAB_BAR_PADDING,
    borderWidth: TAB_BAR_BORDER,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.hairline,
    // One restrained lift: the pill floats over the content, so it carries the only shadow.
    shadowColor: "#1D1A15",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: TAB_ITEM_PADDING,
  },
  indicator: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.pill,
  },
  iconBox: {
    height: TAB_ICON_SIZE,
    minWidth: TAB_ICON_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: TAB_LABEL_SIZE,
    lineHeight: TAB_LABEL_LINE,
    fontFamily: theme.fonts.medium,
    color: theme.colors.mutedForeground,
  },
  labelActive: {
    color: theme.colors.foreground,
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.destructive,
  },
  badgeText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "800",
    color: theme.colors.destructiveForeground,
  },
  cameraSlot: {
    width: CAMERA_SLOT,
  },
  // Overlays the column's top, centred on the pill's centre slot; its raised part is inside the column's bounds.
  cameraRow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  camera: {
    width: CAMERA_OUTER,
    height: CAMERA_OUTER,
    borderRadius: CAMERA_OUTER / 2,
    borderWidth: CAMERA_RING,
    borderColor: theme.colors.card,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#1D1A15",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
}));
