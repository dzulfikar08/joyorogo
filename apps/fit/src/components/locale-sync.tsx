import { getActiveRegion, i18n, isLocale, resolveDayZone, setActiveDayZone } from "@joyorogo/i18n";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { setLocale, storedLocale } from "@/lib/i18n";
import { orpc } from "@/lib/orpc";

/**
 * Reconciles the device language with the account once signed in: the saved profile choice wins and is applied here;
 * with none saved, a choice made on this device before login is uploaded. Mounted in the signed-in shell only.
 */
export function LocaleSync() {
  const profile = useQuery(orpc.profile.myProfile.queryOptions());
  const save = useMutation(orpc.profile.setLocale.mutationOptions());
  const row = profile.data?.profile;

  useEffect(() => {
    if (!row) return;
    setActiveDayZone(
      resolveDayZone({
        device: Intl.DateTimeFormat().resolvedOptions().timeZone,
        stored: row.timezone,
        hasProfile: true,
        region: getActiveRegion(),
      }),
    );
    if (isLocale(row.locale)) {
      if (row.locale !== i18n.language) void setLocale(row.locale);
      return;
    }
    const device = storedLocale();
    if (device && save.isIdle) save.mutate({ locale: device });
  }, [row, save]);

  return null;
}
