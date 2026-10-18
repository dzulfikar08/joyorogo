import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Tabs, router } from "expo-router";
import { Fragment } from "react";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View, type ColorValue } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUnistyles } from "react-native-unistyles";

import { PressableScale, useActivePop, usePressFeedback } from "@/components/motion";

import { useUnreadCount } from "@/src/lib/group";
import { orpc } from "@/utils/orpc";

type IconName = ComponentProps<typeof Ionicons>["name"];

function TabIcon({
  focused,
  name,
  outline,
  size,
  color,
}: {
  focused: boolean;
  name: IconName;
  outline: IconName;
  size: number;
  color: ColorValue;
}) {
  const pop = useActivePop(focused);
  return (
    <Animated.View style={pop}>
      <Ionicons name={focused ? name : outline} size={size} color={color} />
    </Animated.View>
  );
}

/** Tab bar button: icon and label dip on press; the active icon pops in TabIcon. */
function TabButton({
  children,
  ...props
}: Pick<
  ComponentProps<typeof Pressable>,
  "onPress" | "onLongPress" | "testID" | "style" | "role" | "aria-label" | "aria-selected"
> & { children: React.ReactNode }) {
  const press = usePressFeedback(0.9);
  return (
    <Pressable {...props} onPressIn={press.onPressIn} onPressOut={press.onPressOut}>
      <Animated.View style={[{ alignItems: "center" }, press.style]}>{children}</Animated.View>
    </Pressable>
  );
}

/** Remounts a tab's screen on a language switch; the tab navigator itself keeps its state. */
function LocaleKeyed({ children }: { children: React.ReactElement }) {
  const { i18n } = useTranslation();
  return <Fragment key={i18n.language}>{children}</Fragment>;
}

export default function TabLayout() {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const unread = useUnreadCount();
  const unreadBadge = (unread.data?.count ?? 0) > 0 ? unread.data!.count : undefined;
  // Feed tab badge: social notifications (kudos/comment/follow), separate
  // from the group inbox badge on Lainnya.
  const social = useQuery(orpc.social.notificationsUnreadCount.queryOptions());
  const socialBadge = (social.data?.count ?? 0) > 0 ? social.data!.count : undefined;
  // The bottom inset (gesture pill, 3-button nav, iOS home indicator) is added
  // once, to both height and paddingBottom, so icon + label sit fully above the
  // system bar. The extra 6 is breathing room under the labels.
  const insets = useSafeAreaInsets();
  const bottomPad = insets.bottom + 6;

  return (
    <Tabs
      screenLayout={({ children }) => <LocaleKeyed>{children}</LocaleKeyed>}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.foreground,
        tabBarInactiveTintColor: theme.colors.mutedForeground,
        tabBarButton: (props) => (
          <TabButton
            onPress={props.onPress}
            onLongPress={props.onLongPress}
            testID={props.testID}
            style={props.style}
            role={props.role}
            aria-label={props["aria-label"]}
            aria-selected={props["aria-selected"]}
          >
            {props.children}
          </TabButton>
        ),
        tabBarStyle: {
          backgroundColor: theme.colors.card,
          borderTopColor: theme.colors.hairline,
          height: 58 + bottomPad,
          paddingTop: 6,
          paddingBottom: bottomPad,
          shadowColor: "#1D1A15",
          shadowOpacity: 0.06,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: -4 },
          elevation: 12,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontFamily: theme.fonts.medium,
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarLabel: t("nav.home"),
          tabBarIcon: ({ focused, size, color }) => (
            <TabIcon
              focused={focused}
              name="home"
              outline="home-outline"
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="makan"
        options={{
          tabBarLabel: t("nav.food"),
          tabBarIcon: ({ focused, size, color }) => (
            <TabIcon
              focused={focused}
              name="restaurant"
              outline="restaurant-outline"
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="kamera"
        options={{
          headerShown: false,
          tabBarLabel: "",
          tabBarButton: () => (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t("nav.camera")}
              onPress={() => router.navigate("/makan-ai")}
              scaleTo={0.92}
              style={{ flex: 1, alignItems: "center", justifyContent: "flex-start" }}
            >
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  marginTop: -18,
                  backgroundColor: theme.colors.primary,
                  alignItems: "center",
                  justifyContent: "center",
                  shadowColor: "#1D1A15",
                  shadowOpacity: 0.25,
                  shadowRadius: 10,
                  shadowOffset: { width: 0, height: 4 },
                  elevation: 8,
                }}
              >
                <Ionicons name="camera" size={26} color={theme.colors.primaryForeground} />
              </View>
            </PressableScale>
          ),
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          tabBarLabel: t("nav.feed"),
          tabBarBadge: socialBadge,
          tabBarIcon: ({ focused, size, color }) => (
            <TabIcon
              focused={focused}
              name="newspaper"
              outline="newspaper-outline"
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="lainnya"
        options={{
          tabBarLabel: t("nav.more"),
          tabBarBadge: unreadBadge,
          tabBarIcon: ({ focused, size, color }) => (
            <TabIcon
              focused={focused}
              name="ellipsis-horizontal"
              outline="ellipsis-horizontal-outline"
              size={size}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
