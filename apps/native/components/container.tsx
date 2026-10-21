import "@/unistyles";
import React from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

// expo-router's react-navigation fork: 0 when the screen has no native
// header (tab screens, modals with headerShown: false).
import { useHeaderHeight } from "expo-router/build/react-navigation/elements";

import { useInTabs } from "@/components/tab-bar-inset";

export const Container = ({ children }: { children: React.ReactNode }) => {
  // A native stack header already clears the status bar; adding the top
  // edge again leaves an empty band between header and content. Only pad
  // the top on headerless screens (tabs, login, modals).
  const headerHeight = useHeaderHeight();
  // Inside the tab navigator the scene runs to the bottom of the screen and the
  // floating tab bar sits over it. The bottom inset is part of the bar's
  // footprint, which Screen adds to its content padding (useTabContentInset).
  const inTabs = useInTabs();
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
