// A made-up Huawei Privacy Centre export in the real layout (health detail, sport per minute, motion path incl. one broken and one
// unrecoverable record, sample sequence, `SportsHealth-Data.xls`), with what converting it must give. Used by the converter test and by
// `scripts/huawei-sample.ts`, which writes the sample import file the phone side is tried with. Nothing here is real health data.

import { BlobWriter, configure, TextReader, Uint8ArrayReader, ZipWriter } from "@zip.js/zip.js";

configure({ useWebWorkers: false });

/** 2025-06-15 00:00 in +0700, ms. */
export const BASE_MS = Date.UTC(2025, 5, 14, 17, 0, 0);
const MIN = 60_000;
const HOUR = 3_600_000;

export const HEALTH_FILE = "Health detail data & description/Health detail data1.json";
export const SPORT_FILE = "Sport per minute merged data & description/Sport per minute1.json";
export const MOTION_FILE = "Motion path detail data & description/Motion path detail data1.json";
export const SEQUENCE_FILE = "Sample sequence data & description/Sample sequence data1.json";
export const SPORTS_HEALTH_FILE = "SportsHealth data & desciption/SportsHealth-Data.xls";
export const IGNORED_FILE = "User run plan data & description/user run plan data.json";

export interface SyntheticOptions {
  /** Distinct minutes of heart rate; above 20 000 the minutes go out in more than one batch. */
  heartRateMinutes?: number;
  /** The bytes of `SportsHealth-Data.xls` (four day totals: see fixtures/sports-health-synthetic.xls). */
  sportsHealthXls: Uint8Array;
}

export interface ExpectedWorkout {
  start: number;
  sportType: number;
  sportName: string;
  distance: number;
  calories: number;
  avgHr: number | null;
  maxHr: number | null;
  points: number;
}

export interface ExpectedExport {
  /** Rows per batch kind, as the import file carries them (`workout` lines and their points). */
  rows: Record<string, number>;
  /** Size of each `minutes` batch, in order. */
  minuteBatches: number[];
  workouts: ExpectedWorkout[];
  summary: Record<string, number>;
  profile: { heightCm: number; weightKg: number; sex: "male"; birthYear: number };
  /** The `t` of every line after the header, up to and including `end`, in file order. */
  lineKinds: string[];
  oldestSec: number;
  newestSec: number;
}

export interface SyntheticExport {
  files: Record<string, string | Uint8Array>;
  expected: ExpectedExport;
}

const sample = (key: string, startMs: number, endMs: number, value: string) =>
  `{"key":"${key}","startTime":${startMs},"endTime":${endMs},"unit":"0","value":${JSON.stringify(value)}}`;

const healthRecord = (id: string, points: string[]) =>
  `{"type":7,"startTime":${BASE_MS},"endTime":${BASE_MS + 86_400_000},"timeZone":"+0700","deviceCode":1,"recordId":"${id}","samplePoints":[${points.join(",")}]}`;

