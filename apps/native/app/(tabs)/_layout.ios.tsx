import "@/unistyles";
import { useBadgeUnlock } from "@/components/badges/use-badge-unlock";
import { useTabBadges } from "@/components/tab-badges";
import { router } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import type { Href } from "expo-router";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";
import { useUnistyles } from "react-native-unistyles";

/** iOS 26 (Liquid Glass): icon-only tabs, and the camera as the `search` role's round button beside the bar. */
const LIQUID_GLASS = Number.parseInt(String(Platform.Version), 10) >= 26;

const TAB_HREF: Record<string, Href> = { index: "/", makan: "/makan", feed: "/feed", lainnya: "/lainnya" };

/**
 * The iOS tab bar is the system one (Liquid Glass on iOS 26). Android keeps the custom FloatingTabBar (_layout.tsx).
 *
 * The camera is not a screen: a native tab press cannot be cancelled, so selecting `kamera` only triggers the focus
 * listener below, which jumps back to the tab the user came from and opens the scanner on top of it.
 */
export default function TabLayout() {
  const { t, i18n } = useTranslation();
  const { theme } = useUnistyles();
  useBadgeUnlock();
  const badges = useTabBadges();
  const lastTab = useRef("index");
  // iOS 26 draws the `search` role as its own round glass button at the trailing end only when it is the last tab:
  // there the camera goes last, detached from the bar. Older iOS keeps it in the middle with the other tabs.
  const camera = (
    <NativeTabs.Trigger name="kamera" role={LIQUID_GLASS ? "search" : undefined} accessibilityLabel={t("nav.camera")}>
      <NativeTabs.Trigger.Icon sf={{ default: "camera", selected: "camera.fill" }} />
      <NativeTabs.Trigger.Label hidden={LIQUID_GLASS}>{t("nav.camera")}</NativeTabs.Trigger.Label>
    </NativeTabs.Trigger>
  );

  return (
    <NativeTabs
      // The tabs' screens hold module-level strings: a language switch (made on a screen pushed above the tabs)
      // remounts them. The navigator state lives in the parent route, so the selected tab survives.
      key={i18n.language}
      tintColor={theme.colors.primary}
      minimizeBehavior="onScrollDown"
      screenListeners={({ route }) => ({
        focus: () => {
          if (route.name !== "kamera") {
            lastTab.current = route.name;
            return;
          }
          router.navigate(TAB_HREF[lastTab.current] ?? "/");
          router.push("/makan-ai");
        },
      })}
    >
      <NativeTabs.Trigger name="index" accessibilityLabel={t("nav.home")}>
        <NativeTabs.Trigger.Icon sf={{ default: "house", selected: "house.fill" }} />
        <NativeTabs.Trigger.Label hidden={LIQUID_GLASS}>{t("nav.home")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="makan" accessibilityLabel={t("nav.food")}>
        <NativeTabs.Trigger.Icon sf="fork.knife" />
        <NativeTabs.Trigger.Label hidden={LIQUID_GLASS}>{t("nav.food")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      {LIQUID_GLASS ? null : camera}
      <NativeTabs.Trigger name="feed" accessibilityLabel={t("nav.feed")}>
        <NativeTabs.Trigger.Icon sf={{ default: "person.2", selected: "person.2.fill" }} />
        <NativeTabs.Trigger.Label hidden={LIQUID_GLASS}>{t("nav.feed")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={badges.feed === undefined}>
          {badges.feed === undefined ? undefined : String(badges.feed)}
        </NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="lainnya" accessibilityLabel={t("nav.more")}>
        <NativeTabs.Trigger.Icon sf={{ default: "ellipsis.circle", selected: "ellipsis.circle.fill" }} />
        <NativeTabs.Trigger.Label hidden={LIQUID_GLASS}>{t("nav.more")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={badges.more === undefined}>
          {badges.more === undefined ? undefined : String(badges.more)}
        </NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      {LIQUID_GLASS ? camera : null}
    </NativeTabs>
  );
}
