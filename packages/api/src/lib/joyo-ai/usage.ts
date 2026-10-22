// Ported from JoyoFit (watch-fit) src/features/ai/usage.ts, adapted for JoyoRogo.
// The calls and tokens spent today with the person's own key, counted on the device only. Pure and storage-agnostic: the caller
// persists `UsageState` and passes its own local day string (YYYY-MM-DD).
import type { Usage } from './types';

export interface UsageState {
  day: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export const emptyUsage = (day: string): UsageState => ({ day, calls: 0, inputTokens: 0, outputTokens: 0 });

export const isUsageState = (v: unknown): v is UsageState =>
  typeof v === 'object' && v !== null && typeof (v as UsageState).day === 'string' && typeof (v as UsageState).calls === 'number' && typeof (v as UsageState).inputTokens === 'number' && typeof (v as UsageState).outputTokens === 'number';

/** The usage of `day`: the stored state when it is today's, else zero. Damaged state counts as zero. */
export function todayUsage(state: unknown, day: string): UsageState {
  return isUsageState(state) && state.day === day ? state : emptyUsage(day);
}

/** Counts one provider call, with its tokens when the provider reported them. */
export function recordUsage(state: unknown, day: string, usage: Usage | null): UsageState {
  const now = todayUsage(state, day);
  return { ...now, calls: now.calls + 1, inputTokens: now.inputTokens + (usage?.inputTokens ?? 0), outputTokens: now.outputTokens + (usage?.outputTokens ?? 0) };
}
