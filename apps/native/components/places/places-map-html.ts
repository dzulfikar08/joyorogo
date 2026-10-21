// The map runs MapLibre GL JS inside a WebView: free OpenFreeMap vector tiles,
// no API key, and the same look as the web app. react-native-maps would need a
// Google Maps key on Android; @maplibre/maplibre-react-native would add a
// native renderer to the build for what is one small screen. The script is
// bundled in the HTML string; only maplibre-gl itself comes from the CDN.

const MAPLIBRE_VERSION = "5.24.0";
const STYLE_LIGHT = "https://tiles.openfreemap.org/styles/positron";
const STYLE_DARK = "https://tiles.openfreemap.org/styles/fiord";

export type MapPin = {
  key: string;
  name: string;
  lat: number;
  lng: number;
  /** Average kcal shown in the pill (already formatted), or null for the food icon. */
  label: string | null;
  visits: number;
};

export type MapColors = {
  background: string;
  card: string;
  muted: string;
  mutedForeground: string;
  primary: string;
  primaryForeground: string;
  makanSoft: string;
  makanText: string;
};

/** Words rendered inside the page; `cluster` carries a `%N%` placeholder for the pin count. */
export type MapLabels = { offline: string; cluster: string };

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Messages the page posts back to React Native. */
export type MapMessage = { type: "select"; key: string } | { type: "error" };

// JSON for a <script> body: "<" is escaped so "</script>" in a place name cannot end it.
const inlineJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

export function buildMapHtml(input: {
  pins: MapPin[];
  origin: { lat: number; lng: number } | null;
  dark: boolean;
  interactive: boolean;
  colors: MapColors;
  labels: MapLabels;
}): string {
  const { colors } = input;
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css">
<style>
  html,body,#map{margin:0;height:100%;width:100%;background:${colors.muted};overflow:hidden;font-family:sans-serif}
  .pin{position:relative;min-width:44px;height:32px;border-radius:16px;border:2px solid ${colors.card};background:${colors.makanSoft};
    box-shadow:0 1px 6px rgba(0,0,0,.22);padding:0 10px;display:flex;align-items:center;justify-content:center;white-space:nowrap;
    color:${colors.makanText};font:700 13px/1 sans-serif;box-sizing:border-box}
  .pin .count{position:absolute;top:-6px;right:-6px;min-width:20px;height:20px;border-radius:10px;padding:0 5px;box-sizing:border-box;
    background:${colors.primary};color:${colors.primaryForeground};border:2px solid ${colors.card};font:700 11px/16px sans-serif;text-align:center}
  .here{width:16px;height:16px;border-radius:50%;background:#2f6fed;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.35);box-sizing:border-box}
  #offline{display:none;position:absolute;inset:0;align-items:center;justify-content:center;text-align:center;padding:24px;
    color:${colors.mutedForeground};font:600 14px/1.4 sans-serif}
  .maplibregl-ctrl-attrib{background:${colors.card}d9 !important;color:${colors.mutedForeground} !important}
  .maplibregl-ctrl-attrib a{color:${colors.mutedForeground} !important}
</style></head>
<body><div id="map"></div><div id="offline">${escapeHtml(input.labels.offline)}</div>
<script src="https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js"></script>
<script>
(function () {
  var PINS = ${inlineJson(input.pins)};
  var ORIGIN = ${inlineJson(input.origin)};
  var INTERACTIVE = ${input.interactive ? "true" : "false"};
  var CLUSTER_LABEL = ${inlineJson(input.labels.cluster)};
  function post(message) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }
  if (typeof maplibregl === "undefined") {
    document.getElementById("offline").style.display = "flex";
    post({ type: "error" });
    return;
  }
  var map = new maplibregl.Map({
    container: "map",
    style: ${inlineJson(input.dark ? STYLE_DARK : STYLE_LIGHT)},
    center: [110.4, -7.5],
    zoom: 4,
    attributionControl: { compact: false },
    interactive: INTERACTIVE,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false
  });
  if (INTERACTIVE) map.touchZoomRotate.disableRotation();
  var markers = [];
  var CLUSTER_PX = 60;

  function cluster() {
    var cells = {};
    var order = [];
    PINS.slice().sort(function (a, b) { return b.visits - a.visits; }).forEach(function (pin) {
      var p = map.project([pin.lng, pin.lat]);
      var cell = Math.floor(p.x / CLUSTER_PX) + ":" + Math.floor(p.y / CLUSTER_PX);
      if (!cells[cell]) { cells[cell] = []; order.push(cell); }
      cells[cell].push(pin);
    });
    return order.map(function (cell) {
      var members = cells[cell];
      var lat = 0, lng = 0;
      members.forEach(function (m) { lat += m.lat; lng += m.lng; });
      return { lat: lat / members.length, lng: lng / members.length, members: members };
    });
  }

  function food(el) {
    el.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>';
  }

  function pinEl(c) {
    var top = c.members[0];
    var el = document.createElement("button");
    el.className = "pin";
    el.setAttribute("aria-label", c.members.length > 1 ? CLUSTER_LABEL.replace("%N%", String(c.members.length)) : top.name);
    if (top.label) {
      var text = document.createElement("span");
      text.textContent = top.label;
      el.appendChild(text);
    } else {
      food(el);
    }
    if (c.members.length > 1) addCount(el, c);
    el.addEventListener("click", function (e) {
      e.stopPropagation();
      if (c.members.length === 1) { post({ type: "select", key: top.key }); return; }
      var b = new maplibregl.LngLatBounds();
      c.members.forEach(function (m) { b.extend([m.lng, m.lat]); });
      map.fitBounds(b, { padding: 90, maxZoom: 17, duration: 450 });
      if (map.getZoom() >= 16.5) map.easeTo({ zoom: map.getZoom() + 1 });
    });
    return el;
  }

  function addCount(el, c) {
    if (el.querySelector(".count")) return;
    var badge = document.createElement("span");
    badge.className = "count";
    badge.textContent = String(c.members.length);
    el.appendChild(badge);
  }

  function draw() {
    markers.forEach(function (m) { m.remove(); });
    markers = [];
    cluster().forEach(function (c) {
      markers.push(new maplibregl.Marker({ element: pinEl(c) }).setLngLat([c.lng, c.lat]).addTo(map));
    });
    if (ORIGIN) {
      var dot = document.createElement("div");
      dot.className = "here";
      markers.push(new maplibregl.Marker({ element: dot }).setLngLat([ORIGIN.lng, ORIGIN.lat]).addTo(map));
    }
  }

  if (PINS.length === 1) {
    map.jumpTo({ center: [PINS[0].lng, PINS[0].lat], zoom: 15 });
  } else if (PINS.length > 1) {
    var bounds = new maplibregl.LngLatBounds();
    PINS.forEach(function (p) { bounds.extend([p.lng, p.lat]); });
    map.fitBounds(bounds, { padding: 64, maxZoom: 15, duration: 0 });
  }
  map.on("zoomend", draw);
  map.on("resize", draw);
  draw();
})();
</script></body></html>`;
}
