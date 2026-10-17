import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent } from "react-native-webview";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/ui";
import { buildMapHtml } from "@/components/places/places-map-html";
import type { MapMessage, MapPin } from "@/components/places/places-map-html";
import { darkTheme } from "@/theme";
import type { Coords } from "@/src/lib/location";

/**
 * Map of the user's places (MapLibre GL in a WebView, OpenFreeMap tiles).
 * `interactive` false is the in-page preview: pins stay tappable but the map
 * does not pan, so it never fights the page scroll; "Perbesar peta" opens the
 * interactive one.
 */
export function PlacesMap({
  pins,
  origin,
  interactive,
  onSelect,
}: {
  pins: MapPin[];
  origin: Coords | null;
  interactive: boolean;
  onSelect: (key: string) => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation("place");
  const dark = theme.colors.background === darkTheme.colors.background;
  const [offline, setOffline] = useState(false);
  const html = useMemo(
    () =>
      buildMapHtml({
        pins,
        origin,
        dark,
        interactive,
        labels: { offline: t("map.offline"), cluster: t("map.cluster", { n: "%N%" }) },
        colors: {
          background: theme.colors.background,
          card: theme.colors.card,
          muted: theme.colors.muted,
          mutedForeground: theme.colors.mutedForeground,
          primary: theme.colors.primary,
          primaryForeground: theme.colors.primaryForeground,
        },
      }),
    [pins, origin, dark, interactive, theme, t],
  );

  const onMessage = (event: WebViewMessageEvent) => {
    let message: MapMessage;
    try {
      message = JSON.parse(event.nativeEvent.data) as MapMessage;
    } catch {
      return;
    }
    if (message.type === "select") onSelect(message.key);
    else setOffline(true);
  };

  return (
    <View style={styles.box} accessibilityLabel={t("map.aria")}>
      <WebView
        originWhitelist={["*"]}
        source={{ html, baseUrl: "https://joyorogo.app" }}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        overScrollMode="never"
        nestedScrollEnabled={interactive}
        setSupportMultipleWindows={false}
        style={styles.web}
      />
      {offline ? (
        <View style={styles.offline} pointerEvents="none">
          <Text style={styles.offlineText}>{t("map.offline")}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: {
    flex: 1,
    backgroundColor: theme.colors.muted,
    overflow: "hidden",
  },
  web: {
    flex: 1,
    backgroundColor: theme.colors.muted,
  },
  offline: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.lg,
  },
  offlineText: {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    textAlign: "center",
  },
}));
