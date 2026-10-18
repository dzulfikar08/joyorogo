import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { env } from "@/env.public";
import { signOut } from "@/lib/auth-client";
import { getServerUrl, orpc } from "@/utils/orpc";

/**
 * Sign out, delete account and wipe data in one place: the hub's destructive
 * group and the Privasi screen both use it, each with its own confirm sheet
 * state. Never skips the in-app confirm sheet.
 */
export function useAccountActions() {
  const { t } = useTranslation(["settings", "common"]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [wiping, setWiping] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      setSignOutOpen(false);
      navigate({ to: "/login" });
    } finally {
      setSigningOut(false);
    }
  };

  // Server-side delete: data, photos and the user row (sessions and linked
  // logins cascade). Afterwards the session is dead; sign out only clears the
  // client state. An Apple-linked account needs the iPhone app (the server
  // answers with a message that says so; it surfaces as a toast).
  const deleteAccount = useMutation(
    orpc.privacy.deleteMyAccount.mutationOptions({
      onSuccess: async () => {
        try {
          await signOut();
        } catch {
          // the server session is already gone
        }
        queryClient.clear();
        setDeleteAccountOpen(false);
        navigate({ to: "/login" });
      },
      onError: (error) => {
        setDeleteAccountOpen(false);
        toast.error(`${t("account.delete.failedTitle")}: ${error.message}`);
      },
    }),
  );

  const wipeData = async () => {
    setWiping(true);
    try {
      const res = await fetch(`${getServerUrl(env.VITE_SERVER_URL)}/api/privacy/delete-my-data`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? t("privacy.wipe.failed"));
      }
      toast.success(t("privacy.wipe.done"));
      setWipeOpen(false);
      queryClient.clear();
      navigate({ to: "/onboarding" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("privacy.wipe.failed"));
    } finally {
      setWiping(false);
    }
  };

  return {
    signOutOpen,
    setSignOutOpen,
    signingOut,
    signOut: () => void handleSignOut(),
    deleteAccountOpen,
    setDeleteAccountOpen,
    deletingAccount: deleteAccount.isPending,
    deleteAccount: () => deleteAccount.mutate(undefined),
    wipeOpen,
    setWipeOpen,
    wiping,
    wipeData: () => void wipeData(),
  };
}
