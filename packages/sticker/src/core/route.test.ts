import { describe, expect, test } from "bun:test";

import { decodePolyline, haversine, projectRoute, readRoute, routeLength, simplify, trimRoute, type LatLng } from "./route";

// ~111 m per 0.001 deg of latitude: a straight 2 km north-south line.
const line: LatLng[] = Array.from({ length: 21 }, (_, i) => [-6.2 + i * 0.001, 106.8]);

describe("polyline", () => {
  test("decodes the reference example", () => {
    const pts = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(pts).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });

  test("tolerates truncated and empty input", () => {
    expect(decodePolyline("")).toEqual([]);
    expect(decodePolyline("_p~iF~ps|U_ul").length).toBe(1);
  });

  test("readRoute accepts arrays and strings, drops invalid points", () => {
    expect(readRoute([[1, 2], ["3", "4"], [999, 0], ["x", 1], [5], null, "z"])).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(readRoute("_p~iF~ps|U")).toHaveLength(1);
    expect(readRoute(undefined)).toEqual([]);
    expect(readRoute({})).toEqual([]);
  });
});

describe("trim and project", () => {
  test("haversine matches known distances", () => {
    expect(haversine([0, 0], [0, 1])).toBeGreaterThan(111_000);
    expect(haversine([0, 0], [0, 1])).toBeLessThan(111_400);
  });

  test("trims both ends by meters", () => {
    const total = routeLength(line);
    const trimmed = trimRoute(line, 200, 200)!;
    expect(routeLength(trimmed)).toBeCloseTo(total - 400, -1);
    expect(haversine(line[0]!, trimmed[0]!)).toBeCloseTo(200, -1);
    expect(haversine(line.at(-1)!, trimmed.at(-1)!)).toBeCloseTo(200, -1);
  });

  test("no trim returns the points; too short after trim is null (no stub)", () => {
    expect(trimRoute(line, 0, 0)).toEqual(line);
    expect(trimRoute(line.slice(0, 4), 200, 200)).toBeNull();
    expect(trimRoute([[0, 0]], 0, 0)).toBeNull();
    expect(trimRoute([], 100, 100)).toBeNull();
  });

  test("projection fits the box, keeps aspect and centers", () => {
    const p = projectRoute(line, 400, 400, 20)!;
    const xs = p.points.map((q) => q[0]);
    const ys = p.points.map((q) => q[1]);
    expect(Math.min(...ys)).toBeCloseTo(20);
    expect(Math.max(...ys)).toBeCloseTo(380);
    expect(Math.min(...xs)).toBeCloseTo(200);
    expect(projectRoute([[1, 1], [1, 1]], 100, 100, 0)).toBeNull();
    expect(projectRoute([[1, 1]], 100, 100, 0)).toBeNull();
  });

  test("north is up", () => {
    const p = projectRoute(line, 400, 400, 0)!;
    expect(p.points[0]![1]).toBeGreaterThan(p.points.at(-1)![1]);
  });

  test("simplify keeps endpoints and drops collinear points", () => {
    const out = simplify([[0, 0], [1, 0.01], [2, 0], [3, 5], [4, 0]], 0.5);
    expect(out[0]).toEqual([0, 0]);
    expect(out.at(-1)).toEqual([4, 0]);
    expect(out.length).toBe(4);
  });
});
