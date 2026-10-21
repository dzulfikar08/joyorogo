import { i18n } from "@joyorogo/i18n";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";

import { cn } from "@joyorogo/ui/lib/utils";

import type { Coords } from "@/lib/location";

/** OpenFreeMap: free vector tiles and styles, no key, no usage cap (attribution stays on). */
const STYLE_LIGHT = "https://tiles.openfreemap.org/styles/positron";
const STYLE_DARK = "https://tiles.openfreemap.org/styles/fiord";

/** Pins closer than this many screen pixels merge into one counted pin. */
const CLUSTER_PX = 60;

export type MapPlace = {
  key: string;
  name: string;
  lat: number;
  lng: number;
  /** Average kcal as shown on the pin; null shows the food icon. */
  label: string | null;
  visits: number;
};

type Cluster = { lat: number; lng: number; members: MapPlace[] };

function clusterPlaces(places: MapPlace[], map: maplibregl.Map): Cluster[] {
  const cells = new Map<string, MapPlace[]>();
  for (const place of places.toSorted((a, b) => b.visits - a.visits)) {
    const point = map.project([place.lng, place.lat]);
    const cell = `${Math.floor(point.x / CLUSTER_PX)}:${Math.floor(point.y / CLUSTER_PX)}`;
    const list = cells.get(cell);
    if (list) list.push(place);
    else cells.set(cell, [place]);
  }
  return [...cells.values()].map((members) => ({
    lat: members.reduce((sum, m) => sum + m.lat, 0) / members.length,
    lng: members.reduce((sum, m) => sum + m.lng, 0) / members.length,
    members,
  }));
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Lucide "utensils" outline, for places with no calorie average yet. */
function fallbackIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const d of [
    "M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2",
    "M7 2v20",
    "M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7",
  ]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

function pinElement(cluster: Cluster, onClick: () => void): HTMLButtonElement {
  const top = cluster.members[0]!;
  const label =
    cluster.members.length > 1
      ? i18n.t("place:map.cluster", { n: cluster.members.length })
      : top.name;
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.className =
    "relative inline-flex h-10 min-w-10 items-center justify-center rounded-full border-2 border-card bg-makan-soft px-3 text-sm font-bold text-makan-ink tabular-nums shadow-float focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none";
  button.style.cursor = "pointer";
  if (top.label) {
    button.append(top.label);
  } else {
    button.append(fallbackIcon());
  }
  if (cluster.members.length > 1) {
    const badge = document.createElement("span");
    badge.textContent = String(cluster.members.length);
    badge.className =
      "absolute -top-1.5 -right-1.5 grid min-w-5 place-items-center rounded-full border-2 border-card bg-primary px-1 text-[0.6875rem] leading-4 font-bold text-primary-foreground";
    button.append(badge);
  }
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function youAreHere(): HTMLElement {
  const dot = document.createElement("div");
  dot.setAttribute("aria-label", i18n.t("place:map.you"));
  dot.className = "size-4 rounded-full border-[3px] border-white bg-[#2f6fed] shadow-float";
  return dot;
}

/**
 * Map of the user's places: compact pills showing the place's average kcal,
 * merged into counted pins when they crowd each other. Loaded lazily
 * (maplibre-gl is the heavy part).
 */
export default function PlacesMap({
  places,
  dark,
  origin,
  onSelect,
  className,
  cooperative = false,
}: {
  places: MapPlace[];
  dark: boolean;
  origin: Coords | null;
  onSelect: (key: string) => void;
  className?: string;
  /** Preview mode: the map must not trap page scroll. */
  cooperative?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const redraw = useRef<() => void>(() => {});
  const latest = useRef({ places, onSelect, origin });
  latest.current = { places, onSelect, origin };

  useEffect(() => {
    if (!host.current) return;
    const map = new maplibregl.Map({
      container: host.current,
      style: dark ? STYLE_DARK : STYLE_LIGHT,
      center: [110.4, -7.5],
      zoom: 4,
      attributionControl: { compact: false },
      // Inline preview: one finger scrolls the page, two fingers move the map.
      cooperativeGestures: cooperative,
      locale: {
        "CooperativeGesturesHandler.WindowsHelpText": i18n.t("place:map.gesture.windows"),
        "CooperativeGesturesHandler.MacHelpText": i18n.t("place:map.gesture.mac"),
        "CooperativeGesturesHandler.MobileHelpText": i18n.t("place:map.gesture.mobile"),
      },
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      cooperative ? "top-left" : "bottom-right",
    );

    const draw = () => {
      for (const marker of markers.current) marker.remove();
      markers.current = [];
      const { places: current, onSelect: select, origin: here } = latest.current;
      for (const cluster of clusterPlaces(current, map)) {
        const onClick = () => {
          if (cluster.members.length === 1) {
            select(cluster.members[0]!.key);
            return;
          }
          const bounds = new maplibregl.LngLatBounds();
          for (const m of cluster.members) bounds.extend([m.lng, m.lat]);
          map.fitBounds(bounds, { padding: 90, maxZoom: 17, duration: 450 });
          // coincident pins never separate by fitting: zoom in a notch instead
          if (map.getZoom() >= 16.5) map.easeTo({ zoom: map.getZoom() + 1 });
        };
        markers.current.push(
          new maplibregl.Marker({ element: pinElement(cluster, onClick) })
            .setLngLat([cluster.lng, cluster.lat])
            .addTo(map),
        );
      }
      if (here) {
        markers.current.push(
          new maplibregl.Marker({ element: youAreHere() }).setLngLat([here.lng, here.lat]).addTo(map),
        );
      }
    };
    redraw.current = draw;
    map.on("zoomend", draw);
    map.on("resize", draw);
    fit(map, latest.current.places, false);
    draw();

    return () => {
      for (const marker of markers.current) marker.remove();
      markers.current = [];
      redraw.current = () => {};
      map.remove();
      mapRef.current = null;
    };
  }, [dark, cooperative]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    fit(map, places, true);
    redraw.current();
  }, [places]);

  useEffect(() => {
    redraw.current();
  }, [origin]);

  return (
    <div
      ref={host}
      role="application"
      aria-label={i18n.t("place:map.aria")}
      className={cn("size-full overflow-hidden bg-muted", className)}
    />
  );
}

function fit(map: maplibregl.Map, places: MapPlace[], animate: boolean) {
  if (places.length === 0) return;
  if (places.length === 1) {
    map.jumpTo({ center: [places[0]!.lng, places[0]!.lat], zoom: 15 });
    return;
  }
  const bounds = new maplibregl.LngLatBounds();
  for (const place of places) bounds.extend([place.lng, place.lat]);
  map.fitBounds(bounds, { padding: 64, maxZoom: 15, duration: animate ? 400 : 0 });
}
