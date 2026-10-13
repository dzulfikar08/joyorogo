import { describe, expect, test } from "bun:test";

import { exerciseById } from "./exercises";
import { proteinTargetG, shiftDate } from "./engine";
import {
  WORKOUT_TEMPLATES,
  bestSetMetrics,
  estimate1RM,
  missedMuscleWarnings,
  personalRecords,
  sessionKcal,
  sessionPRs,
  strengthTrendHint,
  weeklySetsPerMuscle,
  type WorkoutSessionLike,
} from "./workout";

const TODAY = "2026-10-13";

function set(exerciseId: string, reps = 10, weightKg: number | null = 40) {
  return { exerciseId, reps, weightKg };
}

function session(date: string, sets: WorkoutSessionLike["sets"]): WorkoutSessionLike {
  return { date, sets };
}

describe("sessionKcal", () => {
  test("uses the angkat beban MET over duration and body weight", () => {
    // 5.0 MET x 3.5 x 70 kg x 45 min / 200 = 275.625 -> 276
    expect(sessionKcal(45, 70)).toBe(276);
    expect(sessionKcal(0, 70)).toBe(0);
    expect(sessionKcal(30, 80)).toBe(210);
  });
});

describe("weeklySetsPerMuscle", () => {
  test("primary counts 1 effective set, secondary 0.5", () => {
    const bench = exerciseById("bench_press")!;
    const weekly = weeklySetsPerMuscle(
      [session(TODAY, [set("bench_press"), set("bench_press", 8, 50)])],
      TODAY,
      TODAY,
    );
    expect(weekly.dada).toBe(2);
    expect(weekly.bahu_depan).toBe(1);
    expect(weekly.quadriceps).toBe(0);
    void bench;
  });

  test("sessions outside the window and sub-1-rep sets are ignored", () => {
    const weekly = weeklySetsPerMuscle(
      [
        session("2026-09-01", [set("bench_press")]),
        session(TODAY, [set("squat", 0, 60), set("squat", 5, 60)]),
      ],
      shiftDate(TODAY, -6),
      TODAY,
    );
    expect(weekly.dada).toBe(0);
    // squat: quadriceps AND glutes are both primary -> 1 each; hamstring secondary -> 0.5
    expect(weekly.quadriceps).toBe(1);
    expect(weekly.glutes).toBe(1);
    expect(weekly.hamstring).toBe(0.5);
  });

  test("unknown exercise ids do not crash or count", () => {
    const weekly = weeklySetsPerMuscle(
      [session(TODAY, [set("ghost_press", 10, 30)])],
      TODAY,
      TODAY,
    );
    expect(weekly.dada).toBe(0);
  });
});

