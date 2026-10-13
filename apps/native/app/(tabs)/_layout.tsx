import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Tabs, router } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, View, type ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUnistyles } from "react-native-unistyles";

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
  return <Ionicons name={focused ? name : outline} size={size} color={color} />;
}

export default function TabLayout() {
  const { theme } = useUnistyles();
  const unread = useUnreadCount();
  const unreadBadge = (unread.data?.count ?? 0) > 0 ? unread.data!.count : undefined;
  // Feed tab badge: social notifications (kudos/comment/follow), separate
  // from the group inbox badge on Lainnya.
  const social = useQuery(orpc.social.notificationsUnreadCount.queryOptions());
  const socialBadge = (social.data?.count ?? 0) > 0 ? social.data!.count : undefined;
  // Labels need clear space above the bottom edge, with or without a home
  // indicator: bar = 6 padding + icon + label + 8 clearance + safe inset.
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.foreground,
        tabBarInactiveTintColor: theme.colors.mutedForeground,
        tabBarStyle: {
          backgroundColor: theme.colors.card,
          borderTopColor: theme.colors.hairline,
          height: 66 + insets.bottom,
          paddingTop: 6,
          paddingBottom: 8 + insets.bottom,
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
          tabBarLabel: "Beranda",
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
          tabBarLabel: "Makan",
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Foto makanan dengan AI"
              onPress={() => router.navigate("/makan-ai")}
              style={({ pressed }) => ({
                flex: 1,
                alignItems: "center",
                justifyContent: "flex-start",
                opacity: pressed ? 0.8 : 1,
              })}
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
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          tabBarLabel: "Feed",
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
          tabBarLabel: "Lainnya",
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
      {/* Reached from the Beranda tiles, not from the tab bar. href must not
          be combined with a custom tabBarButton (earlier crash). */}
      <Tabs.Screen name="olahraga" options={{ href: null }} />
      <Tabs.Screen name="berat" options={{ href: null }} />
      <Tabs.Screen name="tidur" options={{ href: null }} />
    </Tabs>
  );
}
