import type { Person } from "@joyorogo/api/lib/joyo-ai/person";

/** The four profile columns Joyo AI may read. Pregnancy and breastfeeding mode, name, email and the rest are never read for it. */
export interface ProfileFields {
  birthYear?: number | null;
  gender?: string | null;
  heightCm?: number | null;
  goal?: string | null;
}

export const UNKNOWN_PERSON: Person = { ageYears: null, sex: null, heightCm: null, goal: null };

/** Age as the server counts it (this year minus the birth year); a missing or impossible year is unknown, never a guess. */
export const ageFromBirthYear = (
  birthYear: number | null | undefined,
  nowYear: number,
): number | null =>
  typeof birthYear === "number" &&
  Number.isFinite(birthYear) &&
  birthYear > 1900 &&
  birthYear <= nowYear
    ? nowYear - birthYear
    : null;

/** The person from named profile fields only (no spreading of the profile row). No profile = everything unknown. */
export function personFromProfile(
  profile: ProfileFields | null | undefined,
  nowYear: number,
): Person {
  if (!profile) return UNKNOWN_PERSON;
  const goal = profile.goal;
  return {
    ageYears: ageFromBirthYear(profile.birthYear, nowYear),
    sex: profile.gender === "male" || profile.gender === "female" ? profile.gender : null,
    heightCm:
      typeof profile.heightCm === "number" &&
      Number.isFinite(profile.heightCm) &&
      profile.heightCm > 0
        ? profile.heightCm
        : null,
    goal: goal === "lose" || goal === "maintain" || goal === "gain" ? goal : null,
  };
}
