import "@/unistyles";
import {
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/plus-jakarta-sans";
import { Stack } from "expo-router";
// expo-router ships its own react-navigation fork; this is its theme
// context. Deep import: the SDK forbids a direct @react-navigation
// dependency, and the fork's DefaultTheme paints containers neutral grey.
import { ThemeProvider } from "expo-router/build/react-navigation/core";
import { DefaultTheme } from "expo-router/build/react-navigation/native/theming/DefaultTheme";
import { QueryClientProvider } from "@tanstack/react-query";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { UnistylesRuntime, useUnistyles } from "react-native-unistyles";

import { authClient } from "@/lib/auth-client";
import { useApkUpdate } from "@/src/lib/apk-update";
import { loadThemePref } from "@/src/lib/theme-pref";
import { orpc, queryClient } from "@/utils/orpc";

const darkCanvas = "#110F0A";

void SplashScreen.preventAutoHideAsync().catch(() => {
  // Splash already hidden (web) — nothing to do.
});

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

export default function RootLayout() {
  const { theme } = useUnistyles();
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });
  const { data: session } = authClient.useSession();

  // Restore the persisted override. "system" (or nothing stored) keeps
  // unistyles' adaptiveThemes, which follows the OS color scheme.
  useEffect(() => {
    void loadThemePref().then((pref) => {
      if (pref === "light" || pref === "dark") {
        // setTheme throws while adaptiveThemes is enabled.
        UnistylesRuntime.setAdaptiveThemes(false);
        UnistylesRuntime.setTheme(pref);
      }
    });
  }, []);

  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  // Speed: warm the two queries every screen leans on the moment a session
  // exists, so the first Beranda render has data instead of skeletons.
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    void queryClient.prefetchQuery(orpc.day.summary.queryOptions({ input: {} }));
    void queryClient.prefetchQuery(orpc.profile.myProfile.queryOptions());
  }, [userId]);

  // Android only: silent, throttled update check; iOS and web never fetch it.
  // The result is shown as a card in Profil.
  useApkUpdate();

  if (!fontsLoaded) {
    return null;
  }

  // React-navigation's default containers are neutral grey (#F2F2F2); feed
  // the navigators our palette so every surface is paper/card, not grey.
  const navTheme = {
    ...DefaultTheme,
    dark: theme.colors.background === darkCanvas,
    colors: {
      ...DefaultTheme.colors,
      primary: theme.colors.primary,
      background: theme.colors.background,
      card: theme.colors.card,
      text: theme.colors.foreground,
      border: theme.colors.hairline,
      notification: theme.colors.primary,
    },
  };

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={navTheme}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          {/* Follows the app theme (which can override the OS), not the OS. */}
          <StatusBar style={navTheme.dark ? "light" : "dark"} />
          <Stack
            screenOptions={{
              headerStyle: {
                backgroundColor: theme.colors.background,
              },
              headerTitleStyle: {
                color: theme.colors.foreground,
                fontFamily: theme.fonts.bold,
              },
              headerTintColor: theme.colors.foreground,
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen
              name="onboarding"
              options={{ headerShown: false, gestureEnabled: false }}
            />
            <Stack.Screen
              name="makan-ai"
              options={{ title: "Foto Makanan", presentation: "modal", headerShown: false }}
            />
          </Stack>
        </GestureHandlerRootView>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
