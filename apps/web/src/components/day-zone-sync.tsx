import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { getActiveDayZone, getActiveRegion, setActiveDayZone } from "@joyorogo/i18n";

import { planDayZone } from "@/lib/day-zone-sync";
import { orpc } from "@/utils/orpc";

/**
 * Settles the zone the app cuts days in once the profile is known (the device zone was applied at start-up,
 * lib/day-zone-sync.ts) and tells the account about it once per load. A change of zone re-keys every cached day,
 * so everything is invalidated. Renders nothing; mount once inside the signed-in shell.
 */
export function DayZoneSync() {
  const queryClient = useQueryClient();
  const profile = useQuery(orpc.profile.myProfile.queryOptions());
  const setTimezone = useMutation(orpc.profile.setTimezone.mutationOptions());
  const reported = useRef(false);
  const loaded = profile.data;
  const stored = loaded?.profile?.timezone ?? null;
  const hasProfile = !!loaded?.profile;

  useEffect(() => {
    if (!loaded) return;
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const plan = planDayZone({ device, stored, hasProfile, region: getActiveRegion() });
    if (plan.zone !== getActiveDayZone()) {
      setActiveDayZone(plan.zone);
      void queryClient.invalidateQueries();
    }
    if (plan.persist && !reported.current) {
      reported.current = true;
      setTimezone.mutate({ timezone: device });
    }
  }, [loaded, stored, hasProfile, queryClient, setTimezone]);

  return null;
}
