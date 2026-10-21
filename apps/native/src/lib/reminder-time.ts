/** Minutes-of-day in the person's day zone → the device's wall-clock minutes-of-day (both offsets in minutes from UTC). */
export function zoneToLocalMinutes(zoneMin: number, deviceOffsetMin: number, zoneOffsetMin: number): number {
  const shifted = zoneMin + deviceOffsetMin - zoneOffsetMin;
  return ((shifted % 1440) + 1440) % 1440;
}
