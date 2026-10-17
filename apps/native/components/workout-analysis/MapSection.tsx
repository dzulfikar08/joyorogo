import { memo, useMemo } from 'react';

import { TileMap, type MapMarker } from '@/components/map';

import { kmMarkers, trackSegments, type LatLon, type WorkoutAnalysis } from '@joyorogo/api/lib/workout-analysis';
import { useAnalysisContext } from './context';
import { Card } from './primitives';
import { useScrubFrame } from './scrub';
import type { AnalysisMapTheme } from './theme';

const MAP_HEIGHT = 260;

interface RouteMapProps {
  segments: readonly (readonly LatLon[])[];
  markers?: readonly MapMarker[];
  highlight?: LatLon | null;
  mapTheme: AnalysisMapTheme;
  height?: number;
  interactive?: boolean;
}

/** The map as the analysis views use it. This file is the only one in the folder that imports the map folder. */
export function RouteMap({ segments, markers, highlight, mapTheme, height = MAP_HEIGHT, interactive }: RouteMapProps) {
  const { palette, t, setScrubActive } = useAnalysisContext();
  const colors = useMemo(
    () => ({
      route: palette.mapRoute,
      routeCasing: palette.mapRouteCasing,
      start: palette.positive,
      finish: palette.negative,
      text: palette.text,
      surface: palette.surface,
    }),
    [palette],
  );
  return (
    <TileMap
      segments={segments}
      markers={markers}
      highlight={highlight}
      theme={mapTheme}
      colors={colors}
      height={height}
      interactive={interactive}
      onInteract={setScrubActive}
      a11yLabel={t('section.route')}
    />
  );
}

interface Props {
  analysis: WorkoutAnalysis;
  mapTheme: AnalysisMapTheme;
}

/** The route card of the full analysis: km markers, start and finish, and a ring that follows the shared scrubber. */
function MapSectionImpl({ analysis, mapTheme }: Props) {
  const { store } = useAnalysisContext();
  const series = analysis.series;
  const track = series?.track ?? null;

  const { segments, markers } = useMemo(() => {
    if (!series || !track) return { segments: [], markers: [] as MapMarker[] };
    const segs = trackSegments(track);
    const out: MapMarker[] = [];
    const first = segs[0]?.[0];
    const lastSeg = segs[segs.length - 1];
    const last = lastSeg?.[lastSeg.length - 1];
    for (const m of kmMarkers(series)) out.push({ pos: m.pos, kind: 'km', label: String(m.km) });
    if (first) out.push({ pos: first, kind: 'start' });
    if (last) out.push({ pos: last, kind: 'finish' });
    return { segments: segs, markers: out };
  }, [series, track]);

  const index = useScrubFrame(store);
  const highlight = index !== null && track ? (track[index] ?? null) : null;

  if (segments.length === 0) return null;
  return (
    <Card flush>
      <RouteMap segments={segments} markers={markers} highlight={highlight} mapTheme={mapTheme} />
    </Card>
  );
}

export const MapSection = memo(MapSectionImpl);