describe("missedMuscleWarnings", () => {
  test("no sessions, or a single curious session, warns about nothing", () => {
    expect(missedMuscleWarnings([], TODAY)).toEqual([]);
    const one = [session(shiftDate(TODAY, -3), [set("bench_press", 10, 60)])];
    expect(missedMuscleWarnings(one, TODAY)).toEqual([]);
  });

  test("a muscle untrained for 7+ days gets a warning with suggestions", () => {
    // Two push sessions in the last week: legs never trained.
    const sessions = [
      session(shiftDate(TODAY, -4), [set("bench_press", 10, 60), set("triceps_pushdown", 12, 25)]),
      session(shiftDate(TODAY, -1), [set("overhead_press", 10, 40), set("push_up", 20, null)]),
    ];
    const warnings = missedMuscleWarnings(sessions, TODAY);
    const quads = warnings.find((w) => w.muscle === "quadriceps");
    expect(quads?.kind).toBe("untrained_7d");
    expect(quads?.message).toBe("Quadriceps belum dilatih minggu ini");
    expect(quads?.suggestions.map((s) => s.id)).toContain("squat");
    // Already-trained muscles are not flagged.
    expect(warnings.find((w) => w.muscle === "dada")).toBeUndefined();
  });

  test("training 8+ days ago only (nothing this week) still warns", () => {
    const sessions = [
      session(shiftDate(TODAY, -10), [set("squat", 10, 80)]),
      session(shiftDate(TODAY, -8), [set("squat", 10, 80)]),
    ];
    const warnings = missedMuscleWarnings(sessions, TODAY);
    expect(warnings.find((w) => w.muscle === "quadriceps")?.kind).toBe("untrained_7d");
  });

  test("a trained muscle far below the median gets a low-volume warning", () => {
    const bigDay = [
      set("front_squat", 10, 60),
      set("front_squat", 10, 60),
      set("leg_press", 10, 120),
      set("leg_press", 10, 120),
      set("bench_press", 10, 60),
      set("bench_press", 10, 60),
      set("overhead_press", 10, 40),
      set("overhead_press", 10, 40),
      set("barbell_row", 10, 50),
      set("barbell_row", 10, 50),
      set("lat_pulldown", 10, 45),
      set("lat_pulldown", 10, 45),
    ];
    const sessions = [
      session(shiftDate(TODAY, -2), [...bigDay, set("seated_calf_raise", 15, 30)]),
      session(shiftDate(TODAY, -5), bigDay),
    ];
    const warnings = missedMuscleWarnings(sessions, TODAY);
    const calves = warnings.find((w) => w.muscle === "betis");
    expect(calves?.kind).toBe("low_volume");
    expect(calves?.weeklySets).toBe(1);
    expect(calves?.message).toContain("jauh di bawah otot lain");
  });

  test("low volume needs a real comparison group (4+ trained muscles)", () => {
    const sessions = [
      session(shiftDate(TODAY, -2), [
        set("squat", 10, 80),
        set("leg_press", 10, 120),
        set("standing_calf_raise", 15, 30),
      ]),
      session(shiftDate(TODAY, -4), [set("squat", 10, 80)]),
    ];
    // Only quadriceps + glutes + betis trained: 1 set betis is not "far below" anything yet.
    expect(
      missedMuscleWarnings(sessions, TODAY).find((w) => w.kind === "low_volume"),
    ).toBeUndefined();
  });

  test("suggestions prefer movements the user has done before", () => {
    // Leg press 2-3 weeks ago (in muscle memory, out of this week) -> quads
    // are untrained this week, and the familiar movement leads the suggestions.
    const sessions = [
      session(shiftDate(TODAY, -20), [set("leg_press", 10, 120)]),
      session(shiftDate(TODAY, -18), [set("leg_press", 10, 120)]),
      session(shiftDate(TODAY, -3), [set("bench_press", 10, 60)]),
      session(shiftDate(TODAY, -1), [set("bench_press", 10, 60)]),
    ];
    const warnings = missedMuscleWarnings(sessions, TODAY);
    const quads = warnings.find((w) => w.muscle === "quadriceps")!;
    expect(quads.kind).toBe("untrained_7d");
    expect(quads.suggestions[0]?.id).toBe("leg_press");
  });
});

describe("estimate1RM", () => {
  test("Epley: single equals the weight, more reps add headroom", () => {
    expect(estimate1RM(100, 1)).toBe(100);
    expect(estimate1RM(100, 5)).toBe(116.7); // 100 x (1 + 5/30)
    expect(estimate1RM(60, 12)).toBe(84);
  });

  test("degenerate inputs return 0", () => {
    expect(estimate1RM(0, 5)).toBe(0);
    expect(estimate1RM(50, 0)).toBe(0);
    expect(estimate1RM(-10, 5)).toBe(0);
  });
});

describe("personalRecords", () => {
  test("best e1RM wins even with fewer reps, lastDate and session counts are right", () => {
    const prs = personalRecords([
      session("2026-10-01", [set("bench_press", 10, 60)]), // e1RM 80
      session("2026-10-10", [set("bench_press", 3, 85)]), // e1RM 93.5
      session("2026-10-10", [set("bench_press", 8, 55)]),
    ]);
    expect(prs).toHaveLength(1);
    const pr = prs[0]!;
    expect(pr.exerciseId).toBe("bench_press");
    expect(pr.sessions).toBe(3); // distinct sessions, even on the same day
    expect(pr.lastDate).toBe("2026-10-10");
    expect(pr.best1RM?.e1rm).toBe(93.5);
    expect(pr.best1RM?.reps).toBe(3);
    expect(pr.bestSet?.e1rm).toBe(93.5);
  });

  test("bodyweight-only history tracks reps, with null e1rm", () => {
    const prs = personalRecords([
      session("2026-10-05", [set("pull_up", 8, null)]),
      session("2026-10-09", [set("pull_up", 12, null)]),
    ]);
    const pr = prs[0]!;
    expect(pr.best1RM).toBeNull();
    expect(pr.bestSet?.reps).toBe(12);
    expect(pr.bestSet?.e1rm).toBeNull();
  });

  test("most recently active exercise sorts first", () => {
    const prs = personalRecords([
      session("2026-10-01", [set("squat", 5, 100)]),
      session("2026-10-11", [set("bench_press", 5, 80)]),
    ]);
    expect(prs[0]?.exerciseId).toBe("bench_press");
    expect(prs[1]?.exerciseId).toBe("squat");
  });

  test("zero-rep sets are skipped entirely", () => {
    const prs = personalRecords([session("2026-10-01", [set("squat", 0, 100)])]);
    expect(prs).toEqual([]);
  });
});

