import { useContext } from "react";
import { Platform, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
// expo-router's react-navigation fork: defined only inside a bottom-tab navigator.
import { BottomTabBarHeightContext } from "expo-router/build/react-navigation/bottom-tabs";

import { tabContentInset } from "@/src/lib/tab-bar-metrics";

/** True inside a tab screen, where the floating tab bar covers the bottom of the screen. */
export function useInTabs(): boolean {
  return useContext(BottomTabBarHeightContext) !== undefined;
}

/**
 * Bottom padding for the content of a tab screen, so the last item scrolls fully above the floating bar
 * (the bar's footprint plus a gap). 0 outside the tabs.
 */
export function useTabContentInset(): number {
  const { fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const inTabs = useInTabs();
  return inTabs ? tabContentInset(fontScale, insets.bottom, Platform.OS) : 0;
}
