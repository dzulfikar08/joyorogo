// COROS's MCP tools answer in prose ("1. Sport(9807) — 2026-10-03 / Duration: 2:12:38 | Distance: 12.03 km"), some in JSON.
// Everything here is tolerant on purpose: a record that cannot be read is counted and skipped, it never fails a sync.
// Sample outputs: https://github.com/coroslab/COROS-MCP/blob/main/docs/en/tools.md (docs/coros.md keeps the shapes we rely on).

export type CorosActivity = {
  /** The activity identifier follow-up queries need; null when the list did not carry one we could find. */
  labelId: string | null;
  sportType: number;
  /** `yyyy-mm-dd`, the day COROS shows the activity on (the COROS account's time zone). */
  date: string;
  /** Title COROS gave besides the generic `Sport(<code>)`, if any. */
  name: string | null;
  /** Clock time of the start when the record names one, for a stable fallback id; null otherwise. */
  startedAt: string | null;
  durationSec: number | null;
};

export type CorosActivityDetail = {
  calories: number | null;
  avgHeartRate: number | null;
  durationSec: number | null;
};

/** What a tool call handed back: the text blocks joined, and `structuredContent` when the server sent it. */
export type ToolOutput = { text: string; structured?: unknown };

/** `2:12:38`, `45:10`, `1h 20min 5s`, `90 min`, `5400` (seconds) into seconds; null when it is none of those. */
export function parseDuration(raw: string): number | null {
  const text = raw.trim();
  const clock = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (clock) {
    const [, a, b, c] = clock;
    return c === undefined ? Number(a) * 60 + Number(b) : Number(a) * 3600 + Number(b) * 60 + Number(c);
  }
  const words = /^(?:(\d+)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?\s*(?:(\d+)\s*s(?:ec(?:ond)?s?)?)?$/i.exec(text);
  if (words && (words[1] || words[2] || words[3])) {
    return Number(words[1] ?? 0) * 3600 + Number(words[2] ?? 0) * 60 + Number(words[3] ?? 0);
  }
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.round(Number(text));
  return null;
}

const DATE = /(\d{4})-(\d{2})-(\d{2})/;

function isoDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 19_000_101 && value <= 29_991_231) {
      const s = String(Math.trunc(value));
      return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    }
    return null;
  }
  if (typeof value !== "string") return null;
  const dashed = DATE.exec(value);
  if (dashed) return dashed[0];
  const packed = /^(\d{4})(\d{2})(\d{2})$/.exec(value.trim());
  return packed ? `${packed[1]}-${packed[2]}-${packed[3]}` : null;
}

const GENERIC_TITLE = /^sport$/i;

const HEADER = /^\s*(\d+)\.\s+(.+?)\s+[—–-]\s+(\d{4}-\d{2}-\d{2})\b/;

/** A field of one record block: `Label: value` anywhere in the block, label compared case-insensitively. */
function field(block: string, labels: string): string | null {
  const match = new RegExp(`(?:^|[\\s|,;(])(?:${labels})\\s*[:=]\\s*([^|\\n,;)]+)`, "i").exec(block);
  return match?.[1]?.trim() || null;
}

