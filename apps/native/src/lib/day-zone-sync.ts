import { DEFAULT_DAY_ZONE, deviceDayZone, resolveDayZone, setActiveDayZone } from "@joyorogo/i18n";
import type { DayZone, Region } from "@joyorogo/i18n";

/** Before the profile loads: the device's zone when we serve it, else Jakarta. Runs at module load, before first render. */
export function applyDeviceDayZone(): void {
  setActiveDayZone(deviceDayZone() ?? DEFAULT_DAY_ZONE);
}

/** The zone to run on once the profile is known, and whether the server's stored zone is stale. */
export function planDayZone(input: {
  device: string | null;
  stored: string | null;
  region: Region;
}): { zone: DayZone; persist: boolean } {
  const zone = resolveDayZone({ device: input.device, stored: input.stored, hasProfile: true, region: input.region });
  return { zone, persist: zone !== input.stored };
}
