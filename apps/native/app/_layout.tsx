import "@/unistyles";
import {
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/plus-jakarta-sans";
import { Stack } from "expo-router";
import { Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

import { Mascot } from "@/components/mascot";
import { Text } from "@/components/ui";
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
import { KeyboardProvider } from "react-native-keyboard-controller";
import { UnistylesRuntime, useUnistyles } from "react-native-unistyles";

import { authClient } from "@/lib/auth-client";
import { ToastProvider } from "@/components/toast";
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
          {/* Feeds every KeyboardAwareScrollView / KeyboardAvoidingView the
              keyboard position, Android edge-to-edge included. */}
          <KeyboardProvider>
          <ToastProvider>
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
            <Stack.Screen
              name="founder"
              options={{ title: "Founder", presentation: "modal", headerShown: false }}
            />
            <Stack.Screen name="inbox" options={{ title: "Kotak Masuk" }} />
            <Stack.Screen name="tips/[slug]" options={{ title: "Tips" }} />
            <Stack.Screen name="feed/[postId]" options={{ title: "Post" }} />
            <Stack.Screen name="feed/notifikasi" options={{ title: "Notifikasi" }} />
            <Stack.Screen name="u/[handle]" options={{ title: "Profil" }} />
            <Stack.Screen name="gabung" options={{ headerShown: false }} />
          </Stack>
          </ToastProvider>
          </KeyboardProvider>
        </GestureHandlerRootView>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

// Expo-router boundary for render errors anywhere in the app. It renders
// outside every provider above, so it stays self-contained: no hooks into
// auth, toast, or the query client.
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  const chunkError = /failed to fetch dynamically imported module|loading chunk/i.test(
    error.message,
  );

  return (
    <SafeAreaView style={errStyles.screen} edges={["top", "left", "right", "bottom"]}>
      <View style={errStyles.content}>
        <Mascot pose="surprised" size="xl" style={errStyles.mascot} />
        <Text style={errStyles.title}>
          {chunkError ? "Versi baru tersedia" : "Waduh, ada yang error"}
        </Text>
        <Text style={errStyles.description}>
          {chunkError
            ? "JoyoRogo baru saja diperbarui. Muat ulang aplikasi untuk memakai versi terbaru, ya."
            : "Ada yang salah di sisi kami. Tenang, datamu aman. Coba lagi dulu, yuk."}
        </Text>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [errStyles.button, pressed && errStyles.buttonPressed]}
          onPress={retry}
        >
          <Text style={errStyles.buttonText}>
            {chunkError ? "Muat ulang aplikasi" : "Coba lagi"}
          </Text>
        </Pressable>
        <Text style={errStyles.details} numberOfLines={4}>
          {error.message}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const errStyles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.lg,
  },
  mascot: {
    marginBottom: theme.spacing.lg,
  },
  title: {
    fontSize: theme.fontSize["2xl"],
    fontWeight: "800",
    color: theme.colors.foreground,
    textAlign: "center",
    marginBottom: theme.spacing.sm,
  },
  description: {
    color: theme.colors.mutedForeground,
    textAlign: "center",
    maxWidth: 300,
    lineHeight: 22,
    marginBottom: theme.spacing.xl,
  },
  button: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: 14,
    borderRadius: theme.radius.pill,
    minHeight: 48,
    justifyContent: "center",
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: theme.colors.primaryForeground,
    fontWeight: "700",
  },
  details: {
    marginTop: theme.spacing.xl,
    color: theme.colors.mutedForeground,
    fontSize: 12,
    textAlign: "center",
    maxWidth: 300,
  },
}));
