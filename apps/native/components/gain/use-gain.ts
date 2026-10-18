import { useQuery } from "@tanstack/react-query";

import type { GainInfo, Goal } from "@joyorogo/api/lib/gain";

import { orpc } from "@/utils/orpc";

/**
 * Naikin BB state of the signed-in user from the cached profile query.
 * `gain` is the active surplus plan (null otherwise, also once the target weight is reached
 * and always during Hamil / Menyusui); `goal` is the stored direction ("lose" for accounts
 * that never chose one).
 */
export function useGain(): { gain: GainInfo | null; goal: Goal } {
  const { data } = useQuery(orpc.profile.myProfile.queryOptions());
  return { gain: data?.targets?.gain ?? null, goal: data?.profile?.goal ?? "lose" };
}
