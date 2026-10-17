import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { BEST_EFFORT_DISTANCES, formatDuration, formatPace, type BestEffortKey, type WorkoutAnalysis } from '@joyorogo/api/lib/workout-analysis';
import { rankBadge } from './chartMath';
import { useAnalysisContext } from './context';
import { Card, Chip, MIN_HIT, Note, Txt } from './primitives';
import type { AnalysisTextKey } from './text';

const LABEL: Record<BestEffortKey, AnalysisTextKey> = {
  '400m': 'best.400m',
  '1k': 'best.1k',
  '1mi': 'best.1mi',
  '5k': 'best.5k',
  '10k': 'best.10k',
  half: 'best.half',
};

function BestEffortsCardImpl({ analysis }: { analysis: WorkoutAnalysis }) {
  const { palette, t } = useAnalysisContext();
  const efforts = analysis.bestEfforts;
  if (efforts.length === 0) return null;
  return (
    <Card title={t('section.bestEfforts')}>
      {efforts.map((e) => {
        const label = t(LABEL[e.key]);
        const time = formatDuration(e.sec);
        const pace = formatPace((e.sec / BEST_EFFORT_DISTANCES[e.key]) * 1000);
        const badge = rankBadge(e.rank);
        return (
          <View
            key={e.key}
            style={styles.row}
            accessible
            accessibilityLabel={`${t('best.a11yRow', { label, time, pace })}${e.rank !== null && badge ? `, ${t('best.a11yRank', { rank: e.rank })}` : ''}`}
          >
            <View style={styles.label}>
              <Txt size={14} bold>
                {label}
              </Txt>
            </View>
            <View style={styles.badgeCell}>
              {badge === 'pr' ? (
                <View style={styles.pr}>
                  <Ionicons name="trophy" size={13} color={palette.power} />
                  <Chip label={t('best.pr')} color={palette.power} filled labelColor={palette.isDark ? '#1A1200' : '#FFFFFF'} />
                </View>
              ) : badge ? (
                <Chip label={t(badge === '2nd' ? 'best.2nd' : 'best.3rd')} color={palette.textMuted} />
              ) : null}
            </View>
            <View style={styles.time}>
              <Txt size={14} bold align="right">
                {time}
              </Txt>
              <Txt size={11} muted align="right">
                {`${pace} ${t('unit.perKm')}`}
              </Txt>
            </View>
          </View>
        );
      })}
      <Note>{t('best.note')}</Note>
    </Card>
  );
}

export const BestEffortsCard = memo(BestEffortsCardImpl);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_HIT, gap: 8 },
  label: { flex: 1, minWidth: 0 },
  badgeCell: { width: 76, alignItems: 'flex-start' },
  pr: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  time: { width: 76 },
});
