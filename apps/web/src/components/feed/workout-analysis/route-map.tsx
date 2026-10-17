import { i18n } from "@joyorogo/i18n";
import {
  type AnalysisSeries,
  type LatLon,
  kmMarkers,
  trackSegments,
} from "@joyorogo/api/lib/workout-analysis";
import { cn } from "@joyorogo/ui/lib/utils";
import maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { type MapTheme, maplibreStyle } from "@/lib/map-style";

import { nearestTrackIndex } from "./analysis-math";

const ROUTE_COLOR = "#ff5a1f";
const ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';
/** A pointer within this many screen pixels of the route scrubs to the nearest sample. */
const HIT_PX = 28;
const SVG_NS = "http://www.w3.org/2000/svg";

function styleFor(theme: MapTheme): StyleSpecification {
  return maplibreStyle(theme) as unknown as StyleSpecification;
}

function startElement(): HTMLElement {
  const el = document.createElement("div");
  el.className = "size-4 rounded-full border-[3px] border-white bg-[#22a35a] shadow-md";
  return el;
}

/** Dark disc with a white flag (Lucide "flag" outline). */
function finishElement(): HTMLElement {
  const el = document.createElement("div");
  el.className =
    "grid size-6 place-items-center rounded-full border-2 border-white bg-neutral-900 shadow-md";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "13");
  svg.setAttribute("height", "13");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "white");
  svg.setAttribute("stroke-width", "2.4");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7");
  svg.append(path);
  el.append(svg);
  return el;
}

function kmElement(km: number, onClick: () => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = String(km);
  el.className =
    "min-w-5 cursor-pointer rounded-full bg-white px-1.5 py-px text-[10px] leading-4 font-bold text-neutral-900 shadow ring-1 ring-black/10 tabular-nums dark:bg-neutral-800 dark:text-white dark:ring-white/15";
  el.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return el;
}

/** Every km pill at close zoom, thinning out as the map zooms away from the route. */
function kmStep(zoom: number): number {
  if (zoom >= 14) return 1;
  if (zoom >= 13) return 2;
  if (zoom >= 12) return 5;
  return 10;
}

function emptyPoint() {
  return { type: "FeatureCollection" as const, features: [] };
}

/**
 * OpenFreeMap route map for one workout: casing + line, start, finish and km markers, fit to the
 * route, and a highlight dot that follows `scrubIndex`. Pointing at the route scrubs back.
 * Loaded lazily; maplibre-gl is the heavy part of the post page.
 */
