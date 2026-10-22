// Ported from JoyoFit (watch-fit) src/features/ai/person.ts, adapted for JoyoRogo.
/**
 * Who the chat is talking to, as far as the JoyoRogo profile says. Everything is optional: unknown is null, never a guess.
 * Pregnancy and breastfeeding mode is deliberately NOT here: it is never read for the AI and never sent to a provider.
 * Only what the person types in the chat can switch the conservative prompt block on.
 */

/** Joyo AI is for adults: provider terms set their own age limits and the minor prompt block is a backstop, not a substitute. */
export const MIN_ADULT_AGE = 18;

export interface Person {
  ageYears: number | null;
  sex: 'male' | 'female' | null;
  heightCm: number | null;
  goal: 'lose' | 'maintain' | 'gain' | null;
}
