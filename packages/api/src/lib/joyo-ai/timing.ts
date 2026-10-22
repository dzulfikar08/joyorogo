// Ported from JoyoFit (watch-fit) src/features/ai/timing.ts, adapted for JoyoRogo.
/**
 * A timing mark for one question: `mark('first-token')` logs the milliseconds since the question began, to the console (logcat tag
 * ReactNativeJS), and keeps the last run in memory. Numbers and names only: never the question, the answer, the digest or the key.
 * It is how a slow answer is told apart (building the digest, waiting for the first byte, thinking, tools, writing).
 */
export type Mark = (name: string, extra?: Record<string, number | string>) => void;

export interface TimingRun {
  at: number;
  marks: { name: string; ms: number; extra?: Record<string, number | string> }[];
}

let last: TimingRun | null = null;

/** The marks of the most recent question (for tests and a future "details" line). */
export const lastTiming = (): TimingRun | null => last;

export function startTiming(label: string, now: () => number = Date.now, log: (line: string) => void = (line) => console.log(line)): Mark {
  const t0 = now();
  const run: TimingRun = { at: t0, marks: [] };
  last = run;
  return (name, extra) => {
    const ms = now() - t0;
    run.marks.push({ name, ms, ...(extra ? { extra } : {}) });
    log(`[joyoai] ${label} +${ms}ms ${name}${extra ? ` ${JSON.stringify(extra)}` : ''}`);
  };
}

export const noMark: Mark = () => {};
