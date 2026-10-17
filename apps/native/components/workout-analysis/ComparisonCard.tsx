import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatDuration, formatPace, type WorkoutAnalysis } from '@joyorogo/api/lib/workout-analysis';
import { comparisonAverage, difference, formatShortDate, signedDuration, signedNumber, speedKmhFromPace } from './chartMath';
import { useAnalysisContext } from './context';
import { Card, Divider, Note, Txt } from './primitives';

interface Row {
  key: string;
  label: string;
  distM: number | null;
  sec: number | null;
  paceSecKm: number | null;
  avgHr: number | null;
}

const FLEX = { label: 1.5, value: 1 };

function ComparisonCardImpl({ analysis }: { analysis: WorkoutAnalysis }) {
  const { palette, t } = useAnalysisContext();
  const comparison = analysis.comparison;
  if (!comparison || comparison.items.length === 0) return null;
  const speed = analysis.sport.kind === 'ride';
  const items = comparison.items;
  const avg = comparisonAverage(items)!;
  const current: Row = {
    key: 'now',
    label: t('compare.thisWorkout'),
    distM: analysis.distanceM,
    sec: analysis.movingSec,
    paceSecKm: analysis.stats.avgPaceSecKm,
    avgHr: analysis.stats.avgHr,
  };
  const previous: Row = { key: 'prev', label: `${t('compare.previous')} ${formatShortDate(items[0]!.startedAt)}`, ...pick(items[0]!) };
  const average: Row = { key: 'avg', label: t('compare.average', { n: items.length }), ...pick(avg) };
  const showDist = current.distM !== null && items.some((i) => i.distM !== null);
  const showPace = current.paceSecKm !== null && items.some((i) => i.paceSecKm !== null);
  const showHr = current.avgHr !== null && items.some((i) => i.avgHr !== null);

  const paceText = (p: number | null) => (speed ? (speedKmhFromPace(p)?.toFixed(1) ?? '--') : formatPace(p));
  const cell = (flex: number, text: string, opts?: { bold?: boolean; color?: string; muted?: boolean }) => (
    <View style={{ flex, minWidth: 0 }}>
      <Txt size={12} bold={opts?.bold} muted={opts?.muted} color={opts?.color} align="right" numberOfLines={1} fit>
        {text}
      </Txt>
    </View>
  );
  const valueRow = (r: Row, bold: boolean) => (
    <View key={r.key} style={styles.row}>
      <View style={{ flex: FLEX.label, minWidth: 0 }}>
        <Txt size={12} bold={bold} numberOfLines={1}>
          {r.label}
        </Txt>
      </View>
      {showDist ? cell(FLEX.value, r.distM !== null ? `${(r.distM / 1000).toFixed(2)}` : '--', { bold }) : null}
      {cell(FLEX.value, r.sec !== null ? formatDuration(r.sec) : '--', { bold })}
      {showPace ? cell(FLEX.value, paceText(r.paceSecKm), { bold }) : null}
      {showHr ? cell(FLEX.value, r.avgHr !== null ? String(Math.round(r.avgHr)) : '--', { bold }) : null}
    </View>
  );
  const deltaRow = (key: string, label: string, ref: Row) => {
    const dDist = difference(current.distM, ref.distM);
    const dPace = speed ? difference(speedKmhFromPace(current.paceSecKm), speedKmhFromPace(ref.paceSecKm)) : difference(current.paceSecKm, ref.paceSecKm);
    const better = dPace === null || Math.round(dPace * 10) === 0 ? undefined : (speed ? dPace > 0 : dPace < 0) ? palette.positive : palette.negative;
    const dHr = difference(current.avgHr, ref.avgHr);
    const dSec = difference(current.sec, ref.sec);
    return (
      <View key={key} style={styles.row}>
        <View style={{ flex: FLEX.label, minWidth: 0 }}>
          <Txt size={12} muted numberOfLines={1}>
            {label}
          </Txt>
        </View>
        {showDist ? cell(FLEX.value, dDist !== null ? signedNumber(dDist / 1000, 2) : '--', { muted: true }) : null}
        {cell(FLEX.value, dSec !== null ? signedDuration(dSec) : '--', { muted: true })}
        {showPace ? cell(FLEX.value, dPace !== null ? (speed ? signedNumber(dPace, 1) : signedDuration(dPace)) : '--', { color: better, bold: better !== undefined, muted: better === undefined }) : null}
        {showHr ? cell(FLEX.value, dHr !== null ? signedNumber(dHr, 0) : '--', { muted: true }) : null}
      </View>
    );
  };

  const n = items.length;
  const basisKey =
    comparison.basis === 'distance'
      ? n === 1
        ? 'compare.basisDistanceOne'
        : 'compare.basisDistance'
      : n === 1
        ? 'compare.basisDurationOne'
        : 'compare.basisDuration';

  return (
    <Card title={t('section.comparison')}>
      <View style={styles.row}>
        <View style={{ flex: FLEX.label }} />
        {showDist ? cell(FLEX.value, `${t('compare.dist')} ${t('unit.km')}`, { muted: true }) : null}
        {cell(FLEX.value, t('compare.time'), { muted: true })}
        {showPace ? cell(FLEX.value, t(speed ? 'compare.speed' : 'compare.pace'), { muted: true }) : null}
        {showHr ? cell(FLEX.value, t('compare.hr'), { muted: true }) : null}
      </View>
      <Divider />
      {valueRow(current, true)}
      {valueRow(previous, false)}
      {n > 1 ? valueRow(average, false) : null}
      <Divider />
      {deltaRow('dprev', t('compare.vsPrevious'), previous)}
      {n > 1 ? deltaRow('davg', t('compare.vsAverage'), average) : null}
      <Note>{t(basisKey, { n })}</Note>
    </Card>
  );
}

function pick(i: { distM: number | null; sec: number; paceSecKm: number | null; avgHr: number | null }) {
  return { distM: i.distM, sec: i.sec, paceSecKm: i.paceSecKm, avgHr: i.avgHr };
}

export const ComparisonCard = memo(ComparisonCardImpl);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 30, gap: 4 },
});
