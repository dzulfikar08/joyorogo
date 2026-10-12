import "@/unistyles";
import * as Linking from "expo-linking";
import { Redirect, Stack } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Container } from "@/components/container";
import { LogoMark } from "@/components/logo-mark";
import { Button, Text } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { queryClient } from "@/utils/orpc";

// Must stay named `ENV`: varlock's babel plugin only inlines `ENV.X` reads;
// anything else hits the runtime proxy, which throws in release builds.
import { ENV } from "../src/env";

export default function Login() {
  const { data: session, isPending } = authClient.useSession();
  const [signInError, setSignInError] = useState<string | null>(null);

  if (!isPending && session) {
    return <Redirect href="/" />;
  }

  const handleGoogleSignIn = () => {
    setSignInError(null);
    authClient.signIn.social({
      provider: "google",
      // expoClient rewrites this to the joyorogo:// deep link after OAuth
      callbackURL: Linking.createURL("/"),
    });
  };

  const handleDevSignIn = async () => {
    setSignInError(null);
    const { error } = await authClient.$fetch("/sign-in/dev-user", {
      method: "POST",
      body: {},
    });
    if (error) {
      setSignInError("Gagal masuk mode dev. Pastikan server berjalan, lalu coba lagi.");
      return;
    }
    queryClient.invalidateQueries();
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Container>
        <View style={styles.content}>
          <View style={styles.hero}>
            <LogoMark size={64} />
            <Text style={styles.logo}>JoyoRogo</Text>
            <Text style={styles.tagline}>
              Tiga angka tiap hari: boleh makan berapa, harus bakar berapa, butuh tidur berapa jam.
            </Text>
          </View>
          <View style={styles.actions}>
            <Button label="Masuk dengan Google" icon="logo-google" onPress={handleGoogleSignIn} />
            {ENV.EXPO_PUBLIC_DEV_LOGIN === "1" ? (
              <Button
                variant="secondary"
                label="Masuk (mode dev)"
                onPress={() => void handleDevSignIn()}
              />
            ) : null}
            {signInError ? <Text style={styles.errorText}>{signInError}</Text> : null}
          </View>
        </View>
      </Container>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: {
    flex: 1,
    justifyContent: "center",
    gap: theme.spacing.xxl,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.xxl,
  },
  hero: {
    alignItems: "center",
    gap: theme.spacing.md,
  },
  logo: {
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: -0.5,
    color: theme.colors.foreground,
  },
  tagline: {
    fontSize: theme.fontSize.base,
    color: theme.colors.mutedForeground,
    textAlign: "center",
    maxWidth: 300,
    lineHeight: 24,
  },
  actions: {
    gap: theme.spacing.md,
  },
  errorText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
    textAlign: "center",
  },
}));
