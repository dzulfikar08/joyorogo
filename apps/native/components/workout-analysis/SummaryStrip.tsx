import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatDuration, formatPace, type WorkoutAnalysis } from '@joyorogo/api/lib/workout-analysis';
import { distanceParts, kcalPerHour } from './chartMath';
import { useAnalysisContext } from './context';
import { Card, Divider, Txt } from './primitives';

interface Cell {
  key: string;
  label: string;
  value: string;
  unit?: string;
  sub?: string;
}

function StatCell({ cell, big }: { cell: Cell; big: boolean }) {
  return (
    <View style={big ? styles.heroCell : styles.gridCell} accessible accessibilityLabel={`${cell.label} ${cell.value} ${cell.unit ?? ''} ${cell.sub ?? ''}`.trim()}>
      <Txt size={11} muted numberOfLines={1}>
        {cell.label}
      </Txt>
      <View style={styles.valueRow}>
        <Txt size={big ? 24 : 17} bold numberOfLines={1} fit>
          {cell.value}
        </Txt>
        {cell.unit ? (
          <Txt size={big ? 12 : 11} muted style={styles.unit}>
            {cell.unit}
          </Txt>
        ) : null}
      </View>
      {cell.sub ? (
        <Txt size={11} muted numberOfLines={1}>
          {cell.sub}
        </Txt>
      ) : null}
    </View>
  );
}

function SummaryStripImpl({ analysis }: { analysis: WorkoutAnalysis }) {
  const { t } = useAnalysisContext();
  const { stats, sport, distanceM, elapsedSec, movingSec, elevation, calories } = analysis;

  const hero: Cell[] = [];
  if (distanceM !== null && distanceM > 0) {
    const d = distanceParts(distanceM);
    hero.push({ key: 'distance', label: t('summary.distance'), value: d.value, unit: t(d.unit === 'km' ? 'unit.km' : 'unit.m') });
  }
  const paused = elapsedSec - movingSec > 5;
  hero.push({
    key: 'time',
    label: paused ? t('summary.movingTime') : t('summary.time'),
    value: formatDuration(paused ? movingSec : elapsedSec),
    sub: paused ? t('summary.elapsed', { time: formatDuration(elapsedSec) }) : undefined,
  });
  if ((sport.kind === 'run' || sport.kind === 'walk') && stats.avgPaceSecKm !== null) {
    hero.push({ key: 'pace', label: t('summary.avgPace'), value: formatPace(stats.avgPaceSecKm), unit: t('unit.perKm') });
  } else if (sport.kind === 'ride' && stats.avgSpeedMs !== null && stats.avgSpeedMs > 0) {
    hero.push({ key: 'speed', label: t('summary.avgSpeed'), value: (stats.avgSpeedMs * 3.6).toFixed(1), unit: t('unit.kmh') });
  }

  const grid: Cell[] = [];
  if (elevation) {
    grid.push({
      key: 'elevation',
      label: t('summary.elevation'),
      value: `+${Math.round(elevation.gainM)} / -${Math.round(elevation.lossM)}`,
      unit: t('unit.m'),
    });
  }
  if (calories) {
    const perHour = kcalPerHour(calories.kcal, elapsedSec);
    grid.push({
      key: 'calories',
      label: t('summary.calories'),
      value: String(Math.round(calories.kcal)),
      unit: t('unit.kcal'),
      sub: perHour !== null ? `${perHour} ${t('unit.kcalPerHour')}` : undefined,
    });
  }
  if (stats.avgHr !== null) {
    grid.push({
      key: 'hr',
      label: t('summary.heartRate'),
      value: String(Math.round(stats.avgHr)),
      unit: t('unit.bpm'),
      sub: stats.maxHr !== null ? t('summary.maxHr', { value: Math.round(stats.maxHr) }) : undefined,
    });
  }
  if (stats.avgCad !== null) {
    grid.push({
      key: 'cad',
      label: t('summary.cadence'),
      value: String(Math.round(stats.avgCad)),
      unit: t(sport.kind === 'ride' ? 'unit.rpm' : 'unit.spm'),
      sub: stats.maxCad !== null ? t('summary.maxCadence', { value: Math.round(stats.maxCad) }) : undefined,
    });
  }
  if (stats.avgPower !== null) {
    grid.push({
      key: 'power',
      label: t('summary.power'),
      value: String(Math.round(stats.avgPower)),
      unit: t('unit.w'),
      sub: stats.normalizedPower !== null ? t('summary.normalizedPower', { value: Math.round(stats.normalizedPower) }) : undefined,
    });
  }

  const fuel: string[] = [];
  if (calories?.fatG != null) fuel.push(t('summary.fat', { value: Math.round(calories.fatG) }));
  if (calories?.carbG != null) fuel.push(t('summary.carbs', { value: Math.round(calories.carbG) }));

  return (
    <Card a11yLabel={t('summary.a11y')}>
      <View style={styles.heroRow}>
        {hero.map((cell) => (
          <StatCell key={cell.key} cell={cell} big />
        ))}
      </View>
      {grid.length > 0 ? (
        <>
          <Divider />
          <View style={styles.grid}>
            {grid.map((cell) => (
              <StatCell key={cell.key} cell={cell} big={false} />
            ))}
          </View>
        </>
      ) : null}
      {fuel.length > 0 ? (
        <Txt size={12} muted style={styles.fuel}>
          {`${t('summary.fuel')}: ${fuel.join(', ')}`}
        </Txt>
      ) : null}
    </Card>
  );
}

export const SummaryStrip = memo(SummaryStripImpl);

const styles = StyleSheet.create({
  heroRow: { flexDirection: 'row', gap: 12 },
  heroCell: { flex: 1, minWidth: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12, marginTop: 4 },
  gridCell: { width: '50%', paddingRight: 8, minWidth: 0 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  unit: { flexShrink: 0 },
  fuel: { marginTop: 12 },
});
