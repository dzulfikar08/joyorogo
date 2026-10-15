import "@/unistyles";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import type { Href } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Container } from "@/components/container";
import { Mascot } from "@/components/mascot";
import { Button, Text } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { queryClient } from "@/utils/orpc";

// Must stay named `ENV`: varlock's babel plugin only inlines `ENV.X` reads;
// anything else hits the runtime proxy, which throws in release builds.
import { ENV } from "../src/env";

export default function Login() {
  const { data: session, isPending } = authClient.useSession();
  const { next } = useLocalSearchParams<{ next?: string }>();
  // Protected screens (e.g. a gabung invite link opened while signed out)
  // pass their route here so the user lands back after signing in.
  const destination = (
    typeof next === "string" && next !== "" ? next : "/"
  ) as Href;
  const [signInError, setSignInError] = useState<string | null>(null);
  const { rt } = useUnistyles();
  const dark = (rt.themeName ?? rt.colorScheme) === "dark";
  const [appleAvailable, setAppleAvailable] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    void AppleAuthentication.isAvailableAsync().then(setAppleAvailable, () => setAppleAvailable(false));
  }, []);

  if (!isPending && session) {
    return <Redirect href={destination} />;
  }

  const handleGoogleSignIn = () => {
    setSignInError(null);
    authClient.signIn.social({
      provider: "google",
      // expoClient rewrites this to the joyorogo:// deep link after OAuth
      callbackURL: Linking.createURL("/"),
    });
  };

  const handleAppleSignIn = async () => {
    setSignInError(null);
    try {
      // Apple puts the SHA-256 of this value in the token's nonce claim;
      // better-auth hashes the raw nonce we send and compares.
      const rawNonce = Crypto.randomUUID();
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce,
      );
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });
      if (!credential.identityToken) {
        setSignInError("Apple tidak mengirim data masuk. Coba lagi.");
        return;
      }
      // Apple returns the name only on the very first authorization, and it is
      // not inside the identity token, so hand it to better-auth explicitly.
      const { givenName, familyName } = credential.fullName ?? {};
      const { error } = await authClient.signIn.social({
        provider: "apple",
        idToken: {
          token: credential.identityToken,
          nonce: rawNonce,
          ...(givenName || familyName
            ? { user: { name: { firstName: givenName ?? undefined, lastName: familyName ?? undefined } } }
            : {}),
        },
      });
      if (error) {
        setSignInError("Gagal masuk dengan Apple. Coba lagi sebentar.");
        return;
      }
      queryClient.invalidateQueries();
    } catch (e) {
      // Closing the Apple sheet is not an error.
      const code = typeof e === "object" && e !== null && "code" in e ? e.code : undefined;
      if (code === "ERR_REQUEST_CANCELED" || code === "ERR_CANCELED") return;
      setSignInError("Gagal masuk dengan Apple. Coba lagi sebentar.");
    }
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
            <Mascot pose="hero" size="md" />
            <Text style={styles.logo}>JoyoRogo</Text>
            <Text style={styles.tagline}>
              Tiga angka tiap hari: boleh makan berapa, harus bakar berapa, butuh tidur berapa jam.
            </Text>
          </View>
          <View style={styles.actions}>
            {appleAvailable ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={
                  dark
                    ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                    : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                }
                cornerRadius={24}
                style={styles.appleButton}
                onPress={() => void handleAppleSignIn()}
              />
            ) : null}
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
  appleButton: {
    height: 48,
    width: "100%",
  },
  errorText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
    textAlign: "center",
  },
}));
