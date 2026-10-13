import { describe, expect, test } from "bun:test";

import {
  EQUIPMENT,
  EXERCISE_CATALOG,
  EXERCISE_TYPES,
  MUSCLES,
  exerciseById,
  exercisesForMuscle,
} from "./exercises";

describe("EXERCISE_CATALOG", () => {
  test("size stays in the 50-70 roadmap band", () => {
    expect(EXERCISE_CATALOG.length).toBeGreaterThanOrEqual(50);
    expect(EXERCISE_CATALOG.length).toBeLessThanOrEqual(70);
  });

  test("ids are unique", () => {
    const ids = EXERCISE_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("muscle and equipment keys all resolve to the fixed lists", () => {
    const muscleKeys = new Set(MUSCLES.map((m) => m.key));
    const equipmentKeys = new Set(EQUIPMENT.map((e) => e.key));
    for (const exercise of EXERCISE_CATALOG) {
      expect(equipmentKeys.has(exercise.equipment)).toBe(true);
      expect(exercise.primary.length).toBeGreaterThanOrEqual(1);
      for (const muscle of [...exercise.primary, ...exercise.secondary]) {
        expect(muscleKeys.has(muscle)).toBe(true);
      }
    }
  });

  test("primary and secondary never overlap on one exercise", () => {
    for (const exercise of EXERCISE_CATALOG) {
      for (const muscle of exercise.secondary) {
        expect(exercise.primary).not.toContain(muscle);
      }
    }
  });

  test("every muscle has at least one primary exercise", () => {
    for (const muscle of MUSCLES) {
      const primary = EXERCISE_CATALOG.filter((e) => e.primary.includes(muscle.key));
      expect(primary.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("exerciseById", () => {
  test("resolves a stable id and returns undefined for unknown", () => {
    expect(exerciseById("bench_press")?.name).toBe("Bench press");
    expect(exerciseById("nope_404")).toBeUndefined();
  });
});

describe("catalog metadata", () => {
  test("every entry carries its primary muscle and logging type", () => {
    for (const exercise of EXERCISE_CATALOG) {
      expect(exercise.muscle).toBe(exercise.primary[0]!);
      expect(EXERCISE_TYPES).toContain(exercise.type);
    }
  });

  test("weighted equipment logs weight_reps, bodyweight reps, holds log duration", () => {
    expect(exerciseById("bench_press")?.type).toBe("weight_reps");
    expect(exerciseById("push_up")?.type).toBe("bodyweight_reps");
    for (const id of ["plank", "side_plank", "wall_sit", "dead_hang"]) {
      expect(exerciseById(id)?.type).toBe("duration");
    }
  });
});

describe("exercisesForMuscle", () => {
  test("primary movers come before secondary-only movements", () => {
    const list = exercisesForMuscle("triceps");
    expect(list[0]?.primary).toContain("triceps");
    const firstSecondary = list.findIndex((e) => !e.primary.includes("triceps"));
    if (firstSecondary >= 0) {
      expect(list[firstSecondary]?.secondary).toContain("triceps");
      expect(list.slice(firstSecondary).every((e) => !e.primary.includes("triceps"))).toBe(true);
    }
  });

  test("only returns movements that train the muscle", () => {
    for (const e of exercisesForMuscle("betis")) {
      expect(e.primary.includes("betis") || e.secondary.includes("betis")).toBe(true);
    }
  });
});
