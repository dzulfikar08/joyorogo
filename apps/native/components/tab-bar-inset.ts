import { useContext } from "react";
import { Platform, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
// expo-router's react-navigation fork: defined only inside a bottom-tab navigator.
import { BottomTabBarHeightContext } from "expo-router/build/react-navigation/bottom-tabs";
// True inside expo-router's NativeTabs (the iOS tab bar); its screens have no BottomTabBarHeightContext.
import { NativeTabsContext } from "expo-router/build/native-tabs/NativeBottomTabsNavigator";

import { tabContentInset } from "@/src/lib/tab-bar-metrics";

/** True inside a tab screen: the floating tab bar (Android) or the native tab bar (iOS) covers the bottom of the screen. */
export function useInTabs(): boolean {
  const js = useContext(BottomTabBarHeightContext) !== undefined;
  const native = useContext(NativeTabsContext);
  return js || native;
}

/**
 * Bottom padding for the content of a tab screen, so the last item scrolls fully above the floating bar
 * (the bar's footprint plus a gap). 0 outside the tabs.
 */
export function useTabContentInset(): number {
  const { fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // The native iOS tab bar needs no padding: react-native-screens turns on automatic content inset adjustment for the
  // screen's first scroll view, which already ends the content above the bar.
  const inTabs = useContext(BottomTabBarHeightContext) !== undefined;
  return inTabs ? tabContentInset(fontScale, insets.bottom, Platform.OS) : 0;
}
