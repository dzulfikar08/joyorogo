/**
 * What ties the saved query cache (localStorage `jrg-cache`, restored before the first screen renders) to its writer:
 * - the build: an answer saved by an older build can lack fields the newer screens read as present (day.summary gained
 *   `exerciseSources` and the credit's `allDaySource` on 18 Okt; the restored summary of the same WIB day crashed the
 *   Beranda render on a direct load or refresh until the first refetch replaced it);
 * - the WIB day: yesterday's "today" must never render as today's;
 * - the account that wrote it.
 * Any difference drops the saved cache, so the screen waits for the network instead of trusting the old shape.
 */
export function cacheBusterKey(parts: { build: string; wibToday: string; owner: string | null }): string {
  return `${parts.build}:${parts.wibToday}:${parts.owner ?? "anon"}`;
}
