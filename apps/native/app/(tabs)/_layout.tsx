import "@/unistyles";
import { useBadgeUnlock } from "@/components/badges/use-badge-unlock";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Tabs, router } from "expo-router";
import { Fragment } from "react";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import type { ColorValue } from "react-native";
import Animated from "react-native-reanimated";

import { FloatingTabBar } from "@/components/floating-tab-bar";
import { useActivePop } from "@/components/motion";

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

/** Remounts a tab's screen on a language switch; the tab navigator itself keeps its state. */
function LocaleKeyed({ children }: { children: React.ReactElement }) {
  const { i18n } = useTranslation();
  return <Fragment key={i18n.language}>{children}</Fragment>;
}

export default function TabLayout() {
  const { t } = useTranslation();
  useBadgeUnlock();
  const unread = useUnreadCount();
  const unreadBadge = (unread.data?.count ?? 0) > 0 ? unread.data!.count : undefined;
  // Feed tab badge: social notifications (kudos/comment/follow), separate
  // from the group inbox badge on Lainnya.
  const social = useQuery(orpc.social.notificationsUnreadCount.queryOptions());
  const socialBadge = (social.data?.count ?? 0) > 0 ? social.data!.count : undefined;
  return (
    <Tabs
      tabBar={(props) => (
        <FloatingTabBar
          {...props}
          camera={{ label: t("nav.camera"), onPress: () => router.navigate("/makan-ai") }}
        />
      )}
      screenLayout={({ children }) => <LocaleKeyed>{children}</LocaleKeyed>}
      screenOptions={{
        headerShown: false,
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
