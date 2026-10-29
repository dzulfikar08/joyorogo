// Port of `HuaweiSportsHealthParser.kt`: `SportsHealth data & desciption/SportsHealth-Data.xls` (the typo is Huawei's): one workbook with
// 77 sheets, most of them empty or about the account. The one JoyoFit reads is `10-user sport daily statistics`: a row per day,
// `recordDay` (`20201114`), `timeZone` (`+0700`, with a leading tab) and `sportBasicInfoData` (`{"steps":1711,"distance":1087,
// "calorie":66726,"duration":47,...}`, distance in metres, calories in small calories). Each day becomes an `ImportedDayTotal`; the phone
// writes what the day's minute rows fall short of as one row from noon.

import { epochDayOf, roundToInt, toIntOrNull } from "./java";
import { embeddedObject, number, sampleOf } from "./json";
import type { JObject } from "./json";
import type { Collector } from "./model";
import { readSheets } from "./xls";

const MAX_STEPS = 200_000;
const MAX_METRES = 300_000;
const MAX_CALORIES = 30_000_000;

/** The first column (lowest index, as the native `HashMap<Int, String>` lists them) whose header reads `name`. */
function columnOf(header: Map<number, string>, name: string): number | null {
  let found: number | null = null;
  for (const [col, text] of header)
    if (text.trim() === name && (found === null || col < found)) found = col;
  return found;
}

export function parseSportsHealth(file: Uint8Array, out: Collector) {
  const sheets = readSheets(file, (name) => name.toLowerCase().includes("sport daily statistics"));
  for (const sheet of sheets) {
    const header = sheet.rows[0];
    if (!header) continue;
    const dayCol = columnOf(header, "recordDay");
    const zoneCol = columnOf(header, "timeZone");
    const dataCol = columnOf(header, "sportBasicInfoData");
    if (dayCol === null || dataCol === null) continue;
    for (const row of sheet.rows.slice(1)) {
      const day = row.get(dayCol)?.trim();
      if (day === undefined) continue;
      const raw = row.get(dataCol);
      const info = embeddedObject(raw?.trim());
      if (!info) {
        out.rejected("sportBasicInfoData", "no-number", sampleOf(raw));
        continue;
      }
      parseDay(day, zoneCol === null ? undefined : row.get(zoneCol), info, out);
    }
  }
}

function parseDay(day: string, zone: string | undefined, info: JObject, out: Collector) {
  const year = toIntOrNull(day.slice(0, 4));
  const month = toIntOrNull(day.slice(4, 6));
  const dom = toIntOrNull(day.slice(6, 8));
  const epochDay =
    day.length >= 8 && year !== null && month !== null && dom !== null
      ? epochDayOf(year, month, dom)
      : null;
  if (epochDay === null) {
    out.rejected("recordDay", "no-time", day.slice(0, 20));
    return;
  }
  const steps = rounded(info.steps);
  const distance = rounded(info.distance);
  const calories = rounded(info.calorie);
  if (
    steps < 0 ||
    steps > MAX_STEPS ||
    distance < 0 ||
    distance > MAX_METRES ||
    calories < 0 ||
    calories > MAX_CALORIES
  ) {
    out.rejected(
      "sportBasicInfoData",
      "out-of-range",
      `${steps} steps/${distance} m/${calories} cal`,
    );
    return;
  }
  if (steps === 0 && distance === 0 && calories === 0) return;
  const start = epochDay * 86_400 - offsetSeconds(zone, epochDay);
  out.dayTotal({
    dayStartSec: start,
    dayEndSec: start + 86_400,
    noonSec: start + 43_200,
    steps,
    distance,
    calories,
  });
}

function rounded(value: unknown): number {
  const n = number(value);
  return n === null ? 0 : roundToInt(n);
}

/** `+0700` as seconds east of UTC; this device's own zone on that day when the cell is empty or odd. */
function offsetSeconds(zone: string | undefined, epochDay: number): number {
  const text = (zone ?? "").replace(/[^+\-0-9]/g, "");
  if (text.length === 5 && (text[0] === "+" || text[0] === "-")) {
    const hours = toIntOrNull(text.slice(1, 3));
    const minutes = toIntOrNull(text.slice(3, 5));
    if (hours !== null && minutes !== null && hours <= 18 && minutes < 60) {
      return (hours * 3600 + minutes * 60) * (text[0] === "-" ? -1 : 1);
    }
  }
  return -new Date(epochDay * 86_400_000).getTimezoneOffset() * 60;
}
