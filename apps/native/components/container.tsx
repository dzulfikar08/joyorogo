import "@/unistyles";
import React, { useContext } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

// expo-router's react-navigation fork: 0 when the screen has no native
// header (tab screens, modals with headerShown: false).
import { useHeaderHeight } from "expo-router/build/react-navigation/elements";
import { BottomTabBarHeightContext } from "expo-router/build/react-navigation/bottom-tabs";

export const Container = ({ children }: { children: React.ReactNode }) => {
  // A native stack header already clears the status bar; adding the top
  // edge again leaves an empty band between header and content. Only pad
  // the top on headerless screens (tabs, login, modals).
  const headerHeight = useHeaderHeight();
  // Inside the tab navigator the scene already ends at the tab bar, whose
  // height includes the bottom inset; padding it again leaves an inset-sized
  // gap of bare background above the bar (visible on iOS home-indicator
  // devices).
  const inTabs = useContext(BottomTabBarHeightContext) !== undefined;
  return (
    <SafeAreaView
      style={[styles.container, !inTabs && styles.bottomInset]}
      edges={headerHeight > 0 ? ["left", "right"] : ["top", "left", "right"]}
    >
      {children}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create((theme, rt) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  bottomInset: {
    paddingBottom: rt.insets.bottom,
  },
}));