describe("strengthTrendHint", () => {
  const build = (recentKg: number, priorKg: number): WorkoutSessionLike[] => [
    session(shiftDate(TODAY, -20), [set("squat", 5, priorKg)]),
    session(shiftDate(TODAY, -2), [set("squat", 5, recentKg)]),
  ];

  test("quiet when weight is not falling fast", () => {
    expect(
      strengthTrendHint(build(80, 100), { today: TODAY, weeklyWeightChangeKg: -0.2 }),
    ).toBeNull();
    expect(
      strengthTrendHint(build(80, 100), { today: TODAY, weeklyWeightChangeKg: null }),
    ).toBeNull();
  });

  test("quiet when strength holds while cutting", () => {
    expect(
      strengthTrendHint(build(100, 100), { today: TODAY, weeklyWeightChangeKg: -0.8 }),
    ).toBeNull();
  });

  test("a 5%+ e1RM drop during a fast cut raises the deficit warning", () => {
    const hint = strengthTrendHint(build(80, 100), { today: TODAY, weeklyWeightChangeKg: -0.9 });
    expect(hint?.exerciseId).toBe("squat");
    expect(hint?.dropPct).toBe(20);
    expect(hint?.message).toContain("defisit terlalu besar");
  });

  test("small drops below 5% stay silent", () => {
    // 95 -> 91 is a 4.2% drop.
    expect(
      strengthTrendHint(build(91, 95), { today: TODAY, weeklyWeightChangeKg: -1.0 }),
    ).toBeNull();
  });

  test("only the prior fortnight counts as the baseline", () => {
    // Strong 30 days ago, current fortnight weak, but the 15-28 day window is empty.
    const sessions = [
      session(shiftDate(TODAY, -35), [set("squat", 5, 100)]),
      session(shiftDate(TODAY, -2), [set("squat", 5, 70)]),
    ];
    expect(strengthTrendHint(sessions, { today: TODAY, weeklyWeightChangeKg: -1.0 })).toBeNull();
  });

  test("picks the lift with the biggest drop", () => {
    const sessions = [
      session(shiftDate(TODAY, -20), [set("squat", 5, 100), set("bench_press", 5, 80)]),
      session(shiftDate(TODAY, -3), [set("squat", 5, 78), set("bench_press", 5, 70)]),
    ];
    const hint = strengthTrendHint(sessions, { today: TODAY, weeklyWeightChangeKg: -0.6 });
    expect(hint?.exerciseId).toBe("squat"); // 22% vs 12.5%
  });
});