export default function RouteMap({
  track,
  series,
  scrubIndex,
  onScrub,
  theme,
  className,
}: {
  track: (LatLon | null)[];
  /** Used for the km markers; omit for a route without distance. */
  series: AnalysisSeries | null;
  scrubIndex: number | null;
  /** Omitted when the map has no shared scrubber. */
  onScrub?: (index: number | null) => void;
  theme: MapTheme;
  className?: string;
}) {
  const { t } = useTranslation("feed");
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const syncRef = useRef<() => void>(() => {});
  const appliedTheme = useRef(theme);
  const [failed, setFailed] = useState(false);
  const latest = useRef({ track, scrubIndex, onScrub, theme });
  latest.current = { track, scrubIndex, onScrub, theme };

  const scrubTo = useRef<(index: number | null) => void>(() => {});
  scrubTo.current = (index) => latest.current.onScrub?.(index);

  // One map per mount; a theme change swaps the style in place (see the theme effect).
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const segments = trackSegments(track);
    const flat = segments.flat();
    if (flat.length < 2) return;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: node,
        style: styleFor(latest.current.theme),
        attributionControl: false,
        cooperativeGestures: true,
        locale: {
          "CooperativeGesturesHandler.WindowsHelpText": i18n.t("place:map.gesture.windows"),
          "CooperativeGesturesHandler.MacHelpText": i18n.t("place:map.gesture.mac"),
          "CooperativeGesturesHandler.MobileHelpText": i18n.t("place:map.gesture.mobile"),
        },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        bounds: flat.reduce(
          (b, [lat, lon]) => b.extend([lon, lat]),
          new maplibregl.LngLatBounds([flat[0]![1], flat[0]![0]], [flat[0]![1], flat[0]![0]]),
        ),
        fitBoundsOptions: { padding: 40, maxZoom: 16 },
      });
    } catch {
      setFailed(true);
      return;
    }
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(
      new maplibregl.AttributionControl({ compact: false, customAttribution: ATTRIBUTION }),
      "bottom-right",
    );

    const route = {
      type: "FeatureCollection" as const,
      features: segments
        .filter((s) => s.length > 1)
        .map((s) => ({
          type: "Feature" as const,
          properties: {},
          geometry: { type: "LineString" as const, coordinates: s.map(([lat, lon]) => [lon, lat]) },
        })),
    };

    const syncScrub = () => {
      const source = map.getSource("scrub") as maplibregl.GeoJSONSource | undefined;
      if (!source) return;
      const { track: points, scrubIndex: at } = latest.current;
      const p = at !== null ? points[at] : null;
      source.setData(
        p
          ? {
              type: "FeatureCollection" as const,
              features: [
                {
                  type: "Feature" as const,
                  properties: {},
                  geometry: { type: "Point" as const, coordinates: [p[1], p[0]] },
                },
              ],
            }
          : emptyPoint(),
      );
    };
    syncRef.current = syncScrub;

    const addRoute = () => {
      const dark = latest.current.theme === "dark";
      map.addSource("route", { type: "geojson", data: route });
      map.addSource("scrub", { type: "geojson", data: emptyPoint() });
      const round = { "line-cap": "round", "line-join": "round" } as const;
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: round,
        paint: { "line-color": dark ? "#0d0e10" : "#ffffff", "line-width": 8 },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: round,
        paint: { "line-color": ROUTE_COLOR, "line-width": 4.5 },
      });
      map.addLayer({
        id: "scrub-halo",
        type: "circle",
        source: "scrub",
        paint: { "circle-radius": 11, "circle-color": ROUTE_COLOR, "circle-opacity": 0.3 },
      });
      map.addLayer({
        id: "scrub-dot",
        type: "circle",
        source: "scrub",
        paint: {
          "circle-radius": 6.5,
          "circle-color": ROUTE_COLOR,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3,
        },
      });
      syncScrub();
    };
    map.on("style.load", addRoute);

    const markers: { marker: maplibregl.Marker; km: number }[] = [];
    const first = flat[0]!;
    const last = flat[flat.length - 1]!;
    const fixed = [
      new maplibregl.Marker({ element: startElement() }).setLngLat([first[1], first[0]]).addTo(map),
      new maplibregl.Marker({ element: finishElement() }).setLngLat([last[1], last[0]]).addTo(map),
    ];
    if (series) {
      for (const m of kmMarkers(series)) {
        const marker = new maplibregl.Marker({
          element: kmElement(m.km, () => scrubTo.current(m.index)),
        })
          .setLngLat([m.pos[1], m.pos[0]])
          .addTo(map);
        markers.push({ marker, km: m.km });
      }
    }
    const thin = () => {
      const step = kmStep(map.getZoom());
      for (const { marker, km } of markers) {
        marker.getElement().style.display = km % step === 0 ? "" : "none";
      }
    };
    map.on("zoom", thin);
    thin();

    const pick = (point: maplibregl.Point) => {
      const lngLat = map.unproject(point);
      const i = nearestTrackIndex(latest.current.track, lngLat.lat, lngLat.lng);
      const p = i >= 0 ? latest.current.track[i] : null;
      if (!p) return null;
      const screen = map.project([p[1], p[0]]);
      return Math.hypot(screen.x - point.x, screen.y - point.y) <= HIT_PX ? i : null;
    };
    map.on("mousemove", (event) => {
      const i = pick(event.point);
      map.getCanvas().style.cursor = i !== null ? "pointer" : "";
      if (i !== null) scrubTo.current(i);
    });
    map.on("click", (event) => {
      const i = pick(event.point);
      if (i !== null) scrubTo.current(i);
    });
    map.getCanvasContainer().addEventListener("mouseleave", () => scrubTo.current(null));

    return () => {
      for (const m of fixed) m.remove();
      for (const { marker } of markers) marker.remove();
      syncRef.current = () => {};
      map.remove();
      mapRef.current = null;
    };
    // The track and series of a post never change while it is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, series]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedTheme.current === theme) return;
    appliedTheme.current = theme;
    // A full reload (no diff): the route layers are not part of the style and are re-added on style.load.
    map.setStyle(styleFor(theme), { diff: false });
  }, [theme]);

  useEffect(() => {
    syncRef.current();
  }, [scrubIndex]);

  if (failed) {
    return (
      <div
        className={cn(
          "grid place-items-center bg-muted p-6 text-center text-sm text-muted-foreground",
          className,
        )}
      >
        {t("analysis.map.unavailable")}
      </div>
    );
  }
  return (
    <div
      ref={host}
      role="application"
      aria-label={t("analysis.map.aria")}
      className={cn(
        "size-full overflow-hidden bg-muted [&_.maplibregl-ctrl-attrib]:bg-white/80! [&_.maplibregl-ctrl-attrib]:text-neutral-700! [&_.maplibregl-ctrl-attrib_a]:text-neutral-700!",
        className,
      )}
    />
  );
}
