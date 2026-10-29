// Port of HuaweiExportParsersTest.kt and HuaweiExportJsonTest.kt (joyofit repo, modules/huawei-wear). Synthetic fixtures only: made-up
// values in the layout the community converters describe.

import { describe, expect, test } from "bun:test";

import { slot, MEAL_NAME } from "./diary";
import { parseHealthDetail, parseSportPerMinute } from "./health-detail";
import { javaDouble, parseJavaDouble, roundToInt } from "./java";
import { embeddedObject, epochMs, number, parseObject, readLenient, RecordSplitter } from "./json";
import type { JObject } from "./json";
import type {
  Collector,
  ImportedDayTotal,
  ImportedMeal,
  ImportedMetric,
  ImportedSleep,
  ImportedSleepScore,
  ImportedWeighIn,
} from "./model";
import { build, elevationChange, fromBrokenText, fromJson, kcal } from "./motion-path";
import type { RawMotionPath } from "./motion-path";
import { parseSampleSequence } from "./sample-sequence";
import { exportSportName, joyofitType, OTHER } from "./sports";
import { isWeightKey } from "./weight";

/** Everything the parsers hand over, in order. */
interface Recorder {
  heartRateReadings: [number, number][];
  resting: [number, number][];
  spo2Readings: [number, number][];
  sleep: ImportedSleep[];
  metrics: ImportedMetric[];
  sleepScores: ImportedSleepScore[];
  dayTotals: ImportedDayTotal[];
  steps: number[][];
  unmappedKeys: string[];
  weighIns: ImportedWeighIn[];
  meals: ImportedMeal[];
  water: [string, number, string][];
  facts: [string, number, number][];
  rejectedKeys: [string, string, string | null][];
  rejected: number;
  collector: Collector;
}

function newRecorder(): Recorder {
  const out: Recorder = {
    heartRateReadings: [],
    resting: [],
    spo2Readings: [],
    sleep: [],
    metrics: [],
    sleepScores: [],
    dayTotals: [],
    steps: [],
    unmappedKeys: [],
    weighIns: [],
    meals: [],
    water: [],
    facts: [],
    rejectedKeys: [],
    get rejected() {
      return this.rejectedKeys.length;
    },
    collector: {
      heartRate: (ts, bpm) => out.heartRateReadings.push([ts, bpm]),
      restingHeartRate: (ts, bpm) => out.resting.push([ts, bpm]),
      spo2: (ts, percent) => out.spo2Readings.push([ts, percent]),
      sleep: (segment) => out.sleep.push(segment),
      metric: (point) => out.metrics.push(point),
      sleepScore: (score) => out.sleepScores.push(score),
      dayTotal: (total) => out.dayTotals.push(total),
      steps: (minuteSec, steps, distance, calories) =>
        out.steps.push([minuteSec, steps, distance, calories]),
      weighIn: (w) => out.weighIns.push(w),
      meal: (m) => out.meals.push(m),
      water: (date, ml, key) => out.water.push([date, ml, key]),
      profileFact: (kind, value, tsMs) => out.facts.push([kind, value, tsMs]),
      unmapped: (key) => out.unmappedKeys.push(key),
      rejected: (key, reason, sample) => out.rejectedKeys.push([key, reason, sample]),
    },
  };
  return out;
}

function broken(text: string): RawMotionPath {
  const raw = fromBrokenText(text);
  if (!raw) throw new Error("expected the text to be readable");
  return raw;
}

function parse(record: JObject, out: Recorder) {
  parseHealthDetail(record, out.collector);
}

const t0 = 1_750_000_020_000; // a whole minute

const point = (key: string, startMs: number, endMs: number, value: string) =>
  `{"key":"${key}","startTime":${startMs},"endTime":${endMs},"unit":"0","value":${JSON.stringify(value)}}`;

const healthRecord = (...points: string[]): JObject =>
  JSON.parse(
    `{"type":7,"startTime":${t0},"endTime":${t0 + 60_000},"timeZone":"+0700","deviceCode":1,"recordId":"r","samplePoints":[${points.join(",")}]}`,
  );