describe("WORKOUT_TEMPLATES", () => {
  test("every template references real catalog movements", () => {
    for (const template of WORKOUT_TEMPLATES) {
      expect(template.exercises.length).toBeGreaterThanOrEqual(4);
      for (const item of template.exercises) {
        expect(exerciseById(item.exerciseId)).toBeDefined();
        expect(item.sets).toBeGreaterThanOrEqual(1);
        expect(item.targetReps).toBeGreaterThanOrEqual(1);
      }
    }
  });

  test("template ids are unique", () => {
    const ids = WORKOUT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("protein bump on training days", () => {
  test("training day raises the target from 1.5 to 1.6 g/kg", () => {
    expect(proteinTargetG(60, 170)).toBe(90);
    expect(proteinTargetG(60, 170, true)).toBe(96);
  });

  test("the cap still applies on training days", () => {
    expect(proteinTargetG(130, 170, false)).toBe(108);
    expect(proteinTargetG(130, 170, true)).toBe(115); // 1.6 x 72
  });
});

describe("sessionPRs", () => {
  test("a first-ever exercise earns no PRs", () => {
    expect(sessionPRs([], [set("bench_press", 10, 60)])).toEqual([]);
  });

  test("warmup sets never count, on either side", () => {
    // history of warmups only = never really attempted
    const warmupHistory = [{ sets: [{ ...set("bench_press", 8, 100), setType: "warmup" }] }];
    expect(sessionPRs(warmupHistory, [set("bench_press", 5, 60)])).toEqual([]);
    // a warmup beating an old real record still earns nothing
    const history = [{ sets: [set("bench_press", 5, 60)] }];
    expect(
      sessionPRs(history, [{ ...set("bench_press", 8, 100), setType: "warmup" }]),
    ).toEqual([]);
  });

  test("ties do not beat a record, only strict improvements", () => {
    const prior = [{ sets: [set("bench_press", 5, 100)] }];
    expect(sessionPRs(prior, [set("bench_press", 5, 100)])).toEqual([]);

    const prs = sessionPRs(prior, [set("bench_press", 6, 100)]);
    // same weight: no weight PR; heavier e1RM, more reps, more volume win
    expect(prs.find((pr) => pr.kind === "weight")).toBeUndefined();
    expect(prs).toContainEqual({ exerciseId: "bench_press", kind: "reps", value: 6, previous: 5 });
    expect(prs).toContainEqual({
      exerciseId: "bench_press",
      kind: "one_rm",
      value: 120,
      previous: 116.7,
    });
    expect(prs).toContainEqual({
      exerciseId: "bench_press",
      kind: "set_volume",
      value: 600,
      previous: 500,
    });
  });

  test("each record kind is detected against prior history", () => {
    const prior = [{ sets: [set("bench_press", 8, 80)] }]; // e1RM 101.3, volume 640
    const prs = sessionPRs(prior, [set("bench_press", 3, 95)]);
    expect(prs).toContainEqual({ exerciseId: "bench_press", kind: "weight", value: 95, previous: 80 });
    expect(prs).toContainEqual({
      exerciseId: "bench_press",
      kind: "one_rm",
      value: 104.5,
      previous: 101.3,
    });
    // 3 reps < 8 and 285 kg < 640 kg: those records stand
    expect(prs.find((pr) => pr.kind === "reps")).toBeUndefined();
    expect(prs.find((pr) => pr.kind === "set_volume")).toBeUndefined();
  });

  test("bodyweight exercises track a reps record; first weighted set wins with previous null", () => {
    const prior = [{ sets: [set("push_up", 30, null)] }];
    expect(sessionPRs(prior, [set("push_up", 35, null)])).toEqual([
      { exerciseId: "push_up", kind: "reps", value: 35, previous: 30 },
    ]);
    const weighted = sessionPRs(prior, [set("push_up", 10, 20)]);
    expect(weighted).toContainEqual({ exerciseId: "push_up", kind: "weight", value: 20, previous: null });
  });

  test("timed sets carry no reps and earn nothing", () => {
    const prior = [{ sets: [{ exerciseId: "plank", reps: null, weightKg: null }] }];
    expect(
      sessionPRs(prior, [{ exerciseId: "plank", reps: null, weightKg: null, durationSec: 90 }]),
    ).toEqual([]);
  });

  test("drop and failure sets count like normal sets", () => {
    const prior = [{ sets: [set("squat", 5, 100)] }];
    const prs = sessionPRs(prior, [{ ...set("squat", 5, 110), setType: "failure" }]);
    expect(prs.find((pr) => pr.kind === "weight")?.value).toBe(110);
  });

  test("exercises are grouped in stable id order", () => {
    const prior = [
      { sets: [set("squat", 5, 100)] },
      { sets: [set("bench_press", 5, 60)] },
    ];
    const prs = sessionPRs(prior, [set("squat", 5, 110), set("bench_press", 5, 70)]);
    expect([...new Set(prs.map((pr) => pr.exerciseId))]).toEqual(["bench_press", "squat"]);
  });
});

describe("bestSetMetrics", () => {
  test("best of each kind across counted sets, warmups and timed holds excluded", () => {
    const metrics = bestSetMetrics([
      { setType: "warmup", reps: 10, weightKg: 200 },
      { setType: "normal", reps: 5, weightKg: 100 },
      { setType: "normal", reps: 12, weightKg: 60 },
      { setType: "normal", reps: null, weightKg: null },
    ]);
    expect(metrics.weightKg).toBe(100);
    expect(metrics.reps).toBe(12);
    expect(metrics.setVolume).toBe(720);
    expect(metrics.oneRm).toBe(estimate1RM(100, 5));
  });

  test("all nulls for an empty or warmup-only history", () => {
    expect(bestSetMetrics([]).weightKg).toBeNull();
    expect(bestSetMetrics([{ setType: "warmup", reps: 10, weightKg: 100 }]).reps).toBeNull();
  });
});
