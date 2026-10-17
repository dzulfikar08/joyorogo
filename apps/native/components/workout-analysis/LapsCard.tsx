import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatDistance, formatDuration, formatPace, type WorkoutAnalysis } from '@joyorogo/api/lib/workout-analysis';
import { speedKmhFromPace } from './chartMath';
import { useAnalysisContext } from './context';
import { Card, Txt } from './primitives';

const FLEX = { lap: 0.7, time: 1.2, dist: 1.3, pace: 1, hr: 1.2, cad: 0.9 };

function LapsCardImpl({ analysis }: { analysis: WorkoutAnalysis }) {
  const { palette, t } = useAnalysisContext();
  const laps = analysis.laps;
  if (laps.length < 2) return null;
  const speed = analysis.sport.kind === 'ride';
  const show = {
    dist: laps.some((l) => l.distM !== null),
    pace: laps.some((l) => l.paceSecKm !== null),
    hr: laps.some((l) => l.avgHr !== null),
    cad: laps.some((l) => l.avgCad !== null),
  };
  const head = (flex: number, label: string, align: 'left' | 'right' = 'right') => (
    <View style={{ flex, minWidth: 0 }}>
      <Txt size={11} muted align={align}>
        {label}
      </Txt>
    </View>
  );
  return (
    <Card title={t('section.laps')}>
      <View style={styles.row}>
        {head(FLEX.lap, t('laps.lap'), 'left')}
        {head(FLEX.time, t('laps.time'))}
        {show.dist ? head(FLEX.dist, t('laps.dist')) : null}
        {show.pace ? head(FLEX.pace, t(speed ? 'laps.speed' : 'laps.pace')) : null}
        {show.hr ? head(FLEX.hr, t('laps.hr')) : null}
        {show.cad ? head(FLEX.cad, t('laps.cad')) : null}
      </View>
      <View style={[styles.rule, { backgroundColor: palette.border }]} />
      {laps.map((lap) => {
        const kmh = speedKmhFromPace(lap.paceSecKm);
        return (
          <View key={lap.n} style={styles.row} accessible accessibilityLabel={`${t('laps.lap')} ${lap.n}, ${formatDuration(lap.sec)}`}>
            <View style={{ flex: FLEX.lap, minWidth: 0 }}>
              <Txt size={13} bold>
                {lap.n}
              </Txt>
            </View>
            <View style={{ flex: FLEX.time, minWidth: 0 }}>
              <Txt size={12} align="right" numberOfLines={1} fit>
                {formatDuration(lap.sec)}
              </Txt>
            </View>
            {show.dist ? (
              <View style={{ flex: FLEX.dist, minWidth: 0 }}>
                <Txt size={12} align="right" numberOfLines={1} fit>
                  {lap.distM !== null ? formatDistance(lap.distM) : '--'}
                </Txt>
              </View>
            ) : null}
            {show.pace ? (
              <View style={{ flex: FLEX.pace, minWidth: 0 }}>
                <Txt size={12} align="right">
                  {speed ? (kmh !== null ? kmh.toFixed(1) : '--') : formatPace(lap.paceSecKm)}
                </Txt>
              </View>
            ) : null}
            {show.hr ? (
              <View style={{ flex: FLEX.hr, minWidth: 0 }}>
                <Txt size={12} align="right" numberOfLines={1} fit>
                  {lap.avgHr !== null ? `${Math.round(lap.avgHr)}${lap.maxHr !== null ? ` / ${Math.round(lap.maxHr)}` : ''}` : '--'}
                </Txt>
              </View>
            ) : null}
            {show.cad ? (
              <View style={{ flex: FLEX.cad, minWidth: 0 }}>
                <Txt size={12} muted align="right">
                  {lap.avgCad !== null ? Math.round(lap.avgCad) : '--'}
                </Txt>
              </View>
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}

export const LapsCard = memo(LapsCardImpl);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 36, gap: 6 },
  rule: { height: StyleSheet.hairlineWidth, marginBottom: 2 },
});