describe("health detail", () => {
  test("heart rate, resting and SpO2 are mapped by key", () => {
    const out = newRecorder();
    parse(
      healthRecord(
        point("DATA_POINT_DYNAMIC_HEARTRATE", t0 + 5_000, t0 + 5_000, "82.0"),
        point("DATA_POINT_REST_HEARTRATE", t0, t0 + 86_400_000, "58"),
        point("DATA_POINT_NEW_REST_HEARTRATE", t0 + 1000, t0 + 2000, "57.4"),
        point(
          "BLOOD_OXYGEN_SATURATION",
          t0 + 10_000,
          t0 + 10_000,
          '{"avgSaturation":97.0,"maxSaturation":99}',
        ),
        point("BLOOD_OXYGEN_SATURATION", t0 + 70_000, t0 + 70_000, "96"),
      ),
      out,
    );
    expect(out.heartRateReadings).toEqual([[1_750_000_025, 82]]);
    expect(out.resting).toEqual([
      [1_750_000_020, 58],
      [1_750_000_021, 57],
    ]);
    expect(out.spo2Readings).toEqual([
      [1_750_000_030, 97],
      [1_750_000_090, 96],
    ]);
    expect(out.rejected).toBe(0);
  });

  test("implausible values are rejected, not stored, and say why", () => {
    const out = newRecorder();
    parse(
      healthRecord(
        point("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "0"),
        point("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "400"),
        point("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "n/a"),
        point("BLOOD_OXYGEN_SATURATION", t0, t0, "{}"),
        point("STRESS_DATA", t0, t0, '{"score":0}'),
      ),
      out,
    );
    expect(out.heartRateReadings).toEqual([]);
    expect(out.spo2Readings).toEqual([]);
    expect(out.metrics).toEqual([]);
    expect(out.rejectedKeys).toEqual([
      ["DATA_POINT_DYNAMIC_HEARTRATE", "out-of-range", "0"],
      ["DATA_POINT_DYNAMIC_HEARTRATE", "out-of-range", "400"],
      ["DATA_POINT_DYNAMIC_HEARTRATE", "no-number", "n/a"],
      ["BLOOD_OXYGEN_SATURATION", "no-number", "{}"],
      ["STRESS_DATA", "out-of-range", "0"],
    ]);
  });

  test("sleep stages become segments with the watch's raw kinds", () => {
    const out = newRecorder();
    const h = 3_600_000;
    parse(
      healthRecord(
        point("PROFESSIONAL_SLEEP_SHALLOW", t0, t0 + h, ""),
        point("PROFESSIONAL_SLEEP_DEEP", t0 + h, t0 + 2 * h, ""),
        point("PROFESSIONAL_SLEEP_DREAM", t0 + 2 * h, t0 + 3 * h, ""),
        point("PROFESSIONAL_SLEEP_WAKE", t0 + 3 * h, t0 + 3 * h + 60_000, ""),
        point("PROFESSIONAL_SLEEP_NOON", t0 + 5 * h, t0 + 6 * h, ""),
        point("PROFESSIONAL_SLEEP_DEEP", t0 + h, t0 + h, ""),
      ),
      out,
    );
    expect(out.sleep.map((s) => s.type)).toEqual([0x06, 0x07, 0x5656, 0x5658, 0x5659]);
    expect(out.sleep.map((s) => s.stage)).toEqual(["light", "deep", "rem", "awake", "light"]);
    expect(out.sleep[0]?.start).toBe(1_750_000_020);
    expect(out.sleep[0]?.end).toBe(1_750_000_020 + 3600);
    // The span with no length is rejected.
    expect(out.rejected).toBe(1);
  });

  test("a stress score comes from the embedded object", () => {
    const out = newRecorder();
    parse(healthRecord(point("STRESS_DATA", t0, t0, '{"score":42,"level":2}')), out);
    expect(out.metrics).toHaveLength(1);
    expect(out.metrics[0]).toMatchObject({ type: "emotion", value: 42, ts: 1_750_000_020 });
  });

  test("other keys are counted as unmapped", () => {
    const out = newRecorder();
    parse(
      healthRecord(
        point("WEIGHT_BODYFAT_BROAD", t0, t0, '{"bodyWeight":70}'),
        point("EXERCISE_INTENSITY", t0, t0, "3"),
      ),
      out,
    );
    expect(out.unmappedKeys).toEqual(["EXERCISE_INTENSITY"]);
    expect(out.weighIns).toHaveLength(1);
  });

  test("sample points fall back to the record times", () => {
    const out = newRecorder();
    parse(
      JSON.parse(
        `{"startTime":${t0},"endTime":${t0 + 1000},"samplePoints":[{"key":"DATA_POINT_DYNAMIC_HEARTRATE","value":"70"}]}`,
      ),
      out,
    );
    expect(out.heartRateReadings).toEqual([[1_750_000_020, 70]]);
  });

  test("blood oxygen takes either generation's field and heart rate either type", () => {
    const out = newRecorder();
    parse(
      healthRecord(
        point("BLOOD_OXYGEN_SATURATION", t0, t0, '{"avgSaturation":97}'),
        point("BLOOD_OXYGEN_SATURATION", t0, t0, '{"spo2":96}'),
        point("DYNAMIC_HEART_RATE", t0, t0, '{"bpm":77}'),
        point("RESTING_HEART_RATE", t0, t0, '{"restBpm":56}'),
        point("RESTING_HEART_RATE", t0, t0, '{"oldRestBpm":60}'),
      ),
      out,
    );
    expect(out.spo2Readings).toEqual([
      [1_750_000_020, 97],
      [1_750_000_020, 96],
    ]);
    expect(out.heartRateReadings).toEqual([[1_750_000_020, 77]]);
    expect(out.resting).toEqual([
      [1_750_000_020, 56],
      [1_750_000_020, 60],
    ]);
    expect(out.rejected).toBe(0);
  });

  test("HRV, apnea, skin temperature and other metrics become health metrics", () => {
    const out = newRecorder();
    parse(
      healthRecord(
        point("HEART_RATE_VARIABILITY", t0, t0, '{"heartRateVariabilityRMSSD":55}'),
        point("OBSTRUCTIVE_SLEEP_APNEA", t0, t0, '{"osaLevel":1}'),
        point("SKIN_TEMPERATURE", t0, t0, '{"skinTemperature":34.3}'),
        point(
          "VASCULAR_HEALTH",
          t0,
          t0,
          '{"activityRecord":42,"pulseWaveVelocity":7.1,"vascularPulse":80}',
        ),
        point("ARRHYTHMIA_RESULT", t0, t0, '{"measureType":1,"ppgIrregularHeartbeat":1}'),
        point("STRESS", t0, t0, '{"stressScore":42}'),
        point("EMOTION", t0, t0, '{"emotionStatus":2}'),
      ),
      out,
    );
    expect(out.metrics.map((m) => [m.type, m.value])).toEqual([
      ["hrv", 55],
      ["sleep_apnea", 1],
      ["skin_temperature", 34.3],
      ["arterial_stiffness", 7.1],
      ["arrhythmia", 1],
      ["emotion", 42],
    ]);
    expect(out.metrics[0]?.json).toBe('{"heartRateVariabilityRMSSD":55,"source":"huawei-export"}');
    expect(out.unmappedKeys).toEqual(["EMOTION"]);
  });
});

describe("sport per minute", () => {
  test("walks the minutes of an entry", () => {
    const out = newRecorder();
    const record = JSON.parse(
      `{"recordDay":20250615,"sportDataUserData":[{"startTime":${t0},"endTime":${t0 + 240_000},"sportType":5,"sportBasicInfos":[
        {"steps":0,"distance":0,"calorie":10,"duration":1},
        {"steps":42,"distance":30,"calorie":9900,"duration":1},
        {"steps":50,"distance":36,"duration":2},
        {"steps":9999,"distance":1,"duration":1},
        {"steps":10,"distance":7,"duration":1}]}]}`,
    );
    parseSportPerMinute(record, out.collector);
    // Minute 0 has only calories (10 cal, kept); minute 1 and 2 are read; the info with duration 2 skips minute 3; 9999 steps is rejected.
    expect(out.steps).toEqual([
      [1_750_000_020, 0, 0, 10],
      [1_750_000_080, 42, 30, 9900],
      [1_750_000_140, 50, 36, 0],
      [1_750_000_320, 10, 7, 0],
    ]);
    expect(out.rejected).toBe(1);
  });
});

// Motion path

const attribute = (...lines: string[]) => `HW_EXT_TRACK_DETAIL@is\n${lines.join("\n")}\n`;

const trackLines = [
  "tp=lbs;k=0;lat=-6.2000000;lon=106.8000000;alt=0.0;t=1.75000002E9;",
  "tp=h-r;k=1750000021000;v=120;",
  "tp=lbs;k=1;lat=-6.2001000;lon=106.8001000;alt=7.5;t=1.750000021E9;",
  "tp=alti;k=1750000021000;v=12.5;",
  "tp=lbs;k=2;lat=90.0;lon=-80.0;alt=0.0;t=1.750000022E9;",
  "tp=lbs;k=3;lat=-6.2010000;lon=106.8010000;alt=8.0;t=1.750000100E9;",
  "tp=h-r;k=1750000100000;v=150;",
  "tp=h-r;k=1750000110000;v=0;",
  "tp=s-r;k=1750000100000;v=160;",
  "tp=p-m;k=1;v=300;",
];

const motionJson = (sportType = 4, totalCalories = 90_000): JObject => ({
  abnormalTrack: "",
  sportType,
  startTime: t0,
  endTime: t0 + 600_000,
  timeZone: "+0700",
  totalSteps: 1200,
  totalDistance: 1500,
  totalCalories,
  totalTime: 540_000,
  attribute: attribute(...trackLines),
});

describe("motion path", () => {
  test("becomes a workout with route, heart rate and altitude", () => {
    const workout = build(fromJson(motionJson()));
    expect(workout).not.toBeNull();
    if (!workout) return;
    expect(workout.start).toBe(1_750_000_020);
    expect(workout.end).toBe(1_750_000_620);
    expect(workout.duration).toBe(600);
    expect(workout.sportType).toBe(1);
    expect(workout.sportName).toBe("Running");
    expect(workout.distance).toBe(1500);
    expect(workout.calories).toBe(90);
    expect(workout.steps).toBe(1200);
    // The reading of 0 bpm is dropped.
    expect(workout.avgHr).toBe(135);
    expect(workout.maxHr).toBe(150);

    const gps = workout.points.filter((p) => p.lat !== null);
    // The pause marker is not a point; its neighbours are.
    expect(gps).toHaveLength(3);
    expect(gps[0]?.alt).toBeNull(); // alt=0.0 means "none"
    expect(gps[1]?.alt).toBe(7.5);
    expect(workout.points.filter((p) => p.hr !== null)).toHaveLength(2);
    expect(workout.points.filter((p) => p.lat === null && p.alt !== null)).toHaveLength(1);
    // tp=s-r is cadence in steps per minute at its own timestamp; tp=p-m (a per-km pace summary) is not a point.
    const cadence = workout.points.filter((p) => p.cadence !== null);
    expect(cadence).toHaveLength(1);
    expect(cadence[0]?.ts).toBe(1_750_000_100);
    expect(cadence[0]?.cadence).toBe(160);
    expect(
      workout.points.every((p) => p.speed === null && p.stride === null && p.power === null),
    ).toBe(true);
    const times = workout.points.map((p) => p.ts);
    expect(times).toEqual([...times].sort((a, b) => a - b));

    const summary = JSON.parse(workout.summaryJson);
    expect(summary.kind).toBe("RUNNING");
    expect(summary.gps).toBe("ok");
    expect(summary.gpsPoints).toBe(3);
    expect(summary.source).toBe("huawei-export");
    expect(summary.huaweiSportType).toBe(4);
    expect(summary.movingTimeSec).toBe(540);
    expect(summary.avgSpeed).toBeCloseTo(1500 / 600, 9);
    expect(summary.avgPaceSecPerKm).toBeCloseTo(1000 / (1500 / 600), 6);
  });

  test("sport ids outside the known table stay unnamed workouts", () => {
    expect(joyofitType(3)).toBe(3);
    expect(joyofitType(5)).toBe(2);
    expect(exportSportName(3)).toBe("Biking");
    const workout = build(fromJson(motionJson(77)));
    expect(workout?.sportType).toBe(OTHER);
    expect(workout?.sportName).toBe("Workout (Huawei type 77)");
    expect(JSON.parse(workout?.summaryJson ?? "{}").huaweiSportType).toBe(77);
  });

  test("calories in small calories are scaled down", () => {
    expect(kcal(90_000)).toBe(90);
    expect(kcal(285_000)).toBe(285);
    expect(kcal(0)).toBe(0);
    expect(kcal(null)).toBe(0);
  });

  test("distance falls back to the track and skips pauses", () => {
    const json = motionJson();
    json.totalDistance = 0;
    const workout = build(fromJson(json));
    // First two fixes are ~15.7 m apart; the third follows a pause and starts a new segment.
    expect(workout?.distance).toBeGreaterThanOrEqual(14);
    expect(workout?.distance).toBeLessThanOrEqual(18);
  });

  test("a workout without any time is not imported", () => {
    expect(build(fromJson({ sportType: 4, attribute: "" }))).toBeNull();
  });

  test("total time in seconds is recognised too", () => {
    const json = motionJson();
    json.totalTime = 540;
    expect(JSON.parse(build(fromJson(json))?.summaryJson ?? "{}").movingTimeSec).toBe(540);
  });

  test("broken motion text is read straight off the raw text", () => {
    // A stray quote in the attribute makes this invalid JSON; the line records are still readable.
    const raw =
      `{"abnormalTrack":"","sportType":4,"startTime":${t0},"endTime":${t0 + 600_000},"totalDistance":1500,"totalCalories":90,` +
      `"partTimeMap":{1.0:439.0},"attribute":"HW_EXT_TRACK_DETAIL@is\\ntp=lbs;k=0;lat=-6.2;lon=106.8;alt=0.0;t=1.75000002E9;\\n` +
      `tp=h-r;k=1750000021000;v=120;\\n"stray";\\n"}`;
    expect(parseObject(raw)).toBeNull();
    const workout = build(broken(raw));
    expect(workout).not.toBeNull();
    expect(workout?.sportType).toBe(1);
    expect(workout?.distance).toBe(1500);
    expect(workout?.points.filter((p) => p.lat !== null)).toHaveLength(1);
    expect(workout?.avgHr).toBe(120);
    expect(workout?.points.length).toBeGreaterThan(0);
  });

  test("elevation change ignores noise", () => {
    const [gain, loss] = elevationChange([10, 11, 9.5, 14, 20, 15, 15.5]);
    expect(gain).toBeCloseTo(10, 9);
    expect(loss).toBeCloseTo(5, 9);
  });

  // The layout of a real export (Oct 2026): summaryData / detailData / subType.
  const realMotion = (subType = 4, startMs = t0): JObject => ({
    appType: 1,
    startTime: startMs,
    endTime: startMs + 700_000,
    subType,
    timeZone: "+0700",
    type: 30001,
    summaryData:
      '{"avgHeartRate":101,"maxHeartRate":120,"minHeartRate":91,"totalCalories":285000,"totalDistance":2500,"totalSteps":3243,"totalTime":600000,"sportType":258,"creepingWave":120.0,"mTotalDescent":-1.0,"mMaxAlti":1.4E-45}',
    detailData:
      `tp=lbs;k=0;lat=-6.2;lon=106.8;alt=0.0;t=${startMs / 1000}.0;\ntp=lbs;k=1;lat=-6.2001;lon=106.8001;alt=0.0;t=${startMs / 1000 + 1}.0;\n` +
      `tp=h-r;k=${startMs + 5_000};v=88;\ntp=s-r;k=${startMs + 5_000};v=130;\ntp=rs;k=0;v=-1;\ntp=rs;k=5;v=25;\ntp=rs;k=10;v=0;\ntp=p-m;k=10000219;v=217.0;\n`,
  });

  test("real records take totals from summaryData and the sport from subType", () => {
    const workout = build(fromJson(realMotion()));
    expect(workout).not.toBeNull();
    if (!workout) return;
    expect(workout.sportType).toBe(1); // Huawei 4, outdoor running
    expect(workout.sportName).toBe("Running");
    expect(workout.distance).toBe(2500);
    expect(workout.calories).toBe(285); // 285 000 cal
    expect(workout.steps).toBe(3243);
    expect(workout.avgHr).toBe(88); // the track's heart rate, not the summary's
    expect(workout.maxHr).toBe(88);
    expect(workout.points.filter((p) => p.lat !== null)).toHaveLength(2);
    // tp=rs: seconds from the start, decimetres per second; -1 is no speed.
    const speeds = workout.points.filter((p) => p.speed !== null);
    expect(speeds.map((p) => p.ts)).toEqual([workout.start + 5, workout.start + 10]);
    expect(speeds.map((p) => p.speed)).toEqual([2.5, 0]);
    const summary = JSON.parse(workout.summaryJson);
    expect(summary.elevationGain).toBeCloseTo(12, 9);
    expect("elevationLoss" in summary).toBe(false);
    expect(summary.huaweiSportType).toBe(4);
  });

  test("a workout without a track uses the summary's heart rate", () => {
    const record = realMotion(117);
    record.detailData = String(record.detailData).replaceAll("tp=h-r", "tp=x-x");
    const workout = build(fromJson(record));
    expect(workout?.sportType).toBe(140); // free weights are strength training
    expect(workout?.avgHr).toBe(101);
    expect(workout?.maxHr).toBe(120);
  });

  /** A real-layout record as raw text: `summary` is the summaryData text with its quotes escaped, as in the file, `detail` the track. */
  const brokenRealMotion = (summary: string, detail: string) =>
    `{"appType":1,"startTime":${t0},"endTime":${t0 + 700_000},"subType":4,"timeZone":"+0700","type":30001,` +
    `"summaryData":"${summary}","detailData":"${detail}"}`;

  test("a broken real record still gets its sport and totals", () => {
    const raw = brokenRealMotion(
      '{\\"avgHeartRate\\":101,\\"maxHeartRate\\":120,\\"totalCalories\\":285000,\\"totalDistance\\":2500,\\"totalSteps\\":3243,\\"totalTime\\":600000,\\"sportType\\":258}',
      `tp=lbs;k=0;lat=-6.2;lon=106.8;alt=0.0;t=${t0 / 1000}.0;\\n"stray";\\n`,
    );
    expect(parseObject(raw)).toBeNull();
    const workout = build(broken(raw));
    expect(workout?.sportType).toBe(1); // subType 4, not the summary's 258
    expect(workout?.sportName).toBe("Running");
    expect(workout?.distance).toBe(2500);
    expect(workout?.calories).toBe(285);
    expect(workout?.steps).toBe(3243);
    expect(workout?.avgHr).toBe(101); // no heart rate in the track: the summary's
    expect(workout?.points.filter((p) => p.lat !== null)).toHaveLength(1);
  });

  test("a broken summary is still read key by key", () => {
    const raw = brokenRealMotion(
      '{\\"totalDistance\\":2500,\\"totalCalories\\":285000,\\"note\\":"x"}',
      `tp=lbs;k=0;lat=-6.2;lon=106.8;alt=0.0;t=${t0 / 1000}.0;\\n`,
    );
    expect(parseObject(raw)).toBeNull();
    const workout = build(broken(raw));
    expect(workout?.sportType).toBe(1);
    expect(workout?.distance).toBe(2500);
    expect(workout?.calories).toBe(285);
  });

  test("Huawei sport ids map to the watch's table", () => {
    expect(joyofitType(4)).toBe(1);
    expect(joyofitType(5)).toBe(2);
    expect(joyofitType(3)).toBe(3);
    expect(joyofitType(102)).toBe(6);
    expect(joyofitType(103)).toBe(7);
    expect(joyofitType(116)).toBe(139);
    expect(joyofitType(281)).toBe(13);
    expect(joyofitType(140)).toBe(140);
    expect(joyofitType(283)).toBe(OTHER);
    expect(exportSportName(283)).toBe("Workout (Huawei type 283)");
    expect(exportSportName(null)).toBe("Workout (Huawei type unknown)");
  });

  test("a null subType does not fall back to sportType (JSONObject.opt returns NULL, not absent)", () => {
    const record = realMotion();
    record.subType = null;
    record.sportType = 4;
    expect(fromJson(record).sportType).toBeNull();
  });
});

describe("weigh-ins", () => {
  test("are read from embedded body composition fields", () => {
    const out = newRecorder();
    parse(
      healthRecord(
        point(
          "WEIGHT_BODYFAT_BROAD",
          t0 + 3_000,
          t0 + 3_000,
          '{"bodyWeight":71.5,"bodyFatRate":0.213,"muscleMass":52.1,"bodyWaterRate":55.2,"boneSalt":3.1,"bmi":22.4,"visceralFatLevel":8,"basal":1600,"impedance":512}',
        ),
        point("WEIGHT_BODYFAT_BROAD", t0 + 9_000, t0 + 9_000, '{"bodyFatRate":400}'),
      ),
      out,
    );
    expect(out.weighIns).toHaveLength(1);
    const w = out.weighIns[0] as ImportedWeighIn;
    expect(w.tsMs).toBe(t0 + 3_000);
    expect(w.weightKg).toBeCloseTo(71.5, 3);
    expect(w.impedanceOhm).toBe(512);
    const reported = JSON.parse(w.reportedJson as string);
    expect(reported.bodyFatPct).toBeCloseTo(21.3, 3);
    expect(reported.muscleKg).toBeCloseTo(52.1, 3);
    expect(reported.waterPct).toBeCloseTo(55.2, 3);
    expect(reported.boneKg).toBeCloseTo(3.1, 3);
    expect(reported.bmi).toBeCloseTo(22.4, 3);
    expect(reported.visceralFat).toBeCloseTo(8, 3);
    // The same minute holds a point without a weight: merged into the first weighing, whose weight stands.
    expect(out.rejected).toBe(0);
  });

  test("a weigh-in without a plausible weight is rejected", () => {
    const out = newRecorder();
    parse(
      healthRecord(point("WEIGHT_BODYFAT_BROAD", t0, t0, '{"bodyWeight":7,"bodyFatRate":20}')),
      out,
    );
    expect(out.weighIns).toEqual([]);
    expect(out.rejectedKeys).toEqual([["weight", "no-weight", "7.0"]]);
  });

  test("weight in grams becomes kilograms", () => {
    const out = newRecorder();
    parse(healthRecord(point("BODY_WEIGHT", t0, t0, "70250")), out);
    expect(out.weighIns[0]?.weightKg).toBeCloseTo(70.25, 3);
  });

  test("weight keys are recognised and goal keys are not", () => {
    expect(isWeightKey("WEIGHT_BODYFAT_BROAD")).toBe(true);
    expect(isWeightKey("DATA_POINT_BODY_WEIGHT")).toBe(true);
    expect(isWeightKey("WEIGHT_GOAL")).toBe(false);
    expect(isWeightKey("DATA_POINT_DYNAMIC_HEARTRATE")).toBe(false);
  });

  test("a real weigh-in only has weight, BMI and profile fields", () => {
    const out = newRecorder();
    parse(
      healthRecord(
        point(
          "WEIGHT_BODYFAT_BROAD",
          t0,
          t0,
          '{"age":33,"bodyWeight":89.2,"extendAttribute":"0","gender":1,"height":170,"bmi":30.9,"conflictFlag":0}',
        ),
      ),
      out,
    );
    const w = out.weighIns[0] as ImportedWeighIn;
    expect(w.weightKg).toBeCloseTo(89.2, 3);
    expect(w.impedanceOhm).toBeNull();
    expect(Object.keys(JSON.parse(w.reportedJson as string))).toEqual(["bmi"]);
  });

  test("body composition fields follow the BroadBodyFat description", () => {
    const out = newRecorder();
    parse(
      healthRecord(
        point(
          "WEIGHT_BODYFAT_BROAD",
          t0,
          t0,
          '{"bodyWeight":80,"bodyFat":16,"bodyFatRate":20.0,"moisture":40,"moistureRate":50.1,"muscleMass":30.5,"skeletalMusclelMass":25,"boneSalt":3.2,"basalMetabolism":1700,"visceralFatLevel":9,"proteinRate":17.5,"bodyAge":30,"bodyScore":70,"impedance":480,"lhrhImpedance":300,"leftArmMuscleMass":2,"waistHipRatio":0.9}',
        ),
      ),
      out,
    );
    const w = out.weighIns[0] as ImportedWeighIn;
    expect(w.impedanceOhm).toBe(480);
    const r = JSON.parse(w.reportedJson as string);
    expect(r.bodyFatPct).toBeCloseTo(20, 3);
    expect(r.waterPct).toBeCloseTo(50.1, 3);
    expect(r.muscleKg).toBeCloseTo(30.5, 3);
    expect(r.boneKg).toBeCloseTo(3.2, 3);
    expect(r.bmrKcal).toBeCloseTo(1700, 3);
    expect(r.visceralFat).toBeCloseTo(9, 3);
    expect(r.proteinPct).toBeCloseTo(17.5, 3);
    expect(r.bodyAge).toBeCloseTo(30, 3);
    // Fat and water in kilograms, skeletal and per-limb values, scores and ratios are not ReportedBody fields.
    expect(new Set(Object.keys(r))).toEqual(
      new Set([
        "bodyFatPct",
        "waterPct",
        "muscleKg",
        "boneKg",
        "bmrKcal",
        "visceralFat",
        "proteinPct",
        "bodyAge",
      ]),
    );
  });

  test("a weigh-in carries the profile it was weighed with", () => {
    const out = newRecorder();
    parse(
      healthRecord(
        point(
          "WEIGHT_BODYFAT_BROAD",
          t0,
          t0,
          '{"age":33,"bodyWeight":89.2,"gender":1,"height":170}',
        ),
      ),
      out,
    );
    expect(new Set(out.facts.map(([k, v]) => `${k}:${v}`))).toEqual(
      new Set(["height:170", "male:1", "age:33", "weight:89.2"]),
    );
    // those profile fields are not body values
    expect(out.weighIns[0]?.reportedJson).toBeNull();
  });
});

describe("sample sequence", () => {
  test("sleep details become a sleep score and other sequences are counted", () => {
    const out = newRecorder();
    const seq = (text: string) => parseSampleSequence(JSON.parse(text), out.collector);
    seq(
      '{"type":"700013","startTime":"1750000020000","endTime":"1750030020000","summaryData":"{\\"sleepScore\\":85,\\"sleepEfficiency\\":97,\\"bedTime\\":1750000000}"}',
    );
    seq('{"type":"700021","startTime":"1750000020000","endTime":"1750000080000","summaryData":""}');
    seq(
      '{"type":"700013","startTime":"1750000020000","endTime":"1750030020000","summaryData":"{\\"sleepScore\\":0}"}',
    );
    seq(
      '{"type":"700013","startTime":"1750000020000","endTime":"1750030020000","summaryData":"{\\"sleepScore\\":120}"}',
    );
    expect(out.sleepScores).toEqual([
      { start: 1_750_000_020, end: 1_750_030_020, score: 85, efficiency: 97 },
    ]);
    expect(out.unmappedKeys).toEqual(["SEQUENCE_700021"]);
    expect(out.rejectedKeys).toEqual([["SLEEP_DETAILS", "out-of-range", "120"]]);
  });
});

// Meals, water and the profile (real field names, made-up values)

const nutrition = (
  meal: number,
  kcalValue = 546.0,
  startMs = 1_785_603_600_000,
  eatSec: number | null = null,
) =>
  `{"carbohydrates":47.82,"dietaryEnergy":${kcalValue},"fat":27.21,"foodCount":300,"foodExtUnitValue":1,"foodProvider":1,"meal":${meal},` +
  (eatSec !== null ? `"mealEatTime":${eatSec},` : "") +
  `"mealRecordTime":${Math.trunc(startMs / 1000) + 75_000},"protein":27.21}`;

const mealRecord = (value: string, startMs = 1_785_603_600_000, zone = "+0700"): JObject =>
  JSON.parse(
    `{"recordId":"rec","timeZone":"${zone}","startTime":${startMs},"endTime":${startMs},"samplePoints":[{"key":"NUTRITION_RECORD","startTime":${startMs},"endTime":${startMs},"value":${JSON.stringify(value)}}]}`,
  );

describe("diary", () => {
  test("a nutrition record becomes a meal on its local day with the slot of its code", () => {
    const out = newRecorder();
    parse(mealRecord(nutrition(20, 584.0, 1_785_603_600_000, 1_785_646_800)), out);
    const m = out.meals[0] as ImportedMeal;
    expect(out.meals).toHaveLength(1);
    expect(m.key).toBe("rec:0");
    expect(m.date).toBe("2026-08-02");
    expect(m.meal).toBe("makan_siang");
    expect(m.kcal).toBe(584);
    expect(m.protein).toBe(27.2);
    expect(m.carbs).toBe(47.8);
    expect(m.eatenAtMs).toBe(1_785_646_800_000);
    expect(m.name).toBe(MEAL_NAME);
    expect(out.rejected).toBe(0);
    expect(out.unmappedKeys).toEqual([]);
  });

  test("a record written in another zone keeps its own day", () => {
    // 2026-08-06 23:00 in +0700 is 2026-08-07 00:00 in +0800: the day Huawei means.
    const out = newRecorder();
    parse(mealRecord(nutrition(30, 800.0, 1_786_035_600_000), 1_786_035_600_000, "+0800"), out);
    expect(out.meals[0]?.date).toBe("2026-08-07");
    expect(out.meals[0]?.meal).toBe("makan_malam");
    expect(out.meals[0]?.eatenAtMs).toBeNull();
  });

  test("meal slot codes and the hour fallback", () => {
    expect(slot(10, 0, "+0700")).toBe("sarapan");
    expect(slot(21, 0, "+0700")).toBe("snack");
    expect(slot(31, 0, "+0700")).toBe("snack");
    // an unknown code goes by the local hour: 01:00 UTC is 08:00 at +0700, 13:00 UTC is 20:00
    expect(slot(99, 3_600_000, "+0700")).toBe("sarapan");
    expect(slot(null, 13 * 3_600_000, "+0700")).toBe("makan_malam");
  });

  test("implausible meals are rejected", () => {
    const out = newRecorder();
    parse(mealRecord(nutrition(10, 0.0)), out);
    parse(mealRecord(nutrition(10, 90000.0)), out);
    parse(mealRecord('{"meal":10}'), out);
    expect(out.meals).toEqual([]);
    expect(out.rejectedKeys.map((r) => r[1])).toEqual([
      "out-of-range",
      "out-of-range",
      "no-number",
    ]);
  });

  test("water and height are read", () => {
    const out = newRecorder();
    parse(
      JSON.parse(
        `{"recordId":"w","timeZone":"+0800","startTime":1747564821000,"samplePoints":[
          {"key":"DRINK_WATER","startTime":1747564821000,"value":"{\\"drinkWater\\":250}"},
          {"key":"DRINK_WATER","startTime":1747564821000,"value":"{\\"drinkWater\\":0}"},
          {"key":"USER_HEIGHT","startTime":1747564830000,"value":"{\\"userHeight\\":0}"},
          {"key":"USER_HEIGHT","startTime":1747564840000,"value":"{\\"userHeight\\":172}"},
          {"key":"USER_HEIGHT","startTime":1747564850000,"value":"{\\"userHeight\\":17}"},
          {"key":"DIET_RECORD","startTime":1747564850000,"value":"{\\"dietRecord\\":0}"}]}`,
      ),
      out,
    );
    // 1747564821000 is 2025-05-18 10:00:21 UTC: 18:00 on the +0800 clock
    expect(out.water).toEqual([["2025-05-18", 250, "w:0"]]);
    expect(out.facts).toEqual([["height", 172, 1_747_564_840_000]]);
    expect(out.rejectedKeys.map((r) => r[1])).toEqual(["out-of-range", "out-of-range"]);
    expect(out.unmappedKeys).toEqual(["DIET_RECORD"]);
  });
});

// JSON helpers (HuaweiExportJsonTest)

function scan(text: string, maxChars?: number, chunk = text.length) {
  const out = { records: [] as string[], unterminated: [] as string[], oversized: 0 };
  const splitter = new RecordSplitter(
    (t) => out.records.push(t),
    (t) => out.unterminated.push(t),
    () => out.oversized++,
    maxChars,
  );
  for (let i = 0; i < text.length; i += Math.max(1, chunk)) splitter.push(text.slice(i, i + chunk));
  splitter.finish();
  return out;
}

describe("record splitter", () => {
  test("splits a top-level array into records", () => {
    const out = scan('\uFEFF[ {"a":1}, {"b":[1,2,{"c":3}]} ,\n{"d":"x"} ]');
    expect(out.records).toEqual(['{"a":1}', '{"b":[1,2,{"c":3}]}', '{"d":"x"}']);
    expect(out.unterminated).toEqual([]);
  });

  test("a single object file is one record", () => {
    expect(scan('{"sportType":4,"attribute":"x"}').records).toHaveLength(1);
  });

  test("braces and quotes inside strings do not end a record", () => {
    const record = '{"v":"a } b \\" } c { d","w":2}';
    expect(scan(`[${record},${record}]`).records).toEqual([record, record]);
  });

  test("a record open at the end is reported with its text", () => {
    const out = scan('[{"a":1},{"b":"never closed');
    expect(out.records).toEqual(['{"a":1}']);
    expect(out.unterminated).toEqual(['{"b":"never closed']);
  });

  test("an oversized record is skipped and the next one still read", () => {
    const big = `{"x":"${"a".repeat(100)}"}`;
    const out = scan(`[${big},{"y":1}]`, 50);
    expect(out.oversized).toBe(1);
    expect(out.records).toEqual(['{"y":1}']);
  });

  test("the result does not depend on where the chunks are cut", () => {
    const text = `[{"a":"x\\\\"},{"b":"q\\"}{","c":[{"d":1}]},{"e":"héllo \\u00e9"}]`;
    const whole = scan(text);
    for (const size of [1, 2, 3, 5, 7, 11]) expect(scan(text, undefined, size)).toEqual(whole);
    expect(whole.records).toHaveLength(3);
  });

  test("an oversized record spanning chunks is dropped without losing the next one", () => {
    const big = `{"x":"${"a".repeat(100)}"}`;
    const out = scan(`[${big},{"y":1}]`, 50, 7);
    expect(out.oversized).toBe(1);
    expect(out.records).toEqual(['{"y":1}']);
  });
});

describe("parseObject", () => {
  test("repairs bare numeric keys", () => {
    const obj = parseObject('{"partTimeMap":{1.0:439.0,2.0:451.0},"n":3}');
    expect(obj?.n).toBe(3);
    const map = obj?.partTimeMap as JObject;
    expect(map["1.0"]).toBe(439);
  });

  test("returns null for garbage", () => {
    expect(parseObject('{"a": }')).toBeNull();
    expect(parseObject("not json")).toBeNull();
  });

  test("numbers may be strings", () => {
    expect(number("82.0")).toBe(82);
    expect(number(7)).toBe(7);
    expect(number("abc")).toBeNull();
    expect(number(null)).toBeNull();
    expect(number("NaN")).toBeNull();
  });

  test("an embedded object is read from a JSON string value", () => {
    expect(embeddedObject('{"avgSaturation":97}')?.avgSaturation).toBe(97);
    expect(embeddedObject("82.0")).toBeNull();
  });

  test("epoch times are milliseconds with a seconds fallback and a sanity range", () => {
    expect(epochMs(1_750_000_000_000)).toBe(1_750_000_000_000);
    expect(epochMs("1750000000")).toBe(1_750_000_000_000);
    expect(epochMs(0)).toBeNull();
    expect(epochMs(5_000_000_000_000_000)).toBeNull();
    expect(epochMs("x")).toBeNull();
  });
});

describe("lenient reader (what Android's org.json accepts)", () => {
  test("unquoted names and values, single quotes, = and => and ; separators", () => {
    expect(parseObject("{a:1, b:'two', c=3; d=>4}")).toEqual({ a: 1, b: "two", c: 3, d: 4 });
  });

  test("comments", () => {
    expect(parseObject('{/* c */ "a":1, // line\n "b":2 # hash\n}')).toEqual({ a: 1, b: 2 });
  });

  test("bare literals: null, booleans (any case), words stay strings, NaN is not fatal", () => {
    expect(parseObject("{a:NULL, b:True, c:hello, d:NaN, e:Infinity}")).toEqual({
      a: null,
      b: true,
      c: "hello",
      d: "NaN",
      e: "Infinity",
    });
  });

  test("hex and octal integers", () => {
    expect(parseObject("{a:0x1F, b:017, c:09, d:-012}")).toEqual({ a: 31, b: 15, c: 9, d: -12 });
  });

  test("raw line breaks inside strings, and text after the object is ignored", () => {
    expect(parseObject('{"a":"x\ny"} trailing')).toEqual({ a: "x\ny" });
  });

  test("trailing and missing values in arrays read as null", () => {
    expect(readLenient("[1,,2,]")).toEqual([1, null, 2, null]);
  });

  test("escapes", () => {
    expect(parseObject("{'a':'it\\'s \\u00e9 \\q'}")).toEqual({ a: "it's é q" });
  });

  test("names must be strings; unterminated input fails", () => {
    expect(parseObject("{true:2}")).toBeNull();
    expect(parseObject("{a:1,}")).toBeNull();
    expect(parseObject('{"a":1')).toBeNull();
    expect(parseObject("{'a':'x}")).toBeNull();
  });

  test("a record JSON.parse refuses is still read by the parsers", () => {
    const record = parseObject(
      `{type:7, samplePoints:[{key:'DATA_POINT_DYNAMIC_HEARTRATE', startTime:${t0}, value:'70'},]}`,
    );
    expect(record).not.toBeNull();
    const out = newRecorder();
    parse(record as JObject, out);
    expect(out.heartRateReadings).toEqual([[1_750_000_020, 70]]);
  });

  test("numeric keys are repaired after the lenient reader has failed", () => {
    expect(parseObject("{a:{1.0:2.0}, b:'x'}")).toEqual({ a: { "1.0": 2 }, b: "x" });
  });
});

describe("Kotlin/Java number rules", () => {
  test("roundToInt rounds ties toward positive infinity and saturates", () => {
    expect(roundToInt(2.5)).toBe(3);
    expect(roundToInt(-2.5)).toBe(-2);
    expect(roundToInt(0.49999999999999994)).toBe(0);
    expect(roundToInt(1e12)).toBe(2147483647);
    expect(roundToInt(-1e12)).toBe(-2147483648);
    expect(() => roundToInt(Number.NaN)).toThrow();
  });

  test("Double.toString", () => {
    expect(javaDouble(7)).toBe("7.0");
    expect(javaDouble(0.5)).toBe("0.5");
    expect(javaDouble(1e7)).toBe("1.0E7");
    expect(javaDouble(12345678.9)).toBe("1.23456789E7");
    expect(javaDouble(0.0001)).toBe("1.0E-4");
    expect(javaDouble(-0)).toBe("-0.0");
  });

  test("toDoubleOrNull grammar", () => {
    expect(parseJavaDouble(" 82.0 ")).toBe(82);
    expect(parseJavaDouble("1e3")).toBe(1000);
    expect(parseJavaDouble("5.")).toBe(5);
    expect(parseJavaDouble(".5")).toBe(0.5);
    expect(parseJavaDouble("1f")).toBe(1);
    expect(parseJavaDouble("0x1p4")).toBe(16);
    expect(parseJavaDouble("abc")).toBeNull();
    expect(parseJavaDouble("")).toBeNull();
    expect(parseJavaDouble("1,5")).toBeNull();
    expect(parseJavaDouble("-Infinity")).toBe(-Infinity);
  });
});
