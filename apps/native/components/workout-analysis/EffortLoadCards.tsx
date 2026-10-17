import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import type { EffortBand, WorkoutAnalysis } from '@joyorogo/api/lib/workout-analysis';
import { loadBarFractions, loadVerdict, strainFraction, type LoadVerdict } from './chartMath';
import { useAnalysisContext } from './context';
import { Bar, Card, Chip, Note, Txt } from './primitives';
import type { AnalysisPalette } from './theme';

const RING = 104;
const STROKE = 11;

function bandColor(palette: AnalysisPalette, band: EffortBand): string {
  const index = { light: 1, moderate: 2, hard: 3, max: 4 }[band];
  return palette.zones[index]!;
}

function verdictColor(palette: AnalysisPalette, verdict: LoadVerdict): string {
  return { under: palette.zones[0], steady: palette.positive, high: palette.zones[3], spike: palette.negative }[verdict];
}

const VERDICT_ICON: Record<LoadVerdict, keyof typeof Ionicons.glyphMap> = {
  under: 'trending-down',
  steady: 'remove',
  high: 'trending-up',
  spike: 'warning',
};

function EffortCardImpl({ analysis }: { analysis: WorkoutAnalysis }) {
  const { palette, t } = useAnalysisContext();
  const effort = analysis.effort;
  if (!effort) return null;
  const color = bandColor(palette, effort.band);
  const radius = (RING - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * strainFraction(effort.strain);
  const band = t(`effort.band.${effort.band}`);
  return (
    <Card title={t('section.effort')}>
      <View style={styles.effortRow}>
        <View
          style={styles.ring}
          accessible
          accessibilityRole="image"
          accessibilityLabel={t('effort.a11y', { value: effort.strain.toFixed(1), band })}
        >
          <Svg width={RING} height={RING}>
            <Circle cx={RING / 2} cy={RING / 2} r={radius} stroke={palette.surfaceAlt} strokeWidth={STROKE} fill="none" />
            <Circle
              cx={RING / 2}
              cy={RING / 2}
              r={radius}
              stroke={color}
              strokeWidth={STROKE}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              rotation={-90}
              origin={`${RING / 2}, ${RING / 2}`}
            />
          </Svg>
          <View style={styles.ringCenter} pointerEvents="none">
            <Txt size={26} bold align="center">
              {effort.strain.toFixed(1)}
            </Txt>
            <Txt size={11} muted align="center">
              {t('effort.outOf')}
            </Txt>
          </View>
        </View>
        <View style={styles.effortText}>
          <Chip label={band} color={color} filled labelColor={palette.isDark ? '#14100A' : '#FFFFFF'} />
          {effort.addedToDay !== null ? (
            <Txt size={15} bold style={styles.added}>
              {t('effort.addedToDay', { value: effort.addedToDay.toFixed(1) })}
            </Txt>
          ) : null}
          <Txt size={12} muted style={styles.added}>
            {t('effort.explain', { trimp: Math.round(effort.trimp) })}
          </Txt>
        </View>
      </View>
      <Note>{t('note.effort')}</Note>
    </Card>
  );
}

interface LoadBarProps {
  label: string;
  value: string;
  fraction: number;
  color: string;
}

function LoadBar({ label, value, fraction, color }: LoadBarProps) {
  return (
    <View style={styles.loadBar} accessible accessibilityLabel={`${label} ${value}`}>
      <View style={styles.loadHead}>
        <Txt size={13}>{label}</Txt>
        <Txt size={13} bold>
          {value}
        </Txt>
      </View>
      <Bar fraction={fraction} color={color} height={10} />
    </View>
  );
}

function LoadCardImpl({ analysis }: { analysis: WorkoutAnalysis }) {
  const { palette, t } = useAnalysisContext();
  const load = analysis.load;
  if (!load) return null;
  const hasChronic = load.chronicWeekly > 0;
  const bars = loadBarFractions(load.acute, load.chronicWeekly);
  const verdict = load.ratio !== null ? loadVerdict(load.ratio) : null;
  const color = verdict ? verdictColor(palette, verdict) : palette.accent;

  const extras: { key: string; label: string; value: string }[] = [];
  if (load.aerobicEffect !== null) extras.push({ key: 'aerobic', label: t('load.aerobic'), value: load.aerobicEffect.toFixed(1) });
  if (load.anaerobicEffect !== null) extras.push({ key: 'anaerobic', label: t('load.anaerobic'), value: load.anaerobicEffect.toFixed(1) });
  if (load.recoveryHours !== null) extras.push({ key: 'recovery', label: t('load.recovery'), value: t('load.recoveryHours', { value: Math.round(load.recoveryHours) }) });
  if (load.watchLoad !== null) extras.push({ key: 'watch', label: t('load.watchLoad'), value: String(Math.round(load.watchLoad)) });

  return (
    <Card title={t('section.load')}>
      <View style={styles.loadTop}>
        <View
          accessible
          accessibilityLabel={`${t('load.thisWorkout')} ${t('load.trimp')} ${Math.round(load.trimp)}`}
        >
          <Txt size={11} muted>
            {t('load.thisWorkout')}
          </Txt>
          <View style={styles.trimpRow}>
            <Txt size={26} bold>
              {Math.round(load.trimp)}
            </Txt>
            <Txt size={12} muted>
              {t('load.trimp')}
            </Txt>
          </View>
        </View>
        {verdict ? (
          <View style={[styles.verdict, { backgroundColor: color }]} accessible accessibilityLabel={t('load.a11y', { verdict: t(`load.verdict.${verdict}`) })}>
            <Ionicons name={VERDICT_ICON[verdict]} size={16} color={palette.isDark ? '#14100A' : '#FFFFFF'} />
            <Txt size={13} bold color={palette.isDark ? '#14100A' : '#FFFFFF'}>
              {t(`load.verdict.${verdict}`)}
            </Txt>
          </View>
        ) : null}
      </View>
      {hasChronic ? (
        <View style={styles.bars}>
          <LoadBar label={t('load.last7')} value={String(Math.round(load.acute))} fraction={bars.acute} color={color} />
          <LoadBar label={t('load.weeklyAverage')} value={String(Math.round(load.chronicWeekly))} fraction={bars.chronic} color={palette.textMuted} />
        </View>
      ) : null}
      {verdict && load.ratio !== null ? (
        <Txt size={12} muted style={styles.verdictText}>
          {`${t(`load.verdictText.${verdict}`)} ${t('load.ratio', { percent: Math.round(load.ratio * 100) })}`}
        </Txt>
      ) : null}
      {extras.length > 0 ? (
        <View style={styles.extras}>
          {extras.map((e) => (
            <View key={e.key} style={styles.extra} accessible accessibilityLabel={`${e.label} ${e.value}`}>
              <Txt size={11} muted numberOfLines={1}>
                {e.label}
              </Txt>
              <Txt size={17} bold>
                {e.value}
              </Txt>
            </View>
          ))}
        </View>
      ) : null}
      <Note>{t('note.load')}</Note>
    </Card>
  );
}

export const EffortCard = memo(EffortCardImpl);
export const LoadCard = memo(LoadCardImpl);

const styles = StyleSheet.create({
  effortRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  ring: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ringCenter: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  effortText: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  added: { marginTop: 8 },
  loadTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  trimpRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  verdict: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  bars: { gap: 12, marginTop: 14 },
  loadBar: { gap: 6 },
  loadHead: { flexDirection: 'row', justifyContent: 'space-between' },
  verdictText: { marginTop: 10 },
  extras: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12, marginTop: 14 },
  extra: { width: '50%', paddingRight: 8 },
});
