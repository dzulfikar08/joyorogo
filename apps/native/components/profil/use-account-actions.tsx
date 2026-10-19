import "@/unistyles";
import * as AppleAuthentication from "expo-apple-authentication";
import { useMutation } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { useTranslation } from "react-i18next";

import { ConfirmSheet } from "@/components/confirm-sheet";
import { useToast } from "@/components/toast";
import { authClient } from "@/lib/auth-client";
import { forgetPush, unregisterPush } from "@/src/lib/push";
import { teardownReminders } from "@/src/lib/notifications";
import { flushPrefsSync, forgetPrefsSync } from "@/src/lib/prefs-sync";
import { errorMessage } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

/** Account-level actions behind the Profil hub's destructive rows and the Privasi screen's wipe row. */
export interface AccountActions {
  /** Open the sign-out confirmation. */
  askSignOut: () => void;
  /** Open the delete-account confirmation. */
  askDeleteAccount: () => void;
  /** Open the wipe-all-data confirmation. */
  askWipeData: () => void;
  deleteAccountPending: boolean;
  wipeDataPending: boolean;
  /** The confirm sheets; render once, anywhere in the screen. */
  sheets: ReactNode;
}

/**
 * One implementation of sign out, delete account (incl. the Apple token revoke flow) and wipe
 * data. Every hook runs unconditionally; screens render `sheets` next to their rows.
 */
export function useAccountActions(): AccountActions {
  const { t } = useTranslation(["settings", "common"]);
  const toast = useToast();
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [appleChecking, setAppleChecking] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Server-side delete: wipes data, photos and the user row (sessions and
  // Google/Apple logins cascade). Afterwards the local session is dead, so
  // sign out best-effort just to clear SecureStore.
  const deleteAccount = useMutation(
    orpc.privacy.deleteMyAccount.mutationOptions({
      onSuccess: async () => {
        try {
          await authClient.signOut();
        } catch {
          // the server session is already gone
        }
        queryClient.clear();
        forgetPrefsSync();
        await forgetPush();
        await teardownReminders();
        router.replace("/login");
      },
      onError: (e) => toast.error(t("account.delete.failedTitle"), errorMessage(e)),
    }),
  );

  const deleteData = useMutation(
    orpc.privacy.deleteMyData.mutationOptions({
      onSuccess: async () => {
        queryClient.clear();
        await teardownReminders();
        router.replace("/onboarding");
      },
      onError: (e) => toast.error(t("privacy.wipe.failedTitle"), errorMessage(e)),
    }),
  );

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await flushPrefsSync();
      await unregisterPush();
      await authClient.signOut();
      queryClient.clear();
      forgetPrefsSync();
      await teardownReminders();
      router.replace("/login");
    } finally {
      setSigningOut(false);
      setSignOutOpen(false);
    }
  };

  // Apple 5.1.1(v): an Apple-linked account needs a fresh authorization code so
  // the server can revoke the Sign in with Apple token. Cancelling the Apple
  // sheet keeps the confirm sheet open and does nothing else.
  const confirmDeleteAccount = async () => {
    if (appleChecking || deleteAccount.isPending) return;
    if (Platform.OS !== "ios") {
      setDeleteAccountOpen(false);
      deleteAccount.mutate(undefined);
      return;
    }
    setAppleChecking(true);
    try {
      const accounts = await authClient.listAccounts();
      const hasApple = (accounts.data ?? []).some((a) => a.providerId === "apple");
      if (!hasApple) {
        setDeleteAccountOpen(false);
        deleteAccount.mutate(undefined);
        return;
      }
      const credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
      if (!credential.authorizationCode) {
        toast.error(t("account.delete.failedTitle"), t("account.delete.noAppleCode"));
        return;
      }
      setDeleteAccountOpen(false);
      deleteAccount.mutate({ appleAuthorizationCode: credential.authorizationCode });
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      if (code === "ERR_REQUEST_CANCELED") return;
      toast.error(t("account.delete.failedTitle"), errorMessage(e));
    } finally {
      setAppleChecking(false);
    }
  };

  const sheets = (
    <>
      <ConfirmSheet
        visible={signOutOpen}
        onClose={() => setSignOutOpen(false)}
        title={t("hubNative.signOut.confirmTitle")}
        message={t("hubNative.signOut.confirmMessage")}
        confirmLabel={t("account.signOut")}
        cancelLabel={t("common:actions.cancel")}
        destructive={false}
        loading={signingOut}
        onConfirm={() => void signOut()}
      />
      <ConfirmSheet
        visible={wipeOpen}
        onClose={() => setWipeOpen(false)}
        title={t("privacy.wipe.confirmTitle")}
        message={t("privacy.wipe.confirmMessageNative")}
        confirmLabel={t("common:actions.delete")}
        loading={deleteData.isPending}
        onConfirm={() => {
          setWipeOpen(false);
          deleteData.mutate();
        }}
      />
      <ConfirmSheet
        visible={deleteAccountOpen}
        onClose={() => setDeleteAccountOpen(false)}
        title={t("account.delete.confirmTitle")}
        message={t("account.delete.confirmMessage")}
        confirmLabel={t("account.delete.title")}
        cancelLabel={t("common:actions.cancel")}
        loading={deleteAccount.isPending}
        onConfirm={() => void confirmDeleteAccount()}
      />
    </>
  );

  return {
    askSignOut: () => setSignOutOpen(true),
    askDeleteAccount: () => setDeleteAccountOpen(true),
    askWipeData: () => setWipeOpen(true),
    deleteAccountPending: deleteAccount.isPending,
    wipeDataPending: deleteData.isPending,
    sheets,
  };
}
