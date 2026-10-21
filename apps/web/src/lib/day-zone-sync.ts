import { DEFAULT_DAY_ZONE, deviceDayZone, matchDayZone, resolveDayZone, setActiveDayZone } from "@joyorogo/i18n";
import type { DayZone, Region } from "@joyorogo/i18n";

/** Which zone the app cuts days in, and whether the profile should be told about it. */
export function planDayZone(input: {
  device: string | null;
  stored: string | null;
  hasProfile: boolean;
  region: Region;
}): { zone: DayZone; persist: boolean } {
  const zone = resolveDayZone(input);
  return { zone, persist: input.hasProfile && matchDayZone(input.stored) !== zone };
}

// Before the first screen renders: the device zone, else Jakarta until the profile says otherwise.
setActiveDayZone(deviceDayZone() ?? DEFAULT_DAY_ZONE);
