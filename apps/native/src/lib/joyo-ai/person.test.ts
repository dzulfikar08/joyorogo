import { describe, expect, test } from "bun:test";

import { ageFromBirthYear, personFromProfile, UNKNOWN_PERSON } from "./person";

describe("person from the profile", () => {
  test("named fields only: the maternal mode, name and email on the row never reach the person", () => {
    const row = {
      birthYear: 1990,
      gender: "female",
      heightCm: 160,
      goal: "maintain",
      maternalMode: "pregnant",
      name: "Siti",
      email: "s@x.id",
      cycleStart: "2026-10-01",
    };
    const person = personFromProfile(row, 2026);
    expect(person).toEqual({ ageYears: 36, sex: "female", heightCm: 160, goal: "maintain" });
    expect(JSON.stringify(person)).not.toMatch(/pregnant|Siti|s@x\.id|cycle/);
  });

  test("no profile, or odd values, are unknown (never zero)", () => {
    expect(personFromProfile(null, 2026)).toEqual(UNKNOWN_PERSON);
    expect(personFromProfile(undefined, 2026)).toEqual(UNKNOWN_PERSON);
    expect(
      personFromProfile({ birthYear: 0, gender: "x", heightCm: -3, goal: "bulk" }, 2026),
    ).toEqual(UNKNOWN_PERSON);
    expect(personFromProfile({ birthYear: Number.NaN, heightCm: Number.NaN }, 2026)).toEqual(
      UNKNOWN_PERSON,
    );
  });

  test("age: this year minus the birth year, and a birth year in the future is unknown", () => {
    expect(ageFromBirthYear(2010, 2026)).toBe(16);
    expect(ageFromBirthYear(2008, 2026)).toBe(18);
    expect(ageFromBirthYear(2030, 2026)).toBeNull();
    expect(ageFromBirthYear(1800, 2026)).toBeNull();
    expect(ageFromBirthYear(null, 2026)).toBeNull();
  });
});
