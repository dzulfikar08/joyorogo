import { Ionicons } from "@expo/vector-icons";
import { File, Paths } from "expo-file-system";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Platform, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { authClient } from "@/lib/auth-client";

/** Private plate photo (/dishware-photo/:id): downloaded with the session cookie, like the VAR photos. */
export function PlatePhoto({ photoUrl, size = 56 }: { photoUrl: string; size?: number }) {
  const { theme } = useUnistyles();
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUri(null);
    setFailed(false);
    if (Platform.OS === "web") {
      setUri(photoUrl);
      return;
    }
    void (async () => {
      try {
        const headers: Record<string, string> = {};
        const cookie = await authClient.getCookie();
        if (cookie) headers.Cookie = cookie;
        const file = await File.downloadFileAsync(
          photoUrl,
          new File(Paths.cache, `joyorogo-dishware-${photoUrl.split("/").pop() ?? "plate"}.jpg`),
          { headers, idempotent: true },
        );
        if (!cancelled) setUri(file.uri);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [photoUrl]);

  const box = { width: size, height: size };
  if (uri === null || failed) {
    return (
      <View style={[styles.box, box]}>
        {failed ? (
          <Ionicons name="image-outline" size={20} color={theme.colors.mutedForeground} />
        ) : (
          <ActivityIndicator color={theme.colors.mutedForeground} />
        )}
      </View>
    );
  }
  return <Image source={{ uri }} style={[styles.box, box]} resizeMode="cover" />;
}

const styles = StyleSheet.create((theme) => ({
  box: {
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.muted,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
}));
