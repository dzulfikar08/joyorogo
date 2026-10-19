import { describe, expect, test } from "bun:test";

import { DOMParser } from "@xmldom/xmldom";
import { decodePoints } from "@joyorogo/api/lib/watch-workout";

import { START, indoorDoc, rideDoc, runDoc } from "./fixtures";
import { NoGpsError, buildGpx, isoSeconds, xmlText } from "./gpx";

const NS_GPX = "http://www.topografix.com/GPX/1/1";
const NS_TPX = "http://www.garmin.com/xmlschemas/TrackPointExtension/v1";
const NS_PWR = "http://www.garmin.com/xmlschemas/PowerExtension/v1";

/** Parses strictly: any warning, error or fatal error from the parser fails the test. */
function parse(xml: string) {
  const problems: string[] = [];
  const doc = new DOMParser({
    onError: (level, message) => problems.push(`${level}: ${message}`),
  }).parseFromString(xml, "application/xml");
  expect(problems).toEqual([]);
  return doc;
}

describe("buildGpx", () => {
  const source = runDoc();
  const xml = buildGpx(source);
  const dom = parse(xml);
  const fixes = decodePoints(source.points).filter((p) => p.lat !== null);

  test("well-formed GPX 1.1 with a named track", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    const root = dom.documentElement!;
    expect(root.localName).toBe("gpx");
    expect(root.namespaceURI).toBe(NS_GPX);
    expect(root.getAttribute("version")).toBe("1.1");
    expect(
      dom.getElementsByTagNameNS(NS_GPX, "trk")[0]!.getElementsByTagNameNS(NS_GPX, "name")[0]!
        .textContent,
    ).toBe("Run");
    expect(
      dom.getElementsByTagNameNS(NS_GPX, "metadata")[0]!.getElementsByTagNameNS(NS_GPX, "time")[0]!
        .textContent,
    ).toBe(isoSeconds(START));
  });

  test("a trkpt per GPS fix, with the fix's position, elevation and UTC time; samples without a fix are not points", () => {
    const pts = dom.getElementsByTagNameNS(NS_GPX, "trkpt");
    expect(pts.length).toBe(fixes.length);
    expect(fixes.length).toBe(592);
    for (const i of [0, 100, 591]) {
      const pt = pts[i]!;
      const p = fixes[i]!;
      expect(Number(pt.getAttribute("lat"))).toBeCloseTo(p.lat as number, 6);
      expect(Number(pt.getAttribute("lon"))).toBeCloseTo(p.lon as number, 6);
      expect(Number(pt.getElementsByTagNameNS(NS_GPX, "ele")[0]!.textContent)).toBeCloseTo(
        p.alt as number,
        1,
      );
      expect(pt.getElementsByTagNameNS(NS_GPX, "time")[0]!.textContent).toBe(isoSeconds(p.ts));
    }
  });

  test("heart rate and cadence in the Garmin TrackPointExtension", () => {
    const pt = dom.getElementsByTagNameNS(NS_GPX, "trkpt")[10]!;
    const p = fixes[10]!;
    const ext = pt.getElementsByTagNameNS(NS_TPX, "TrackPointExtension")[0]!;
    expect(Number(ext.getElementsByTagNameNS(NS_TPX, "hr")[0]!.textContent)).toBe(p.hr as number);
    expect(Number(ext.getElementsByTagNameNS(NS_TPX, "cad")[0]!.textContent)).toBe(
      p.cadence as number,
    );
    expect(pt.getElementsByTagNameNS(NS_PWR, "PowerInWatts").length).toBe(0);
  });

  test("power in the PowerExtension on a ride", () => {
    const ride = rideDoc();
    const rideDom = parse(buildGpx(ride));
    const pts = rideDom.getElementsByTagNameNS(NS_GPX, "trkpt");
    const points = decodePoints(ride.points);
    expect(pts.length).toBe(points.length);
    expect(Number(pts[5]!.getElementsByTagNameNS(NS_PWR, "PowerInWatts")[0]!.textContent)).toBe(
      points[5]!.power as number,
    );
  });

  test("a workout without GPS has no track to write", () => {
    expect(() => buildGpx(indoorDoc())).toThrow(NoGpsError);
  });
});

describe("xml escaping", () => {
  test("the five XML characters are escaped and forbidden control characters dropped", () => {
    expect(xmlText(`a<b>&"c'\u0001d`)).toBe("a&lt;b&gt;&amp;&quot;c&apos;d");
  });

  test("a sport name with markup still parses", () => {
    const doc = runDoc();
    doc.analysis = null;
    doc.workout.sportName = `Run <&> "fast"`;
    const dom = parse(buildGpx(doc));
    expect(
      dom.getElementsByTagNameNS(NS_GPX, "trk")[0]!.getElementsByTagNameNS(NS_GPX, "name")[0]!
        .textContent,
    ).toBe(`Run <&> "fast"`);
  });
});

describe("isoSeconds", () => {
  test("UTC with a Z", () => {
    expect(isoSeconds(0)).toBe("1970-01-01T00:00:00Z");
  });
});
