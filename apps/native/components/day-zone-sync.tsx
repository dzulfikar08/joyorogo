import { getActiveDayZone, getActiveRegion, setActiveDayZone } from "@joyorogo/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { authClient } from "@/lib/auth-client";
import { planDayZone } from "@/src/lib/day-zone-sync";
import { deviceTimeZone } from "@/src/lib/device-time-zone";
import { orpc } from "@/utils/orpc";

/**
 * Settles the zone a person's days are cut in once the profile is known (it reuses the myProfile query the root
 * already prefetches): the device zone when we serve it, else the stored one. The server copy is refreshed once per
 * app load when it differs, and every cached query is dropped when the active zone changes, since day-keyed data
 * was fetched under the old cut. Mounted once, at the root.
 */
export function DayZoneSync() {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const profile = useQuery({ ...orpc.profile.myProfile.queryOptions(), enabled: !!session });
  const save = useMutation(orpc.profile.setTimezone.mutationOptions());
  const row = profile.data?.profile;
  const synced = useRef(false);

  useEffect(() => {
    if (!row) return;
    const plan = planDayZone({
      device: deviceTimeZone(),
      stored: row.timezone ?? null,
      region: getActiveRegion(),
    });
    if (plan.zone !== getActiveDayZone()) {
      setActiveDayZone(plan.zone);
      void queryClient.invalidateQueries();
    }
    if (plan.persist && !synced.current) {
      synced.current = true;
      save.mutate({ timezone: plan.zone });
    }
  }, [row, save, queryClient]);

  return null;
}
