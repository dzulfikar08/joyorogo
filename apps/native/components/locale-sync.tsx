import { i18n, isLocale } from "@joyorogo/i18n";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { loadStoredLocale, setLocale } from "@/src/lib/i18n";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

/**
 * Reconciles the device language with the account once signed in: the saved
 * profile choice wins and is applied here; with none saved, a choice made on
 * this device before login (or before onboarding created the profile) is
 * uploaded. Mounted once, at the root.
 */
export function LocaleSync() {
  const { data: session } = authClient.useSession();
  const profile = useQuery({ ...orpc.profile.myProfile.queryOptions(), enabled: !!session });
  const save = useMutation(orpc.profile.setLocale.mutationOptions());
  const row = profile.data?.profile;

  useEffect(() => {
    if (!row) return;
    if (isLocale(row.locale)) {
      if (row.locale !== i18n.language) void setLocale(row.locale);
      return;
    }
    if (!save.isIdle) return;
    void loadStoredLocale().then((device) => {
      if (device) save.mutate({ locale: device });
    });
  }, [row, save]);

  return null;
}
