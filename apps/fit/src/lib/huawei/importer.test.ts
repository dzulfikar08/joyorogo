// Port of HuaweiExportImporterTest.kt and HuaweiSportsHealthTest.kt (joyofit repo, modules/huawei-wear). Synthetic fixtures only. The
// native tests write to a fake store; these write to a fake `ImportSink` and check what it is handed, and in which order.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { ExportKind, ExportReadError, HuaweiExportImporter, kindOf } from "./importer";
import type { ExportEntry, ExportSource, ImporterOptions } from "./importer";
import type {
  ImportedDayTotal,
  ImportedMetric,
  ImportedMinute,
  ImportedSleep,
  ImportedSleepScore,
  ImportedWeighIn,
  ImportedWorkout,
  ImportSink,
  QueuedImport,
} from "./model";
import { ConvertError } from "./types";
import { parseSportsHealth } from "./sports-health";
import { readSheets, XlsError } from "./xls";

const t0 = 1_750_000_020_000;
const encoder = new TextEncoder();

class FakeSink implements ImportSink {
  /** Which write came, in order: the native flush order is part of the contract. */
  calls: string[] = [];
  minuteBatches: ImportedMinute[][] = [];
  sleep: ImportedSleep[] = [];
  metrics: ImportedMetric[] = [];
  sleepScores: ImportedSleepScore[] = [];
  dayTotals: ImportedDayTotal[] = [];
  weighIns: ImportedWeighIn[] = [];
  workouts: ImportedWorkout[] = [];
  queued: QueuedImport[] = [];

  get minutes() {
    return this.minuteBatches.flat();
  }
  writeMinutes(rows: ImportedMinute[]) {
    this.calls.push("minutes");
    this.minuteBatches.push(rows.map((r) => ({ ...r })));
  }
  writeSleep(rows: ImportedSleep[]) {
    this.calls.push("sleep");
    this.sleep.push(...rows);
  }
  writeMetrics(rows: ImportedMetric[]) {
    this.calls.push("metrics");
    this.metrics.push(...rows);
  }
  writeSleepScores(rows: ImportedSleepScore[]) {
    this.calls.push("sleepScores");
    this.sleepScores.push(...rows);
  }
  writeDayTotals(rows: ImportedDayTotal[]) {
    this.calls.push("dayTotals");
    this.dayTotals.push(...rows);
  }
  queueForRogo(rows: QueuedImport[]) {
    this.calls.push("queue");
    this.queued.push(...rows);
  }
  writeWeighIns(rows: ImportedWeighIn[]) {
    this.calls.push("weighIns");
    this.weighIns.push(...rows);
  }
  writeWorkout(workout: ImportedWorkout) {
    this.calls.push("workout");
    this.workouts.push(workout);
  }
}

/** An export held in memory; each file is handed over in pieces of `chunk` bytes, so records are cut anywhere. */
class MapSource implements ExportSource {
  constructor(
    private readonly files: Record<string, string | Uint8Array>,
    private readonly chunk = 1000,
    private readonly broken = new Set<string>(),
  ) {}
  entries(): ExportEntry[] {
    return Object.entries(this.files).map(([name, content]) => ({
      name,
      size: typeof content === "string" ? encoder.encode(content).length : content.length,
    }));
  }
  async read(entry: ExportEntry, onChunk: (bytes: Uint8Array) => void | Promise<void>) {
    const content = this.files[entry.name] as string | Uint8Array;
    const bytes = typeof content === "string" ? encoder.encode(content) : content;
    for (let at = 0; at < bytes.length; at += this.chunk) {
      await onChunk(bytes.subarray(at, at + this.chunk));
      if (this.broken.has(entry.name) && at > 0) throw new ExportReadError("Invalid CRC32");
    }
  }
}

const sample = (key: string, startMs: number, endMs: number, value: string) =>
  `{"key":"${key}","startTime":${startMs},"endTime":${endMs},"unit":"0","value":"${value.replaceAll('"', '\\"')}"}`;

const healthRecord = (...samples: string[]) =>
  `{"type":7,"startTime":${t0},"endTime":${t0 + 60_000},"timeZone":"+0700","recordId":"x","samplePoints":[${samples.join(",")}]}`;

