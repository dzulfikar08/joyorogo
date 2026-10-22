// Ported from JoyoFit (watch-fit) src/features/ai/json.ts, adapted for JoyoRogo.
/** The one object guard of Joyo AI: narrows to a plain object (not an array, not null); its fields stay `unknown` and are checked where they are read. */
export type Json = Record<string, unknown>;

export const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
