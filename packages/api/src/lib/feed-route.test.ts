import { describe, expect, test } from "bun:test";

import {
  MAP_MAX_POINTS,
  MAP_TRIM_M,
  type LatLon,
  buildFeedMapLine,
  decodePolyline,
  encodePolyline,
  feedMapPoints,
  haversineM,
  mapAllowed,
  paceOrSpeed,
  projectRoute,
  routeLengthM,
  simplifyRoute,
  sportKindFromName,
  svgPathData,
  trimRoute,
} from "./feed-route";

// About 111 m per 0.001 degree of latitude: a straight 2 km north-south line, 21 fixes.
const line: LatLon[] = Array.from({ length: 21 }, (_, i) => [-6.2 + i * 0.001, 106.8]);

/** A noisy 6 km loop of 1500 fixes, like a real GPS recording. */
function loop(n = 1500): LatLon[] {
  const out: LatLon[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / (n - 1)) * Math.PI * 2;
    const noise = Math.sin(i * 7.3) * 0.000008;
    out.push([-6.2 + Math.sin(a) * 0.009 + noise, 106.8 + (Math.cos(a) - 1) * 0.009 + noise]);
  }
  return out;
}

describe("trimRoute", () => {
  test("cuts 200 m from both ends along the route", () => {
    const total = routeLengthM(line);
    const trimmed = trimRoute(line, 200, 200)!;
    expect(routeLengthM(trimmed)).toBeCloseTo(total - 400, -1);
    expect(haversineM(line[0]!, trimmed[0]!)).toBeCloseTo(200, -1);
    expect(haversineM(line.at(-1)!, trimmed.at(-1)!)).toBeCloseTo(200, -1);
  });

  test("a route too short for the trim yields nothing, never a stub", () => {
    expect(trimRoute(line.slice(0, 4), 200, 200)).toBeNull();
    expect(trimRoute([[0, 0]], 0, 0)).toBeNull();
    expect(trimRoute([], 200, 200)).toBeNull();
  });

  test("the trim removes every original fix inside the first and last 200 m", () => {
    const trimmed = trimRoute(line, 200, 200)!;
    for (const p of trimmed) {
      expect(haversineM(line[0]!, p)).toBeGreaterThanOrEqual(190);
      expect(haversineM(line.at(-1)!, p)).toBeGreaterThanOrEqual(190);
    }
  });
});

describe("simplifyRoute", () => {
  test("keeps the ends and at most maxPoints, and stays near the original", () => {
    const route = loop();
    const out = simplifyRoute(route, MAP_MAX_POINTS);
    expect(out.length).toBeLessThanOrEqual(MAP_MAX_POINTS);
    expect(out.length).toBeGreaterThan(20);
    expect(out[0]).toEqual(route[0]!);
    expect(out.at(-1)).toEqual(route.at(-1)!);
    // Every original fix is within 60 m of the simplified line's points (loop radius is ~1 km).
    for (const p of route.filter((_, i) => i % 50 === 0)) {
      const nearest = Math.min(...out.map((q) => haversineM(p, q)));
      expect(nearest).toBeLessThan(120);
    }
  });

  test("short routes pass through", () => {
    expect(simplifyRoute(line.slice(0, 2))).toEqual(line.slice(0, 2));
    expect(simplifyRoute([])).toEqual([]);
  });

  test("a straight line collapses to its two ends", () => {
    expect(simplifyRoute(line)).toEqual([line[0]!, line.at(-1)!]);
  });
});

describe("polyline codec", () => {
  test("encode then decode is exact to 5 decimals", () => {
    const points: LatLon[] = [
      [-6.2, 106.8],
      [-6.20123, 106.80456],
      [38.5, -120.2],
    ];
    expect(decodePolyline(encodePolyline(points))).toEqual(points);
  });

  test("the reference polyline decodes", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });

  test("truncated input does not throw", () => {
    expect(() => decodePolyline("_p~iF~ps|U_ul")).not.toThrow();
  });
});