const healthFile = "Health detail data & description/Health detail data1.json";
const sportFile = "Sport per minute merged data & description/Sport per minute1.json";
const motionFile = "Motion path detail data & description/Motion path detail data1.json";
const sequenceFile = "Sample sequence data & description/sample sequence data1.json";
const xlsFile = "SportsHealth data & desciption/SportsHealth-Data.xls";

const sportRecord = (...entries: string[]) =>
  `{"recordDay":20250615,"sportDataUserData":[${entries.join(",")}]}`;
const sportEntry = (steps: number, distance: number) =>
  `{"startTime":${t0},"endTime":${t0 + 60_000},"sportType":5,"sportBasicInfos":[{"steps":${steps},"distance":${distance},"calorie":5,"duration":1}]}`;

const motionRecord = (startMs = t0) =>
  `{"abnormalTrack":"","sportType":4,"startTime":${startMs},"endTime":${startMs + 600_000},"totalSteps":900,"totalDistance":1200,"totalCalories":80,` +
  `"attribute":"HW_EXT_TRACK_DETAIL@is\\ntp=lbs;k=0;lat=-6.2;lon=106.8;alt=0.0;t=${startMs / 1000}.0;\\ntp=h-r;k=${startMs + 5_000};v=130;\\n"}`;

async function run(
  files: Record<string, string | Uint8Array>,
  options: { sink?: FakeSink; chunk?: number; broken?: string[] } & ImporterOptions = {},
) {
  const sink = options.sink ?? new FakeSink();
  const importer = new HuaweiExportImporter(sink, options);
  const summary = await importer.run(new MapSource(files, options.chunk, new Set(options.broken)));
  return { sink, summary, importer };
}