export function buildSyntheticExport(options: SyntheticOptions): SyntheticExport {
  const hrMinutes = options.heartRateMinutes ?? 90;
  const hrStart = BASE_MS + 9 * HOUR;

  // --- Health detail: everything that is not a heart rate in the first record (so it goes out with the first batch), heart rate in
  // records of 1000 points.
  const first: string[] = [];
  const stages: [key: string, offset: number, length: number][] = [
    ["PROFESSIONAL_SLEEP_SHALLOW", 0, HOUR],
    ["PROFESSIONAL_SLEEP_DEEP", HOUR, HOUR],
    ["PROFESSIONAL_SLEEP_DREAM", 2 * HOUR, HOUR],
    ["PROFESSIONAL_SLEEP_WAKE", 3 * HOUR, 5 * MIN],
  ];
  for (const [key, offset, length] of stages)
    first.push(sample(key, BASE_MS + offset, BASE_MS + offset + length, ""));
  first.push(sample("STRESS_DATA", BASE_MS + 4 * HOUR, BASE_MS + 4 * HOUR, '{"score":20}'));
  first.push(sample("STRESS", BASE_MS + 4 * HOUR, BASE_MS + 4 * HOUR, '{"stressScore":20}')); // the same reading under the other key
  first.push(
    sample(
      "STRESS_DATA",
      BASE_MS + 4 * HOUR + 30 * MIN,
      BASE_MS + 4 * HOUR + 30 * MIN,
      '{"score":35}',
    ),
  );
  first.push(sample("STRESS_DATA", BASE_MS + 5 * HOUR, BASE_MS + 5 * HOUR, '{"score":50}'));
  first.push(
    sample(
      "HEART_RATE_VARIABILITY",
      BASE_MS + 5 * HOUR,
      BASE_MS + 5 * HOUR,
      '{"heartRateVariabilityRMSSD":55}',
    ),
  );
  first.push(
    sample(
      "WEIGHT_BODYFAT_BROAD",
      BASE_MS + 7 * HOUR,
      BASE_MS + 7 * HOUR,
      '{"age":33,"bodyWeight":71.5,"bodyFatRate":0.213,"gender":1,"height":170,"bmi":24.7}',
    ),
  );
  first.push(
    sample("USER_HEIGHT", BASE_MS + 7 * HOUR + MIN, BASE_MS + 7 * HOUR + MIN, '{"userHeight":172}'),
  );
  first.push(
    sample(
      "NUTRITION_RECORD",
      BASE_MS,
      BASE_MS,
      `{"dietaryEnergy":584,"protein":12.5,"carbohydrates":50,"fat":8,"meal":20,"mealEatTime":${BASE_MS / 1000 + 12 * 3600},"mealRecordTime":${BASE_MS / 1000 + 12 * 3600 + 60}}`,
    ),
  );
  first.push(sample("DRINK_WATER", BASE_MS + 8 * HOUR, BASE_MS + 8 * HOUR, '{"drinkWater":250}'));
  first.push(sample("DRINK_WATER", BASE_MS + 9 * HOUR, BASE_MS + 9 * HOUR, '{"drinkWater":500}'));
  first.push(sample("DRINK_WATER", BASE_MS + 30 * HOUR, BASE_MS + 30 * HOUR, '{"drinkWater":250}'));
  first.push(sample("EXERCISE_INTENSITY", BASE_MS + 2 * HOUR, BASE_MS + 2 * HOUR, "3"));
  first.push(sample("EXERCISE_INTENSITY", BASE_MS + 3 * HOUR, BASE_MS + 3 * HOUR, "2"));
  const spo2Count = Math.ceil(hrMinutes / 30);
  first.push(
    sample("DATA_POINT_REST_HEARTRATE", hrStart + 1_000, hrStart + 1_000 + 86_400_000, "58"),
  );

  const records: string[] = [];
  let hrPoints: string[] = [];
  const closeRecord = () => {
    const id = `rec-${records.length}`;
    records.push(healthRecord(id, records.length === 0 ? [...first, ...hrPoints] : hrPoints));
    hrPoints = [];
  };
  for (let i = 0; i < hrMinutes; i++) {
    const at = hrStart + i * MIN + 5_000;
    hrPoints.push(sample("DATA_POINT_DYNAMIC_HEARTRATE", at, at, String(60 + (i % 40))));
    // The export writes most readings twice under two types: the second reading of a minute is not one more.
    // SpO2 every 30 minutes, in the record of its own minute.
    if (i % 30 === 0)
      hrPoints.push(
        sample("BLOOD_OXYGEN_SATURATION", at + 5_000, at + 5_000, '{"avgSaturation":96}'),
      );
    if (i < 10)
      hrPoints.push(sample("DYNAMIC_HEART_RATE", at + 20_000, at + 20_000, `{"bpm":${90 + i}}`));
    if ((i + 1) % 1000 === 0) closeRecord();
  }
  if (hrPoints.length > 0 || records.length === 0) closeRecord();
  // A record that is not JSON in any dialect, in the middle of the file.
  const healthText = `[${[records[0], '{"samplePoints": }', ...records.slice(1)].join(",\n")}]`;

  // --- Sport per minute: 30 of the same minutes, in a file of their own (so another batch).
  const stepMinutes = 30;
  const infos = Array.from(
    { length: stepMinutes },
    (_, i) => `{"steps":${20 + i},"distance":15,"calorie":3000,"duration":1}`,
  );
  const sportText = `[{"recordDay":20250615,"sportDataUserData":[{"startTime":${hrStart},"endTime":${hrStart + stepMinutes * MIN},"sportType":5,"sportBasicInfos":[${infos.join(",")}]}]}]`;

  // --- Motion path.
  const run1Start = hrStart + 2 * HOUR;
  const sec = (ms: number) => ms / 1000;
  const run1Track = [
    "HW_EXT_TRACK_DETAIL@is",
    `tp=lbs;k=0;lat=-6.2000000;lon=106.8000000;alt=0.0;t=${sec(run1Start)}.0;`,
    `tp=lbs;k=1;lat=-6.2001000;lon=106.8001000;alt=7.5;t=${sec(run1Start) + 1}.0;`,
    `tp=lbs;k=2;lat=-6.2002000;lon=106.8002000;alt=8.0;t=${sec(run1Start) + 2}.0;`,
    `tp=lbs;k=3;lat=90.0;lon=-80.0;alt=0.0;t=${sec(run1Start) + 3}.0;`,
    `tp=lbs;k=4;lat=-6.2010000;lon=106.8010000;alt=9.0;t=${sec(run1Start) + 20}.0;`,
    `tp=lbs;k=5;lat=-6.2011000;lon=106.8011000;alt=9.5;t=${sec(run1Start) + 21}.0;`,
    `tp=h-r;k=${run1Start + 10_000};v=120;`,
    `tp=h-r;k=${run1Start + 20_000};v=125;`,
    `tp=h-r;k=${run1Start + 30_000};v=130;`,
    `tp=h-r;k=${run1Start + 40_000};v=135;`,
    `tp=alti;k=${run1Start + 10_000};v=12.5;`,
    `tp=alti;k=${run1Start + 30_000};v=18.0;`,
    `tp=s-r;k=${run1Start + 10_000};v=160;`,
    "tp=rs;k=0;v=-1;",
    "tp=rs;k=5;v=25;",
    "tp=p-m;k=1;v=300;",
  ].join("\n");
  const run1 = JSON.stringify({
    appType: 1,
    startTime: run1Start,
    endTime: run1Start + 700_000,
    subType: 4,
    timeZone: "+0700",
    type: 30001,
    summaryData: JSON.stringify({
      avgHeartRate: 101,
      maxHeartRate: 120,
      totalCalories: 285_000,
      totalDistance: 2500,
      totalSteps: 3243,
      totalTime: 600_000,
      sportType: 258,
      creepingWave: 120.0,
    }),
    detailData: `${run1Track}\n`,
  });
  const rideStart = hrStart + 5 * HOUR;
  const ride = JSON.stringify({
    abnormalTrack: "",
    sportType: 3,
    startTime: rideStart,
    endTime: rideStart + 1_800_000,
    timeZone: "+0700",
    totalSteps: 0,
    totalDistance: 8000,
    totalCalories: 250_000,
    totalTime: 1_700_000,
    attribute: [
      "HW_EXT_TRACK_DETAIL@is",
      `tp=lbs;k=0;lat=-6.3;lon=106.9;alt=0.0;t=${sec(rideStart)}.0;`,
      `tp=lbs;k=1;lat=-6.3001;lon=106.9001;alt=5.0;t=${sec(rideStart) + 1}.0;`,
      `tp=lbs;k=2;lat=-6.3002;lon=106.9002;alt=5.5;t=${sec(rideStart) + 2}.0;`,
      `tp=h-r;k=${rideStart + 5_000};v=140;`,
      `tp=h-r;k=${rideStart + 15_000};v=150;`,
      "",
    ].join("\n"),
  });
  const strengthStart = hrStart + 7 * HOUR;
  // Valid braces and quotes (so the splitter keeps it whole) but not JSON: `"junk": ,`. Read off the raw text instead.
  const strength =
    `{"appType":1,"startTime":${strengthStart},"endTime":${strengthStart + 900_000},"subType":117,"timeZone":"+0700","junk": ,"type":30001,` +
    `"summaryData":"{\\"avgHeartRate\\":110,\\"maxHeartRate\\":131,\\"totalCalories\\":120000,\\"totalDistance\\":0,\\"totalSteps\\":0,\\"totalTime\\":850000}",` +
    `"detailData":"tp=h-r;k=${strengthStart + 10_000};v=100;\\ntp=h-r;k=${strengthStart + 20_000};v=110;\\n"}`;
  const motionText = `[${[run1, ride, '{"foo": }', strength].join(",\n")}]`;

  // --- Sample sequence.
  const sequenceText = `[{"type":"700013","startTime":"${BASE_MS}","endTime":"${BASE_MS + 8 * HOUR}","summaryData":"{\\"sleepScore\\":85,\\"sleepEfficiency\\":97}"},{"type":"700021","startTime":"${BASE_MS}","endTime":"${BASE_MS + MIN}","summaryData":""}]`;

  const files: Record<string, string | Uint8Array> = {
    [HEALTH_FILE]: healthText,
    [SPORT_FILE]: sportText,
    [MOTION_FILE]: motionText,
    [SEQUENCE_FILE]: sequenceText,
    [SPORTS_HEALTH_FILE]: options.sportsHealthXls,
    [IGNORED_FILE]: "[]",
  };

  const workouts: ExpectedWorkout[] = [
    {
      start: sec(run1Start),
      sportType: 1,
      sportName: "Running",
      distance: 2500,
      calories: 285,
      avgHr: 128,
      maxHr: 135,
      points: 5 + 4 + 2 + 1 + 1,
    },
    {
      start: sec(rideStart),
      sportType: 3,
      sportName: "Biking",
      distance: 8000,
      calories: 250,
      avgHr: 145,
      maxHr: 150,
      points: 3 + 2,
    },
    {
      start: sec(strengthStart),
      sportType: 140,
      sportName: "Strength Training",
      distance: 0,
      calories: 120,
      avgHr: 105,
      maxHr: 110,
      points: 2,
    },
  ];
  // The importer checks its buffer after every record of 1000 minutes and flushes at 20 000.
  const minuteBatches: number[] = [];
  for (let left = hrMinutes; left > 0; left -= 20_000) minuteBatches.push(Math.min(left, 20_000));
  minuteBatches.push(stepMinutes);

  const weighTs = BASE_MS + 7 * HOUR;
  const lineKinds: string[] = [];
  minuteBatches.slice(0, -1).forEach((_, i) => {
    lineKinds.push("minutes");
    // Everything but heart rate is in the first record, so the first flush carries it.
    if (i === 0) lineKinds.push("sleep", "metrics", "queue", "weighIns");
  });
  lineKinds.push("minutes"); // the sport file
  lineKinds.push("workout", "workout", "workout"); // motion
  lineKinds.push("sleepScores", "dayTotals", "queue", "end");

  const rows = {
    minutes: hrMinutes + stepMinutes,
    sleep: 4,
    metrics: 4,
    sleepScores: 1,
    queue: 1 + 2,
    weighIns: 1,
    dayTotals: 4,
    workout: workouts.length,
    workoutPoints: workouts.reduce((n, w) => n + w.points, 0),
  };
  return {
    files,
    expected: {
      rows,
      minuteBatches,
      workouts,
      summary: {
        filesRead: 5,
        filesFailed: 0,
        filesIgnored: 1,
        badRecords: 2,
        heartRateReadings: hrMinutes,
        restingHeartRateReadings: 1,
        spo2Readings: spo2Count,
        stressReadings: 3,
        metricsFound: 1,
        sleepSegmentsFound: 4,
        sleepScoresFound: 1,
        dayTotalsFound: 4,
        mealsFound: 1,
        waterDaysFound: 2,
        weighInsFound: 1,
        workoutsFound: 3,
        unmappedSamples: 3,
        // The two days of the .xls that cannot be read (900 000 steps, no JSON).
        rejectedSamples: 2,
      },
      profile: {
        heightCm: 172,
        weightKg: 71.5,
        sex: "male",
        birthYear: new Date(weighTs).getUTCFullYear() - 33,
      },
      lineKinds,
      // The first and last day total of the .xls, at noon in +0700.
      oldestSec: Date.UTC(2025, 5, 14, 5) / 1000,
      newestSec: Math.max(
        Date.UTC(2025, 5, 19, 5) / 1000,
        hrStart / 1000 + (hrMinutes - 1) * 60 + 5 + (hrMinutes <= 10 ? 20 : 0),
      ),
    },
  };
}

/** The export as a ZIP, every member AES-256 encrypted with `password`, as the Privacy Centre writes it. */
export async function zipExport(
  files: Record<string, string | Uint8Array>,
  password: string,
): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter("application/zip"), {
    password,
    encryptionStrength: 3,
  });
  for (const [name, content] of Object.entries(files)) {
    await writer.add(
      name,
      typeof content === "string" ? new TextReader(content) : new Uint8ArrayReader(content),
    );
  }
  return writer.close();
}