function parseTextRecords(text: string): { activities: CorosActivity[]; unparsed: number } {
  const lines = text.split(/\r?\n/);
  const blocks: string[][] = [];
  for (const line of lines) {
    if (/^\s*\d+\.\s+/.test(line)) blocks.push([line]);
    else blocks.at(-1)?.push(line);
  }
  const activities: CorosActivity[] = [];
  let unparsed = 0;
  for (const lineSet of blocks) {
    const block = lineSet.join("\n");
    const header = HEADER.exec(lineSet[0] ?? "");
    const title = header?.[2] ?? "";
    const sport = /\((\d+)\)/.exec(title)?.[1] ?? /sport\s*(?:type|code)\s*[:=]\s*(\d+)/i.exec(block)?.[1];
    const durationText = field(block, "duration|workout time|total time|time");
    const durationSec = durationText === null ? null : parseDuration(durationText);
    if (!header?.[3] || sport === undefined || durationSec === null || durationSec <= 0) {
      unparsed += 1;
      continue;
    }
    const label = title.replace(/\s*\(\d+\)\s*$/, "").trim();
    const startedAt = /(?:start(?:\s*time)?)\s*[:=]\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)/i.exec(block)?.[1] ?? null;
    activities.push({
      labelId: field(block, "label\\s*id|labelId|activity\\s*id|activityId|id")?.replace(/[`"']/g, "") ?? null,
      sportType: Number(sport),
      date: header[3],
      name: label === "" || GENERIC_TITLE.test(label) ? null : label,
      startedAt,
      durationSec,
    });
  }
  return { activities, unparsed };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const LIST_KEYS = ["records", "activities", "sportRecords", "list", "items", "data", "dataList"];

function findList(value: unknown, depth = 0): unknown[] | null {
  if (Array.isArray(value)) return value;
  const object = asRecord(value);
  if (!object || depth > 2) return null;
  for (const key of LIST_KEYS) {
    const found = findList(object[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function numberOf(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function durationOf(record: Record<string, unknown>): number | null {
  for (const key of ["durationSec", "totalTime", "workoutTime", "duration", "totalTimeSeconds"]) {
    const value = record[key];
    if (typeof value === "string") {
      const parsed = parseDuration(value);
      if (parsed !== null) return parsed;
    } else if (typeof value === "number" && value > 0) {
      return Math.round(value);
    }
  }
  return null;
}

function jsonRecords(structured: unknown): { activities: CorosActivity[]; unparsed: number } | null {
  const list = findList(structured);
  if (!list) return null;
  const activities: CorosActivity[] = [];
  let unparsed = 0;
  for (const item of list) {
    const record = asRecord(item);
    const sport = record ? numberOf(record.sportType, record.sport, record.sportCode) : null;
    const date = record ? (isoDate(record.date) ?? isoDate(record.happenDay) ?? isoDate(record.day) ?? isoDate(record.startTime)) : null;
    const durationSec = record ? durationOf(record) : null;
    if (!record || sport === null || date === null || durationSec === null || durationSec <= 0) {
      unparsed += 1;
      continue;
    }
    const id = record.labelId ?? record.activityId ?? record.id;
    const name = typeof record.name === "string" && record.name.trim() !== "" ? record.name.trim() : null;
    const started = typeof record.startTime === "string" ? /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?/.exec(record.startTime)?.[0] : undefined;
    activities.push({
      labelId: typeof id === "string" || typeof id === "number" ? String(id) : null,
      sportType: sport,
      date,
      name,
      startedAt: started ?? null,
      durationSec,
    });
  }
  return { activities, unparsed };
}

function jsonOf(output: ToolOutput): unknown {
  if (output.structured !== undefined && output.structured !== null) return output.structured;
  const text = output.text.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The activities of a `querySportRecords` answer: JSON when the server sent it, else the numbered prose list. */
export function parseSportRecords(output: ToolOutput): { activities: CorosActivity[]; unparsed: number } {
  const structured = jsonOf(output);
  if (structured !== undefined) {
    const parsed = jsonRecords(structured);
    if (parsed) return parsed;
  }
  return parseTextRecords(output.text);
}

/** Calories (and the heart rate, as a sanity signal) of a `getActivityDetail` answer. */
export function parseActivityDetail(output: ToolOutput): CorosActivityDetail {
  const structured = asRecord(jsonOf(output));
  if (structured) {
    const source = asRecord(structured.summary) ?? asRecord(structured.data) ?? structured;
    return {
      calories: positive(numberOf(source.calories, source.calorie, source.kcal, source.totalCalories)),
      avgHeartRate: positive(numberOf(source.avgHr, source.averageHeartRate, source.avgHeartRate)),
      durationSec: durationOf(source),
    };
  }
  const text = output.text;
  const calories = /(?:^|\n)\s*(?:active\s+)?calories?(?:\s+burned)?\s*[:=]\s*(\d[\d,]*(?:\.\d+)?)/i.exec(text)?.[1];
  const heart = /(?:average|avg\.?)\s+heart\s+rate\s*[:=]\s*(\d+)/i.exec(text)?.[1];
  const duration = field(text, "workout time|duration|total time");
  return {
    calories: positive(calories === undefined ? null : Number(calories.replace(/,/g, ""))),
    avgHeartRate: positive(heart === undefined ? null : Number(heart)),
    durationSec: duration === null ? null : parseDuration(duration),
  };
}

function positive(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

/**
 * COROS sport code → the type name the diary stores for imported workouts (the vocabulary Strava rows and the dedupe class table
 * share, so `workoutClassOf` and the MET table understand it). The codes are COROS's own: the list the open API documents (1xx
 * running and hiking, 2xx cycling, 3xx swimming, 402 strength, 900 walking) plus the 1-5 the MCP's workout tools use
 * (1 run, 2 ride, 3 swim, 4 strength, 5 trail run). Anything else is a generic workout, which gets the default MET.
 */
const SPORT_TYPES: Readonly<Record<number, string>> = {
  1: "Run",
  2: "Ride",
  3: "Swim",
  4: "WeightTraining",
  5: "TrailRun",
  100: "Run",
  101: "Treadmill",
  102: "TrailRun",
  103: "Run",
  104: "Hike",
  200: "Ride",
  201: "Ride",
  202: "Ride",
  203: "Ride",
  300: "Swim",
  301: "Swim",
  402: "WeightTraining",
  900: "Walk",
};

export function corosWorkoutType(sportType: number): string {
  return SPORT_TYPES[sportType] ?? "OtherWorkout";
}
