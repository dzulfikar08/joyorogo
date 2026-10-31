import "@/unistyles";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import type { Href } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { CONTENT_MAX_WIDTH } from "@/src/lib/layout";
import { Container } from "@/components/container";
import { Mascot } from "@/components/mascot";
import { BootLoader, Button, Field, Input, Text } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { signInWithNativeGoogle } from "@/src/lib/google-native";
import { nativeGoogleAvailable, requestGoogleIdToken } from "@/src/lib/google-native-device";
import { restoreAccountPrefs } from "@/src/lib/prefs-sync";
import { queryClient } from "@/utils/orpc";

// Must stay named `ENV`: varlock's babel plugin only inlines `ENV.X` reads;
// anything else hits the runtime proxy, which throws in release builds.
import { ENV } from "../src/env";

/** What went wrong, as `Name: message`, short enough for one line under the buttons. */
function failureReason(e: unknown): string {
  return (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 120);
}

export default function Login() {
  const { t } = useTranslation("auth");
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
  // Review login (Google Play / App Store reviewers): email + password, only
  // accepted server-side for the REVIEW_LOGIN_EMAILS allowlist.
  const [emailForm, setEmailForm] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  // Every sign-in path (Apple, Google deep link, email, dev) ends with a session here. The account's preferences and
  // language are restored first, bounded, so the app opens in the language and theme the person chose elsewhere.
  const userId = !isPending && session ? session.user.id : null;
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  useEffect(() => {
    if (!userId) return;
    let live = true;
    void restoreAccountPrefs(userId)
      .catch(() => undefined)
      .then(() => {
        if (live) setRestoredFor(userId);
      });
    return () => {
      live = false;
    };
  }, [userId]);
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    void AppleAuthentication.isAvailableAsync().then(setAppleAvailable, () => setAppleAvailable(false));
  }, []);

  if (userId) {
    return restoredFor === userId ? <Redirect href={destination} /> : <BootLoader />;
  }

  const runBrowserGoogleSignIn = async () => {
    const { error } = await authClient.signIn.social({
      provider: "google",
      // expoClient rewrites this to the joyorogo:// deep link after OAuth
      callbackURL: Linking.createURL("/"),
    });
    if (error) setSignInError(t("login.error.googleFailed"));
  };

  const handleGoogleSignIn = async () => {
    if (googleBusy) return;
    setSignInError(null);
    setGoogleBusy(true);
    try {
      // Android: Google's account picker from Play services, then the ID token goes to better-auth. The browser flow
      // is only for binaries without the native module and installs where native sign-in cannot work.
      const outcome = await signInWithNativeGoogle({
        available: nativeGoogleAvailable,
        requestIdToken: requestGoogleIdToken,
        exchange: (token) => authClient.signIn.social({ provider: "google", idToken: { token } }),
        log: (message) => console.log(message),
      });
      if (outcome.kind === "cancelled") return;
      if (outcome.kind === "failed") {
        setSignInError(`${t("login.error.googleFailed")} (${outcome.reason.slice(0, 120)})`);
        return;
      }
      if (outcome.kind === "fallback") {
        await runBrowserGoogleSignIn();
        return;
      }
      queryClient.invalidateQueries();
    } catch (e) {
      // The request or the browser never started (nothing reached the server): say so, with the reason, instead of
      // leaving a button that looks dead.
      console.log("[login] Google sign-in threw", e);
      setSignInError(`${t("login.error.googleFailed")} (${failureReason(e)})`);
    } finally {
      setGoogleBusy(false);
    }
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
        setSignInError(t("login.error.appleNoToken"));
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
        setSignInError(t("login.error.appleFailed"));
        return;
      }
      queryClient.invalidateQueries();
    } catch (e) {
      // Closing the Apple sheet is not an error.
      const code = typeof e === "object" && e !== null && "code" in e ? e.code : undefined;
      if (code === "ERR_REQUEST_CANCELED" || code === "ERR_CANCELED") return;
      setSignInError(t("login.error.appleFailed"));
    }
  };

  const handleDevSignIn = async () => {
    setSignInError(null);
    const { error } = await authClient.$fetch("/sign-in/dev-user", {
      method: "POST",
      body: {},
    });
    if (error) {
      setSignInError(t("login.error.devFailed"));
      return;
    }
    queryClient.invalidateQueries();
  };

  const handleEmailSignIn = async () => {
    setSignInError(null);
    setEmailBusy(true);
    try {
      const { error } = await authClient.signIn.email({ email: email.trim(), password });
      if (error) {
        setSignInError(
          error.status === 429 ? t("login.error.rateLimited") : t("login.error.invalidCredentials"),
        );
        return;
      }
      queryClient.invalidateQueries();
    } catch (e) {
      console.log("[login] email sign-in threw", e);
      setSignInError(`${t("login.error.network")} (${failureReason(e)})`);
    } finally {
      setEmailBusy(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Container>
        <KeyboardAwareScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          bottomOffset={24}
        >
          <View style={styles.hero}>
            <Mascot pose="wave" size="lg" />
            <Text style={styles.logo}>JoyoRogo</Text>
            <Text style={styles.tagline}>{t("login.taglineApp")}</Text>
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
            <Button
              label={t("login.google")}
              icon="logo-google"
              loading={googleBusy}
              onPress={() => void handleGoogleSignIn()}
            />
            {ENV.EXPO_PUBLIC_DEV_LOGIN === "1" ? (
              <Button
                variant="secondary"
                label={t("login.dev")}
                onPress={() => void handleDevSignIn()}
              />
            ) : null}
            {emailForm ? (
              <View style={styles.emailForm}>
                <Field label={t("login.email.emailLabel")}>
                  <Input
                    value={email}
                    onChangeText={setEmail}
                    placeholder={t("login.email.emailPlaceholder")}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                    autoCorrect={false}
                    textContentType="username"
                  />
                </Field>
                <Field label={t("login.email.passwordLabel")}>
                  <Input
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    autoCapitalize="none"
                    autoComplete="current-password"
                    autoCorrect={false}
                    textContentType="password"
                    onSubmitEditing={() => void handleEmailSignIn()}
                  />
                </Field>
                <Button
                  label={t("login.email.submit")}
                  loading={emailBusy}
                  disabled={email.trim() === "" || password === ""}
                  onPress={() => void handleEmailSignIn()}
                />
              </View>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                label={t("login.email.toggle")}
                onPress={() => setEmailForm(true)}
              />
            )}
            {signInError ? <Text style={styles.errorText}>{signInError}</Text> : null}
          </View>
        </KeyboardAwareScrollView>
      </Container>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: {
    flexGrow: 1,
    justifyContent: "center",
    gap: theme.spacing.xxl,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.xxl,
    // Centred column on foldables and iPad; phones are narrower than the cap.
    "@sm": {
      maxWidth: CONTENT_MAX_WIDTH,
      width: "100%",
      alignSelf: "center",
    },
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
  emailForm: {
    gap: theme.spacing.md,
  },
  errorText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
    textAlign: "center",
  },
}));
