import { describe, expect, test } from "bun:test";
import type { AnalysisSeries } from "@joyorogo/api/lib/workout-analysis";

import {
  areaPath,
  availableMetrics,
  axisTicks,
  comparisonDeltas,
  formatPaceOrSpeed,
  linePath,
  loadWording,
  metricValues,
  nearestTrackIndex,
  niceTicks,
  paceBarPercent,
  paceMode,
  valueDomain,
} from "./analysis-math";

function series(over: Partial<AnalysisSeries> = {}): AnalysisSeries {
  return {
    stepSec: 5,
    n: 4,
    dist: [0, 10, 20, 30],
    hr: [100, 120, null, 140],
    pace: [300, 300, null, 240],
    alt: null,
    cad: null,
    power: null,
    track: null,
    ...over,
  };
}

describe("units", () => {
  test("pace for runs and walks, speed for rides, neither otherwise", () => {
    expect(paceMode("run")).toBe("pace");
    expect(paceMode("walk")).toBe("pace");
    expect(paceMode("ride")).toBe("speed");
    expect(paceMode("swim")).toBeNull();
  });

  test("formats pace as m:ss and speed as km/h", () => {
    expect(formatPaceOrSpeed("run", 332)).toBe("5:32");
    expect(formatPaceOrSpeed("ride", 180)).toBe("20.0");
    expect(formatPaceOrSpeed("run", null)).toBe("--");
  });
});

describe("chart metrics", () => {
  test("lists only metrics with data, pace only for pace sports", () => {
    expect(availableMetrics(series(), "run")).toEqual(["pace", "hr"]);
    expect(availableMetrics(series(), "other")).toEqual(["hr"]);
    expect(availableMetrics(series({ alt: [1, 2, 3, 4], power: [0, 0, 0, 0] }), "ride")).toEqual([
      "pace",
      "hr",
      "alt",
      "power",
    ]);
  });

  test("turns pace into km/h for rides and keeps gaps", () => {
    expect(metricValues(series(), "pace", "ride")).toEqual([12, 12, null, 15]);
    expect(metricValues(series(), "pace", "run")).toEqual([300, 300, null, 240]);
  });

  test("pace domain ignores spikes; domains are never flat", () => {
    const calm = Array.from({ length: 100 }, () => 300);
    const spiky = [...calm, 3000];
    const [, hi] = valueDomain(spiky, "pace");
    expect(hi).toBeLessThan(400);
    const [lo, top] = valueDomain([150, 150], "hr");
    expect(top - lo).toBeGreaterThan(5);
  });

  test("nice ticks are round and inside the range", () => {
    expect(niceTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(112, 188, 3).every((t) => t >= 112 && t <= 188)).toBe(true);
    expect(niceTicks(5, 5, 3)).toEqual([]);
  });

  test("x ticks in km with distance, minutes without", () => {
    const withDist = series({ n: 2, dist: [0, 8960] });
    expect(axisTicks(withDist, 5).map((t) => t.label)).toEqual(["2", "4", "6", "8"]);
    const withoutDist = series({ n: 121, dist: null });
    expect(axisTicks(withoutDist, 5).map((t) => t.label)).toEqual(["2", "4", "6", "8", "10"]);
  });

  test("paths restart after gaps and close areas per stretch", () => {
    const pts = [{ x: 0, y: 1 }, { x: 1, y: 2 }, null, { x: 3, y: 4 }, { x: 4, y: 5 }];
    expect(linePath(pts)).toBe("M0.0 1.0L1.0 2.0M3.0 4.0L4.0 5.0");
    expect(areaPath(pts, 9).match(/Z/g)?.length).toBe(2);
  });
});

describe("split bars", () => {
  test("fastest fills the row, slowest keeps 40 percent", () => {
    expect(paceBarPercent(300, 300, 360)).toBe(100);
    expect(paceBarPercent(360, 300, 360)).toBe(40);
    expect(paceBarPercent(300, 300, 300)).toBe(100);
  });
});

describe("load wording", () => {
  test("bands at 0.8, 1.3 and 1.5", () => {
    expect(loadWording(0.79)).toBe("under");
    expect(loadWording(0.8)).toBe("steady");
    expect(loadWording(1.3)).toBe("steady");
    expect(loadWording(1.31)).toBe("high");
    expect(loadWording(1.5)).toBe("high");
    expect(loadWording(1.51)).toBe("spike");
  });
});

describe("comparison", () => {
  const item = (paceSecKm: number | null, avgHr: number | null) => ({
    startedAt: 0,
    distM: 5000,
    sec: 1500,
    paceSecKm,
    avgHr,
    gainM: null,
  });

  test("deltas against the previous and the average; negative pace is faster", () => {
    const out = comparisonDeltas(
      { paceSecKm: 300, avgHr: 150 },
      { basis: "distance", items: [item(310, 148), item(330, 152)] },
    );
    expect(out.previous).toEqual({ paceSecKm: -10, hrBpm: 2 });
    expect(out.average).toEqual({ paceSecKm: -20, hrBpm: 0 });
  });

  test("a single similar workout has no separate average", () => {
    const out = comparisonDeltas(
      { paceSecKm: 300, avgHr: null },
      { basis: "duration", items: [item(null, 140)] },
    );
    expect(out.previous).toEqual({ paceSecKm: null, hrBpm: null });
    expect(out.average).toBeNull();
  });
});

describe("nearest track sample", () => {
  test("picks the closest non-null position", () => {
    const track: ([number, number] | null)[] = [[0, 0], null, [0, 0.01], [0, 0.02]];
    expect(nearestTrackIndex(track, 0, 0.011)).toBe(2);
    expect(nearestTrackIndex([null, null], 0, 0)).toBe(-1);
  });
});
