// Pure helpers for the group (tim) router — kept testable without a DB.

/** A-Z minus I/L/O (easy to confuse) plus 2-9 minus 0/1. */
export const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const INVITE_CODE_LENGTH = 8;

export function newInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(INVITE_CODE_LENGTH));
  return Array.from(bytes, (b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join("");
}

/** Join input is forgiving: case-insensitive, separators/typos of I→1 dropped. */
export function normalizeInviteCode(code: string): string {
  const cleaned = code.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/[ILO01]/g, "");
  return cleaned.slice(0, INVITE_CODE_LENGTH);
}

/** 'kosong' when nothing logged, 'aman' at/below target, 'offside' above. */
export function varVerdict(
  eatenKcal: number,
  eatTargetKcal: number | null,
  mealsLogged: number,
): "aman" | "offside" | "kosong" {
  if (mealsLogged === 0 || eatenKcal === 0) return "kosong";
  if (eatTargetKcal === null) return eatenKcal > 0 ? "offside" : "kosong";
  return eatenKcal <= eatTargetKcal ? "aman" : "offside";
}

/** True while `lastAt` is inside `windowMs` of `now` (poke throttle). */
export function rateLimited(lastAt: number | null, now: number, windowMs: number): boolean {
  return lastAt !== null && now - lastAt < windowMs;
}
