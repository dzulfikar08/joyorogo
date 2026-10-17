import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatDuration, formatPace, type PaceZoneKey, type WorkoutAnalysis } from '@joyorogo/api/lib/workout-analysis';
import { shares } from './chartMath';
import { useAnalysisContext } from './context';
import { Bar, Card, Note, Txt } from './primitives';
import type { AnalysisTextKey } from './text';

const ZONE_NAME: Record<PaceZoneKey, AnalysisTextKey> = {
  recovery: 'zone.recovery',
  endurance: 'zone.endurance',
  tempo: 'zone.tempo',
  threshold: 'zone.threshold',
  vo2: 'zone.vo2',
};

const HR_ZONE_KEYS: readonly PaceZoneKey[] = ['recovery', 'endurance', 'tempo', 'threshold', 'vo2'];

interface ZoneRowProps {
  n: number;
  name: string;
  range: string;
  sec: number;
  share: number;
  color: string;
}

function ZoneRow({ n, name, range, sec, share, color }: ZoneRowProps) {
  const { t } = useAnalysisContext();
  const time = formatDuration(sec);
  const percent = Math.round(share * 100);
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={t('zones.a11yRow', { n, name, range, time, percent })}
    >
      <View style={styles.rowHead}>
        <View style={styles.rowName}>
          <Txt size={13} bold numberOfLines={1}>
            {t('zones.zoneLabel', { n, name })}
          </Txt>
          <Txt size={11} muted numberOfLines={1}>
            {range}
          </Txt>
        </View>
        <View style={styles.rowValue}>
          <Txt size={13} bold align="right">
            {time}
          </Txt>
          <Txt size={11} muted align="right">
            {`${percent}%`}
          </Txt>
        </View>
      </View>
      <Bar fraction={share} color={color} />
    </View>
  );
}

function HrZonesCardImpl({ analysis }: { analysis: WorkoutAnalysis }) {
  const { palette, t } = useAnalysisContext();
  const zones = analysis.hrZones;
  if (!zones) return null;
  const fractions = shares(zones.sec);
  return (
    <Card title={t('section.hrZones')}>
      <Txt size={12} muted style={styles.lead}>
        {t(zones.source === 'age' ? 'zones.maxHrAge' : 'zones.maxHrSetting', { value: zones.maxHr })}
      </Txt>
      {HR_ZONE_KEYS.map((key, i) => (
        <ZoneRow
          key={key}
          n={i + 1}
          name={t(ZONE_NAME[key])}
          range={`${zones.bounds[i]}-${zones.bounds[i + 1]} ${t('unit.bpm')}`}
          sec={zones.sec[i] ?? 0}
          share={fractions[i] ?? 0}
          color={palette.zones[i]!}
        />
      ))}
      {zones.belowSec > 0 ? (
        <Txt size={12} muted style={styles.below}>
          {t('zones.below', { time: formatDuration(zones.belowSec) })}
        </Txt>
      ) : null}
      <Note>{t('zones.hrNote')}</Note>
    </Card>
  );
}

function PaceZonesCardImpl({ analysis }: { analysis: WorkoutAnalysis }) {
  const { palette, t } = useAnalysisContext();
  const zones = analysis.paceZones;
  if (!zones) return null;
  const fractions = shares(zones.zones.map((z) => z.sec));
  return (
    <Card title={t('section.paceZones')}>
      <Txt size={12} muted style={styles.lead}>
        {t('zones.thresholdPace', { pace: formatPace(zones.thresholdSecKm) })}
      </Txt>
      {zones.zones.map((z, i) => {
        const range =
          z.fromSecKm === null
            ? t('zones.slowerThan', { pace: formatPace(z.toSecKm) })
            : z.toSecKm === null
              ? t('zones.fasterThan', { pace: formatPace(z.fromSecKm) })
              : `${formatPace(z.fromSecKm)}-${formatPace(z.toSecKm)} ${t('unit.perKm')}`;
        return (
          <ZoneRow
            key={z.key}
            n={i + 1}
            name={t(ZONE_NAME[z.key])}
            range={range}
            sec={z.sec}
            share={fractions[i] ?? 0}
            color={palette.zones[i]!}
          />
        );
      })}
      <Note>{t('note.threshold')}</Note>
    </Card>
  );
}

export const HrZonesCard = memo(HrZonesCardImpl);
export const PaceZonesCard = memo(PaceZonesCardImpl);

const styles = StyleSheet.create({
  lead: { marginBottom: 10 },
  row: { marginBottom: 12, gap: 6 },
  rowHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 },
  rowName: { flex: 1, minWidth: 0 },
  rowValue: { flexShrink: 0 },
  below: { marginBottom: 2 },
});