describe("importer", () => {
  test("merges readings of the same minute and keeps the largest step count", async () => {
    const { sink, summary } = await run({
      [healthFile]: `[${healthRecord(
        sample("DATA_POINT_DYNAMIC_HEARTRATE", t0 + 5_000, t0 + 5_000, "80"),
        sample("DATA_POINT_DYNAMIC_HEARTRATE", t0 + 35_000, t0 + 35_000, "90"),
        sample("BLOOD_OXYGEN_SATURATION", t0 + 10_000, t0 + 10_000, '{"avgSaturation":97}'),
        sample("DATA_POINT_REST_HEARTRATE", t0, t0 + 1000, "58"),
        sample("STRESS_DATA", t0, t0, '{"score":30}'),
        sample("PROFESSIONAL_SLEEP_DEEP", t0, t0 + 1_800_000, ""),
        sample("WEIGHT_BODYFAT_BROAD", t0, t0, '{"bodyWeight":70}'),
      )}]`,
      // The export repeats minutes: 10, 12 and 10 steps are one minute, not 32.
      [sportFile]: `[${sportRecord(sportEntry(10, 8), sportEntry(12, 9), sportEntry(10, 8))}]`,
    });
    // The health file and the sport file are flushed separately; the phone merges the two rows of the minute.
    expect(sink.minutes).toHaveLength(2);
    const [health, sport] = sink.minutes as [ImportedMinute, ImportedMinute];
    expect(health.ts).toBe(1_750_000_020);
    expect(sport.ts).toBe(1_750_000_020);
    expect(health.heartRate).toBe(80);
    expect(health.spo2).toBe(97);
    expect(health.restingHeartRate).toBe(58);
    expect(sport.steps).toBe(12);
    expect(sport.calories).toBe(5);
    expect(sport.distance).toBe(9);
    expect(sink.sleep).toHaveLength(1);
    expect(sink.sleep[0]?.type).toBe(0x07);
    expect(sink.metrics.map((m) => m.value)).toEqual([30]);
    // Two readings in one minute are one reading: the export repeats them under a second numeric type.
    expect(summary.heartRateReadings).toBe(1);
    expect(summary.unmappedSamples).toBe(0);
    expect(summary.weighInsFound).toBe(1);
    expect(sink.weighIns[0]?.weightKg).toBeCloseTo(70, 3);
    expect(summary.filesRead).toBe(2);
    expect(summary.badRecords).toBe(0);
    expect(summary.oldestSec).toBe(1_750_000_020);
    expect(summary.newestSec).toBe(1_750_000_020 + 1800);
  });

  test("a flush writes minutes, sleep, metrics, sleep scores, queue, weigh-ins, day totals, in that order", async () => {
    const day = 1_785_603_600_000;
    const { sink } = await run({
      [healthFile]: `[${healthRecord(
        sample("WEIGHT_BODYFAT_BROAD", t0, t0, '{"bodyWeight":70}'),
        sample("NUTRITION_RECORD", day, day, '{"dietaryEnergy":584,"meal":20}'),
        sample("STRESS_DATA", t0, t0, '{"score":30}'),
        sample("PROFESSIONAL_SLEEP_DEEP", t0, t0 + 1_800_000, ""),
        sample("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "70"),
      )}]`,
    });
    expect(sink.calls).toEqual(["minutes", "sleep", "metrics", "queue", "weighIns"]);
  });

  test("a bad record is counted and the rest still imported", async () => {
    const { sink, summary } = await run({
      [healthFile]: `[${healthRecord(sample("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "70"))},{"samplePoints": },${healthRecord(
        sample("DATA_POINT_DYNAMIC_HEARTRATE", t0 + 120_000, t0 + 120_000, "75"),
      )}]`,
    });
    expect(summary.badRecords).toBe(1);
    expect(summary.badRecordReasons.get("health_detail/invalid-json")).toBe(1);
    expect(sink.minutes.map((m) => m.heartRate)).toEqual([70, 75]);
  });

  test("a record only the lenient reader accepts is read, not counted bad", async () => {
    const { sink, summary } = await run({
      [healthFile]: `[{type:7, samplePoints:[{key:'DATA_POINT_DYNAMIC_HEARTRATE', startTime:${t0}, value:'70'}]}]`,
    });
    expect(summary.badRecords).toBe(0);
    expect(sink.minutes.map((m) => m.heartRate)).toEqual([70]);
  });

  test("a motion path becomes a workout", async () => {
    const { sink, summary } = await run({ [motionFile]: `[${motionRecord()}]` });
    expect(sink.workouts).toHaveLength(1);
    expect(summary.workoutsFound).toBe(1);
    expect(sink.workouts[0]?.points).toHaveLength(2);
    expect(sink.workouts[0]?.distance).toBe(1200);
    expect(sink.workouts[0]?.avgHr).toBe(130);
  });

  test("a stray quote that swallows the next workout loses neither of them", async () => {
    // The odd quote after "a " flips string state for the rest of the file, so the record never closes by itself.
    const second = motionRecord(t0 + 7_200_000);
    const broken =
      `[{"abnormalTrack":"","sportType":4,"startTime":${t0},"endTime":${t0 + 600_000},"totalDistance":900,"attribute":"a "b;\\n` +
      `tp=lbs;k=0;lat=-6.2;lon=106.8;alt=0.0;t=1.75000002E9;\\n"},${second}]`;
    const { sink, summary } = await run({ [motionFile]: broken });
    expect(summary.badRecords).toBe(0);
    expect(sink.workouts).toHaveLength(2);
    expect(sink.workouts[0]?.distance).toBe(900);
  });

  test("files outside the data folders are ignored and an export without any is rejected", async () => {
    const { summary } = await run({
      [healthFile]: `[${healthRecord(sample("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "70"))}]`,
      "User run plan data & description/user run plan data.json": "[]",
      "Health detail data & description/Health detail data-Data Field Description.xlsx": "binary",
      "SportsHealth data & desciption/SportsHealth-Data Field Description.xls": "binary",
    });
    expect(summary.filesIgnored).toBe(3);
    expect(summary.filesRead).toBe(1);
    const error = await run({ "somewhere/else.json": "[]" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConvertError);
    expect((error as ConvertError).kind).toBe("not_an_export");
  });

  test("a spreadsheet that is not a workbook costs only that file", async () => {
    const { summary } = await run({
      [healthFile]: `[${healthRecord(sample("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "70"))}]`,
      [xlsFile]: "this is not an xls file".repeat(100),
    });
    expect(summary.filesRead).toBe(2);
    expect(summary.badRecords).toBe(1);
    expect([...summary.badRecordReasons.keys()]).toEqual(["sports_health/not an OLE2 file"]);
    expect(summary.heartRateReadings).toBe(1);
  });

  test("a file the archive cannot read costs only that file", async () => {
    const { summary, sink } = await run(
      {
        [healthFile]: `[${healthRecord(sample("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "70"))}]`,
        [motionFile]: `[${motionRecord()}]`,
      },
      { chunk: 40, broken: [motionFile] },
    );
    expect(summary.filesFailed).toBe(1);
    expect(summary.filesRead).toBe(1);
    expect(sink.workouts).toHaveLength(0);
    expect(sink.minutes).toHaveLength(1);
  });

  const xls = new Uint8Array(
    readFileSync(new URL("./fixtures/sports-health-synthetic.xls", import.meta.url)),
  );

  test("day totals and scores go out after the minutes", async () => {
    const { sink, summary } = await run({
      [xlsFile]: xls,
      [sportFile]: `[${sportRecord(sportEntry(10, 8))}]`,
      [sequenceFile]: `[{"type":"700013","startTime":"${t0}","endTime":"${t0 + 30_000_000}","summaryData":"{\\"sleepScore\\":85}"}]`,
    });
    expect(summary.dayTotalsFound).toBe(4);
    expect(sink.dayTotals).toHaveLength(4);
    expect(sink.sleepScores).toHaveLength(1);
    expect(sink.minutes).toHaveLength(1);
    // The minute is written before the day totals, which may only fill days without rows.
    expect(sink.calls).toEqual(["minutes", "sleepScores", "dayTotals"]);
  });

  const drink = (ms: number, ml: number) => sample("DRINK_WATER", ms, ms, `{"drinkWater":${ml}}`);

  test("meals and water are queued for JoyoRogo and the profile comes from the weigh-in", async () => {
    const day = 1_785_603_600_000; // 2026-08-02 00:00 in +0700
    const nutrition = `{"dietaryEnergy":584,"protein":12.5,"carbohydrates":50,"fat":8,"meal":20,"mealEatTime":${day / 1000 + 43_200},"mealRecordTime":${day / 1000 + 75_000}}`;
    const { sink, summary, importer } = await run({
      [healthFile]: `[${healthRecord(
        sample("NUTRITION_RECORD", day, day, nutrition),
        drink(day + 8 * 3_600_000, 250),
        drink(day + 9 * 3_600_000, 500),
        drink(day + 30 * 3_600_000, 250),
        sample(
          "WEIGHT_BODYFAT_BROAD",
          t0,
          t0,
          '{"age":33,"bodyWeight":89.2,"gender":1,"height":170}',
        ),
        sample("USER_HEIGHT", t0 + 1000, t0 + 1000, '{"userHeight":172}'),
      )}]`,
    });
    expect(summary.mealsFound).toBe(1);
    const meal = sink.queued.find((q) => q.kind === "meal") as QueuedImport;
    expect(meal.key).toBe("x:0");
    expect(JSON.parse(meal.payload)).toEqual({
      key: "x:0",
      date: "2026-08-02",
      meal: "makan_siang",
      name: "Makanan dari Huawei Health",
      kcal: 584,
      protein: 12.5,
      carbs: 50,
      fat: 8,
      eatenAt: (day / 1000 + 43_200) * 1000,
    });
    // 750 ml on the 2nd is 3 glasses, 250 ml on the 3rd is one
    const water = sink.queued.filter((q) => q.kind === "water");
    expect(water.map((q) => q.key)).toEqual(["2026-08-02", "2026-08-03"]);
    expect(water.map((q) => JSON.parse(q.payload).glasses)).toEqual([3, 1]);
    expect(water[0]?.payload).toBe('{"date":"2026-08-02","glasses":3}');
    expect(summary.waterDaysFound).toBe(2);
    // The water is the last write of the run.
    expect(sink.calls.at(-1)).toBe("queue");
    expect(sink.queued.at(-1)?.kind).toBe("water");
    // the newest height (the USER_HEIGHT record, a second later) wins; age 33 at 2025-06 gives 1992
    expect(importer.profile()).toEqual({
      heightCm: 172,
      weightKg: 89.2,
      sex: "male",
      birthYear: 1992,
    });
  });

  test("the same drink under the same record id is counted once", async () => {
    const day = 1_785_603_600_000;
    const record = healthRecord(drink(day, 250));
    const { sink } = await run({ [healthFile]: `[${record},${record}]` });
    expect(
      sink.queued.filter((q) => q.kind === "water").map((q) => JSON.parse(q.payload).glasses),
    ).toEqual([1]);
  });

  test("a cancelled run queues meals but not a partial day's water", async () => {
    const day = 1_785_603_600_000;
    let calls = 0;
    const { sink, summary } = await run(
      {
        [healthFile]: `[${healthRecord(drink(day, 250))},${healthRecord(drink(day + 1000, 250))}]`,
      },
      { isCancelled: () => calls++ >= 1 },
    );
    expect(summary.cancelled).toBe(true);
    expect(sink.queued.filter((q) => q.kind === "water")).toEqual([]);
  });

  test("cancelling keeps what was read so far", async () => {
    let records = 0;
    const { sink, summary } = await run(
      {
        [healthFile]: `[${healthRecord(sample("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "70"))},${healthRecord(
          sample("DATA_POINT_DYNAMIC_HEARTRATE", t0 + 120_000, t0 + 120_000, "75"),
        )}]`,
      },
      { isCancelled: () => records++ >= 1 },
    );
    expect(summary.cancelled).toBe(true);
    expect(sink.minutes.map((m) => m.heartRate)).toEqual([70]);
  });

  test("large files are flushed in batches", async () => {
    // 25 000 distinct minutes of heart rate, 1 000 to a record.
    const records = Array.from({ length: 25 }, (_, chunk) =>
      healthRecord(
        ...Array.from({ length: 1000 }, (_, i) => {
          const at = t0 + (chunk * 1000 + i) * 60_000;
          return sample("DATA_POINT_DYNAMIC_HEARTRATE", at, at, "70");
        }),
      ),
    ).join(",");
    const { sink, summary } = await run({ [healthFile]: `[${records}]` }, { chunk: 65_536 });
    expect(summary.heartRateReadings).toBe(25_000);
    // The buffer is checked after every record: 20 000 minutes, then the rest at the end of the file.
    expect(sink.minuteBatches.map((b) => b.length)).toEqual([20_000, 5_000]);
  });

  test("the result does not depend on where the input is cut", async () => {
    const files = {
      [healthFile]: `[${healthRecord(
        sample("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "70"),
        sample("NUTRITION_RECORD", t0, t0, '{"dietaryEnergy":300,"meal":10}'),
      )},{"samplePoints": },${healthRecord(sample("STRESS_DATA", t0, t0, '{"score":30}'))}]`,
      [motionFile]: `[${motionRecord()},${motionRecord(t0 + 7_200_000)}]`,
    };
    const whole = await run(files, { chunk: 1_000_000 });
    for (const chunk of [1, 3, 17]) {
      const cut = await run(files, { chunk });
      expect(cut.sink).toEqual(whole.sink);
      expect(cut.summary.toJson()).toEqual(whole.summary.toJson());
    }
  });

  test("progress ends at 1 and names the files", async () => {
    const reports: [number, number, number, string | null][] = [];
    await run(
      {
        [healthFile]: `[${healthRecord(sample("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "70"))}]`,
        [motionFile]: `[${motionRecord()}]`,
      },
      { onProgress: (p) => reports.push([p.fileIndex, p.fileCount, p.fraction, p.fileName]) },
    );
    const last = reports.at(-1);
    expect(last).toEqual([2, 2, 1, null]);
    expect(
      reports.some(
        ([index, count, , name]) =>
          index === 1 && count === 2 && name === "Health detail data1.json",
      ),
    ).toBe(true);
    for (const [, , fraction] of reports) expect(fraction).toBeGreaterThanOrEqual(0);
  });

  test("export kind is decided by the folder", () => {
    expect(kindOf("Health detail data & description/a.json")).toBe(ExportKind.HEALTH_DETAIL);
    expect(kindOf("x\\Sport per minute merged data & description\\a.JSON")).toBe(
      ExportKind.SPORT_PER_MINUTE,
    );
    expect(kindOf("Motion path detail data & description/motion path detail data.json")).toBe(
      ExportKind.MOTION_PATH,
    );
    expect(kindOf("Health detail data & description/readme.xlsx")).toBeNull();
    expect(kindOf("User route/plan.json")).toBeNull();
    expect(kindOf("motion path detail data.json")).toBe(ExportKind.MOTION_PATH);
    expect(kindOf("other/file.json")).toBeNull();
    expect(kindOf("SportsHealth data & desciption/SportsHealth-Data.xls")).toBe(
      ExportKind.SPORTS_HEALTH,
    );
    expect(
      kindOf("SportsHealth data & desciption/SportsHealth-Data Field Description.xls"),
    ).toBeNull();
  });
});

describe("SportsHealth-Data.xls", () => {
  const xls = new Uint8Array(
    readFileSync(new URL("./fixtures/sports-health-synthetic.xls", import.meta.url)),
  );

  test("reads sheets, cells and a string table that spans CONTINUE records", () => {
    const sheets = readSheets(xls, () => true);
    expect(sheets.map((s) => s.name)).toEqual([
      "1-user basic info",
      "10-user sport daily statistics",
      "50-user sample config",
    ]);
    const basic = (sheets[0] as { rows: Map<number, string>[] }).rows;
    expect(basic[0]?.get(0)).toBe("weight");
    expect(basic[0]?.get(1)).toBe("70");
    expect(basic[2]?.get(1)).toBe("cm/kg");
    const daily = (sheets[1] as { rows: Map<number, string>[] }).rows;
    expect(daily[0]?.get(0)).toBe("recordDay");
    expect(daily[1]?.get(1)).toBe("\t+0700");
    expect(daily[7]?.get(0)).toBe("20250619");
    expect(daily[8]?.get(2)).toBe("café 中文");
    const config = (sheets[2] as { rows: Map<number, string>[] }).rows;
    expect(config).toHaveLength(400);
    expect(config[399]?.get(0)).toBe(`configuration value number 399 ${"x".repeat(30)}`);
    expect(config[0]?.get(0)).toBe(`configuration value number 0 ${"x".repeat(30)}`);
  });

  test("daily totals become noon rows in the export's zone", () => {
    const totals: ImportedDayTotal[] = [];
    const rejected: [string, string, string | null][] = [];
    parseSportsHealth(xls, {
      heartRate() {},
      restingHeartRate() {},
      spo2() {},
      sleep() {},
      metric() {},
      sleepScore() {},
      dayTotal: (t) => totals.push(t),
      steps() {},
      weighIn() {},
      meal() {},
      water() {},
      profileFact() {},
      unmapped() {},
      rejected: (key, reason, sample) => rejected.push([key, reason, sample]),
    });
    // 14th (data), 15th (all zero: nothing), 16th (-03:30), 17th (900 000 steps: rejected), 18th, 19th (numeric day cell); the 20th has no JSON.
    const midnight = (day: number, offsetSec: number) => Date.UTC(2025, 5, day) / 1000 - offsetSec;
    expect(totals.map((t) => t.dayStartSec)).toEqual([
      midnight(14, 7 * 3600),
      midnight(16, -(3 * 3600 + 1800)),
      midnight(18, 7 * 3600),
      midnight(19, 7 * 3600),
    ]);
    const first = totals[0] as ImportedDayTotal;
    expect(first.noonSec).toBe(first.dayStartSec + 43_200);
    expect(first.dayEndSec).toBe(first.dayStartSec + 86_400);
    expect(first.steps).toBe(1711);
    expect(first.distance).toBe(1087);
    expect(first.calories).toBe(66726);
    expect(
      rejected.some(([key, reason]) => key === "sportBasicInfoData" && reason === "out-of-range"),
    ).toBe(true);
    expect(rejected.some(([, reason]) => reason === "no-number")).toBe(true);
  });

  test("a file that is not a workbook is rejected", () => {
    expect(() => readSheets(new Uint8Array(2048).fill(7), () => true)).toThrow(XlsError);
    expect(() => readSheets(new Uint8Array(2048).fill(7), () => true)).toThrow(/OLE2/);
  });

  test("a cut-off workbook is an XlsError, not a crash", () => {
    expect(() => readSheets(xls.subarray(0, 1500), () => true)).toThrow(XlsError);
  });
});
