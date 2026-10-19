import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { Linking, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { buyLinks } from "@joyorogo/api/lib/meal/links";
import type { BuyApp, BuyLink } from "@joyorogo/api/lib/meal/links";
import type { ItemView } from "@joyorogo/api/lib/meal/view";

import { PressableScale } from "@/components/motion";
import { Sheet, Text } from "@/components/ui";
import { useToast } from "@/components/toast";

const HINT: Record<BuyApp, "buy.nearbyHint" | "buy.appHint" | "buy.grabHint"> = {
  maps: "buy.nearbyHint",
  gofood: "buy.appHint",
  grabfood: "buy.grabHint",
  shopeefood: "buy.appHint",
};

function BuyBody({ item }: { item: Pick<ItemView, "buyQuery"> }) {
  const { t } = useTranslation("mealPlan");
  const { theme } = useUnistyles();
  const toast = useToast();

  // Plain https links: the phone opens the app when it is installed (App Links / Universal Links), else the browser.
  // No canOpenURL and no custom schemes, so nothing here needs a native config change.
  const open = async (link: BuyLink) => {
    if (link.copyName) {
      try {
        await Clipboard.setStringAsync(item.buyQuery);
        toast.success(t("buy.copied"));
      } catch {
        toast.error(t("buy.copyFailed", { name: item.buyQuery }));
      }
    }
    await Linking.openURL(link.url).catch(() => toast.error(t("loadError")));
  };

  return (
    <>
      <Text style={styles.subtitle}>{t("buy.subtitle")}</Text>
      {buyLinks(item.buyQuery).map((link) => (
        <PressableScale
          key={link.app}
          accessibilityRole="link"
          accessibilityLabel={link.app === "maps" ? t("buy.nearby") : t(`buy.${link.app}`)}
          onPress={() => void open(link)}
          scaleTo={0.99}
          dimTo={0.8}
          style={styles.row}
        >
          <Ionicons name={link.app === "maps" ? "location" : "bicycle"} size={22} color={theme.colors.primary} />
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{link.app === "maps" ? t("buy.nearby") : t(`buy.${link.app}`)}</Text>
            <Text style={styles.rowHint}>{t(HINT[link.app])}</Text>
          </View>
          <Ionicons name="open-outline" size={18} color={theme.colors.mutedForeground} />
        </PressableScale>
      ))}
      <Text style={styles.note}>{t("buy.note")}</Text>
    </>
  );
}

/** A meal to buy ready-made: look for it near you on Google Maps, or open GoFood, GrabFood or ShopeeFood. */
export function BuySheet({ item, onClose }: { item: ItemView | null; onClose: () => void }) {
  const { t } = useTranslation("mealPlan");
  return (
    <Sheet visible={item !== null} onClose={onClose} title={t("buy.title", { name: item?.name ?? "" })}>
      {item ? <BuyBody item={item} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  subtitle: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.mutedForeground,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    minHeight: 56,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.muted,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  rowHint: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.mutedForeground,
  },
  note: {
    fontSize: theme.fontSize.xs,
    lineHeight: 17,
    color: theme.colors.mutedForeground,
  },
}));
