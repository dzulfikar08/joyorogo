// Port of `HuaweiSampleSequenceParser.kt`: the `Sample sequence data & description` folder, records `{type, startTime, endTime,
// summaryData, detailData, ...}` whose numbers are strings. Type 700013 (SLEEP_DETAILS) carries the night's score; every other kind is
// counted per type as unmapped.

import { roundToInt } from "./java";
import { embeddedObject, epochMs, number, sampleOf } from "./json";
import type { JObject } from "./json";
import type { Collector } from "./model";

const SLEEP_DETAILS = 700013;

export function parseSampleSequence(record: JObject, out: Collector) {
  const rawType = number(record.type);
  const type = rawType === null ? null : roundToInt(rawType);
  if (type !== SLEEP_DETAILS) {
    out.unmapped(`SEQUENCE_${type ?? "UNKNOWN"}`);
    return;
  }
  const startMs = epochMs(record.startTime);
  const endMs = epochMs(record.endTime);
  if (startMs === null || endMs === null || endMs <= startMs) {
    out.rejected("SLEEP_DETAILS", "bad-span", null);
    return;
  }
  const summary = embeddedObject(record.summaryData);
  const rawScore = number(summary?.sleepScore);
  const score = rawScore === null ? null : roundToInt(rawScore);
  if (score === null) {
    out.rejected("SLEEP_DETAILS", "no-number", sampleOf(record.summaryData));
    return;
  }
  // 0 is "not scored" (a nap or too little data): nothing to import, nothing unreadable either.
  if (score === 0) return;
  if (score < 1 || score > 100) {
    out.rejected("SLEEP_DETAILS", "out-of-range", String(score));
    return;
  }
  const rawEfficiency = number(summary?.sleepEfficiency);
  const efficiency = rawEfficiency === null ? null : roundToInt(rawEfficiency);
  out.sleepScore({
    start: Math.trunc(startMs / 1000),
    end: Math.trunc(endMs / 1000),
    score,
    efficiency: efficiency !== null && efficiency >= 0 && efficiency <= 100 ? efficiency : null,
  });
}
