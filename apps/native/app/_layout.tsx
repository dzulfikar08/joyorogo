import "@/unistyles";
import {
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/plus-jakarta-sans";
import { Stack } from "expo-router";
import { Platform, Pressable, View } from "react-native";
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
import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { useUnistyles } from "react-native-unistyles";

import { authClient } from "@/lib/auth-client";
import { LocaleSync } from "@/components/locale-sync";
import { PrefsSync } from "@/components/prefs-sync";
import { ReminderSync } from "@/components/reminders/reminder-sync";
import { PushSync } from "@/components/push/push-sync";
import { PushTapHandler } from "@/components/push/push-tap-handler";
import { ToastProvider } from "@/components/toast";
import { UpdateBanner } from "@/components/update-banner";
import { UpdateGate } from "@/components/update-gate";
import { loadStoredLocale, setLocale } from "@/src/lib/i18n";
import { applyThemePref, loadThemePref } from "@/src/lib/theme-pref";
import { orpc, queryClient } from "@/utils/orpc";

const darkCanvas = "#110F0A";

void SplashScreen.preventAutoHideAsync().catch(() => {
  // Splash already hidden (web) — nothing to do.
});

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

function LocaleKeyed({ children }: { children: React.ReactElement }) {
  const { i18n } = useTranslation();
  return <Fragment key={i18n.language}>{children}</Fragment>;
}

export default function RootLayout() {
  const { theme } = useUnistyles();
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });
  const { data: session } = authClient.useSession();
  const { t } = useTranslation();

  // The device's stored language choice replaces the device-language default
  // before the first screen renders, so nothing flashes in the wrong language.
  const [localeReady, setLocaleReady] = useState(false);
  useEffect(() => {
    void loadStoredLocale()
      .then((stored) => (stored ? setLocale(stored, { remember: false }) : undefined))
      .finally(() => setLocaleReady(true));
  }, []);

  // Restore the persisted override. "system" (or nothing stored) keeps
  // unistyles' adaptiveThemes, which follows the OS color scheme.
  useEffect(() => {
    void loadThemePref().then(applyThemePref);
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

  if (!fontsLoaded || !localeReady) {
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
          <LocaleSync />
          <PrefsSync />
          <ReminderSync />
          <PushSync />
          <PushTapHandler />
          {/* Android only: Play in-app update or sideload APK update. */}
          <UpdateBanner />
          {/* Cold-start OTA refresh, minimum-build block screen, iOS new-version banner (docs/force-update.md). */}
          <UpdateGate />
          {/* Follows the app theme (which can override the OS), not the OS. */}
          <StatusBar style={navTheme.dark ? "light" : "dark"} />
          <Stack
            // Screens remount on a language switch (dates and units read through
            // the shared format helpers, which have no subscription of their
            // own); navigation state survives. The tab navigator keeps its own
            // screens: wrapping it here would reset the selected tab.
            screenLayout={({ route, children }) =>
              route.name === "(tabs)" ? children : <LocaleKeyed>{children}</LocaleKeyed>
            }
            screenOptions={{
              headerStyle: {
                backgroundColor: theme.colors.background,
              },
              headerTitleStyle: {
                color: theme.colors.foreground,
                fontFamily: theme.fonts.bold,
              },
              headerTintColor: theme.colors.foreground,
              // iOS otherwise labels the back button with the previous route's
              // name, which for tab screens is the "(tabs)" group.
              headerBackButtonDisplayMode: "minimal",
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
              options={{ title: t("nav.title.scan"), presentation: "modal", headerShown: false }}
            />
            <Stack.Screen
              name="makan-barcode"
              options={{ title: t("nav.title.barcode"), presentation: "modal", headerShown: false }}
            />
            <Stack.Screen
              name="founder"
              options={{ title: t("nav.title.pro"), presentation: "modal", headerShown: false }}
            />
            <Stack.Screen name="inbox" options={{ title: t("nav.title.inbox") }} />
            <Stack.Screen name="koneksi" options={{ title: t("title", { ns: "koneksi" }) }} />
            <Stack.Screen name="profil/index" options={{ title: t("nav.title.profile") }} />
            <Stack.Screen name="profil/akun" options={{ title: t("hub.rows.account.title", { ns: "settings" }) }} />
            <Stack.Screen name="profil/langganan" options={{ title: t("hub.rows.subscription.title", { ns: "settings" }) }} />
            <Stack.Screen name="profil/target" options={{ title: t("hub.rows.body.title", { ns: "settings" }) }} />
            <Stack.Screen name="profil/makan" options={{ title: t("hub.rows.meals.title", { ns: "settings" }) }} />
            <Stack.Screen name="profil/strava" options={{ title: t("hub.rows.strava.title", { ns: "settings" }) }} />
            <Stack.Screen
              name="profil/kesehatan"
              options={{
                title: t(
                  Platform.OS === "ios"
                    ? "hub.rows.healthIos.title"
                    : "hub.rows.healthAndroid.title",
                  { ns: "settings" },
                ),
              }}
            />
            <Stack.Screen name="profil/pengingat" options={{ title: t("hub.rows.reminders.title", { ns: "settings" }) }} />
            <Stack.Screen name="profil/feed" options={{ title: t("hub.rows.feed.title", { ns: "settings" }) }} />
            <Stack.Screen name="profil/tampilan" options={{ title: t("hub.rows.display.title", { ns: "settings" }) }} />
            <Stack.Screen name="profil/kartu-beranda" options={{ title: t("cards.title", { ns: "home" }) }} />
            <Stack.Screen name="profil/privasi" options={{ title: t("hub.rows.privacy.title", { ns: "settings" }) }} />
            <Stack.Screen name="profil/tentang" options={{ title: t("hub.rows.about.title", { ns: "settings" }) }} />
            <Stack.Screen name="tips/[slug]" options={{ title: t("nav.title.tips") }} />
            <Stack.Screen name="feed/[postId]" options={{ title: t("nav.title.post") }} />
            <Stack.Screen name="feed/notifikasi" options={{ title: t("nav.title.notifications") }} />
            <Stack.Screen name="u/[handle]" options={{ title: t("nav.title.profile") }} />
            <Stack.Screen name="gabung/[code]" options={{ headerShown: false }} />
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
  const { t } = useTranslation();
  const chunkError = /failed to fetch dynamically imported module|loading chunk/i.test(
    error.message,
  );

  return (
    <SafeAreaView style={errStyles.screen} edges={["top", "left", "right", "bottom"]}>
      <View style={errStyles.content}>
        <Mascot pose="surprised" size="xl" style={errStyles.mascot} />
        <Text style={errStyles.title}>
          {chunkError ? t("errorScreen.updateTitle") : t("errorScreen.crashTitle")}
        </Text>
        <Text style={errStyles.description}>
          {chunkError ? t("errorScreen.updateBody") : t("errorScreen.crashBody")}
        </Text>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [errStyles.button, pressed && errStyles.buttonPressed]}
          onPress={retry}
        >
          <Text style={errStyles.buttonText}>
            {chunkError ? t("errorScreen.reload") : t("actions.retry")}
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
