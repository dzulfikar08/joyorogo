// Writes a sample Huawei import file for trying the phone side (docs/huawei-web-import.md in the joyofit repo): a made-up export in the real
// layout is zipped (AES-256, password below), converted by the real converter and saved with a description of what it must contain.
//
//   bun scripts/huawei-sample.ts [outDir=/tmp] [heartRateMinutes=21000]
//
// Writes <outDir>/joyofit-import-sample.ndjson.gz and <outDir>/joyofit-import-sample.expected.json. 21 000 minutes of heart rate cross the
// importer's 20 000-minute flush, so the file has more than one `minutes` batch. Nothing here is real health data.

import { readFileSync } from "node:fs";

import { convertExport } from "../apps/fit/src/lib/huawei/convert";
import { buildSyntheticExport, zipExport } from "../apps/fit/src/lib/huawei/synthetic-export";

const outDir = process.argv[2] ?? "/tmp";
const heartRateMinutes = Number(process.argv[3] ?? 21_000);
const PASSWORD = "sample-password";
const EXPORT_NAME = "HUAWEI_HEALTH_SAMPLE.zip";

const xls = new Uint8Array(
  readFileSync(
    new URL("../apps/fit/src/lib/huawei/fixtures/sports-health-synthetic.xls", import.meta.url),
  ),
);
const { files, expected } = buildSyntheticExport({ heartRateMinutes, sportsHealthXls: xls });
const zip = await zipExport(files, PASSWORD);
const createdAt = new Date();
const result = await convertExport({
  file: new File([zip], EXPORT_NAME),
  exportName: EXPORT_NAME,
  password: PASSWORD,
  now: createdAt,
});

const file = `${outDir}/joyofit-import-sample.ndjson.gz`;
await Bun.write(file, result.blob);
await Bun.write(
  `${outDir}/joyofit-import-sample.expected.json`,
  `${JSON.stringify(
    {
      about:
        "What joyofit-import-sample.ndjson.gz must contain (docs/huawei-web-import.md). Synthetic data, not a real person.",
      file: "joyofit-import-sample.ndjson.gz",
      header: {
        format: "joyofit-import",
        version: 1,
        source: "huawei-export",
        createdAt: createdAt.getTime(),
        exportName: EXPORT_NAME,
      },
      // Rows per batch kind as the lines carry them (`workout` = lines, `workoutPoints` = their points).
      rows: expected.rows,
      // The `t` of every line after the header, in file order: the native importer's batch order.
      lineKinds: expected.lineKinds,
      minuteBatches: expected.minuteBatches,
      // After applying on an empty database: distinct `step_samples` minutes (the 30 step minutes fall on heart-rate minutes), and the rest.
      afterApplyOnEmptyDatabase: {
        stepSampleMinutes: heartRateMinutes,
        sleepSegments: expected.rows.sleep,
        healthMetrics: { emotion: 3, hrv: 1 },
        sleepScores: expected.rows.sleepScores,
        scaleReadings: expected.rows.weighIns,
        workouts: expected.workouts.length,
        workoutPoints: expected.rows.workoutPoints,
        rogoImportQueue: { meal: 1, water: 2 },
      },
      workouts: expected.workouts,
      summary: expected.summary,
      profile: expected.profile,
      oldestSec: expected.oldestSec,
      newestSec: expected.newestSec,
      fileBytes: result.blob.size,
    },
    null,
    2,
  )}\n`,
);
console.log(`${file} (${result.blob.size} bytes), ${outDir}/joyofit-import-sample.expected.json`);