describe("buildFeedMapLine", () => {
  test("is trimmed, simplified and small", () => {
    const route = loop();
    const encoded = buildFeedMapLine(route)!;
    expect(encoded.length).toBeLessThan(900);
    const points = feedMapPoints(encoded)!;
    expect(points.length).toBeLessThanOrEqual(MAP_MAX_POINTS);
    // The shared line starts at least 200 m along the route (about) and ends 200 m before its end.
    expect(haversineM(route[0]!, points[0]!)).toBeGreaterThan(MAP_TRIM_M - 25);
    expect(haversineM(route.at(-1)!, points.at(-1)!)).toBeGreaterThan(MAP_TRIM_M - 25);
    // The loop starts and ends at the same spot, so no shared point may sit closer than the trim to it
    // (up to the 1 m encoding step and the simplification's own tolerance).
    for (const p of points) expect(haversineM(route[0]!, p)).toBeGreaterThan(MAP_TRIM_M - 40);
  });

  test("never contains a fix of the first or last 200 m", () => {
    const route = loop();
    const points = feedMapPoints(buildFeedMapLine(route))!;
    const startArea = route.filter((p) => haversineM(route[0]!, p) < MAP_TRIM_M - 40);
    expect(startArea.length).toBeGreaterThan(0);
    for (const hidden of startArea) {
      for (const shared of points) expect(haversineM(hidden, shared)).toBeGreaterThan(1);
    }
  });

  test("no usable route: null", () => {
    expect(buildFeedMapLine(null)).toBeNull();
    expect(buildFeedMapLine([])).toBeNull();
    expect(buildFeedMapLine(line.slice(0, 3))).toBeNull();
    expect(buildFeedMapLine([[91, 0], [0, 181], [Number.NaN, 1]])).toBeNull();
  });

  test("null entries (GPS gaps in an analysis track) are skipped", () => {
    const withGaps = [null, ...line.slice(0, 10), null, ...line.slice(10), null];
    expect(buildFeedMapLine(withGaps)).not.toBeNull();
  });

  test("a 450 m route is too short once 400 m are cut", () => {
    const short: LatLon[] = Array.from({ length: 5 }, (_, i) => [-6.2 + i * 0.001, 106.8]);
    expect(buildFeedMapLine(short)).toBeNull();
  });
});

describe("mapAllowed (privacy gate)", () => {
  test("both the post switch and the account switch must allow the map", () => {
    expect(mapAllowed(1, true)).toBe(true);
    expect(mapAllowed(undefined, undefined)).toBe(true);
    expect(mapAllowed(null, null)).toBe(true);
    expect(mapAllowed(0, true)).toBe(false);
    expect(mapAllowed(1, false)).toBe(false);
    expect(mapAllowed(0, false)).toBe(false);
  });
});

describe("workout figures", () => {
  test("pace for run and walk, speed for ride, nothing for the rest", () => {
    expect(paceOrSpeed("run", 5000, 1500)).toEqual({ kind: "pace", secPerKm: 300 });
    expect(paceOrSpeed("walk", 2000, 1200)).toEqual({ kind: "pace", secPerKm: 600 });
    const ride = paceOrSpeed("ride", 30000, 3600);
    expect(ride).toEqual({ kind: "speed", kmh: 30 });
    expect(paceOrSpeed("swim", 1000, 1000)).toBeNull();
    expect(paceOrSpeed("run", 0, 100)).toBeNull();
    expect(paceOrSpeed("run", 5000, 0)).toBeNull();
    expect(paceOrSpeed(null, 5000, 1500)).toBeNull();
  });

  test("sport kinds from names", () => {
    expect(sportKindFromName("Outdoor run")).toBe("run");
    expect(sportKindFromName("Lari")).toBe("run");
    expect(sportKindFromName("Outdoor cycling")).toBe("ride");
    expect(sportKindFromName("Bersepeda")).toBe("ride");
    expect(sportKindFromName("Sepeda")).toBe("ride");
    expect(sportKindFromName("Pool swim")).toBe("swim");
    expect(sportKindFromName("Hiking")).toBe("walk");
    expect(sportKindFromName("Yoga")).toBe("other");
  });
});

describe("projectRoute", () => {
  test("fits the box with padding", () => {
    const projected = projectRoute(line, 300, 150, 10)!;
    for (const [x, y] of projected.points) {
      expect(x).toBeGreaterThanOrEqual(9.99);
      expect(x).toBeLessThanOrEqual(290.01);
      expect(y).toBeGreaterThanOrEqual(9.99);
      expect(y).toBeLessThanOrEqual(140.01);
    }
  });

  test("degenerate routes project to null; the path data is one M and the rest L", () => {
    expect(projectRoute([[0, 0], [0, 0]], 100, 100, 5)).toBeNull();
    expect(projectRoute([[0, 0]], 100, 100, 5)).toBeNull();
    expect(svgPathData([[1, 2], [3.25, 4]])).toBe("M1.0 2.0 L3.3 4.0");
  });
});
