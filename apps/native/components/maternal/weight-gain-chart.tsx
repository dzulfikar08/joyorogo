import { useQuery } from "@tanstack/react-query";
import { View, useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Circle, G, Line, Polygon, Polyline, Svg, Text as SvgText } from "react-native-svg";

import type { WeightGainChart as GainChart } from "@joyorogo/api/lib/maternal";
import { fmtDecimal } from "@joyorogo/i18n";

import { Button, Card, Num, Text } from "@/components/ui";
import { fmtInt, fmtKg } from "@/utils/format";
import { orpc } from "@/utils/orpc";

import { useMaternal } from "./use-maternal";

const PAD = { top: 14, right: 12, bottom: 38, left: 38 };
const WEEKS = 40;
const STEPS = [0.5, 1, 2, 2.5, 5, 10] as const;

/** Weekly gain chart of a pregnant user; null for everyone else. Shared cache key for Beranda's mini summary. */
export function usePregnancyChart() {
  const { mode } = useMaternal();
  return useQuery({
    ...orpc.weight.pregnancyChart.queryOptions(),
    enabled: mode === "pregnant",
  });
}

function signedKg(n: number): string {
  return `${n < 0 ? "−" : n > 0 ? "+" : ""}${fmtKg(Math.abs(n))}`;
}

/** "Naik 3,2 kg di minggu 18. Rentang minggu ini 2,5 sampai 4,1 kg." */
export function useGainLine(current: GainChart["current"] | undefined): string | null {
  const { t } = useTranslation("maternal");
  if (!current) return null;
  return t("gain.current", {
    gain: signedKg(current.gainKg),
    week: Math.floor(current.week),
    min: fmtKg(current.bandMinKg),
    max: fmtKg(current.bandMaxKg),
  });
}

function GainSvg({ chart }: { chart: GainChart }) {
  const { t } = useTranslation("maternal");
  const { theme } = useUnistyles();
  const { width: winW } = useWindowDimensions();
  // Screen (20) + Card (20) padding on each side, same as the weight chart.
  const w = Math.min(winW - 80, 400);
  const h = 220;
  const innerW = w - PAD.left - PAD.right;
  const innerH = h - PAD.top - PAD.bottom;

  const gains = chart.points.map((p) => p.gainKg);
  const dataHi = Math.max(...chart.band.map((b) => b.maxKg), ...gains);
  const dataLo = Math.min(0, ...chart.band.map((b) => b.minKg), ...gains);
  const step = STEPS.find((s) => (dataHi - dataLo) / s <= 6) ?? 10;
  const lo = Math.floor(dataLo / step) * step;
  const hi = Math.ceil(dataHi / step) * step;
  const x = (week: number) => PAD.left + (Math.min(Math.max(week, 0), WEEKS) / WEEKS) * innerW;
  const y = (kg: number) => PAD.top + (1 - (kg - lo) / (hi - lo)) * innerH;
  const yTicks = Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + i * step);
  const xTicks = [0, 8, 16, 24, 32, 40];
  const labelColor = theme.colors.mutedForeground;

  const upper = chart.band.map((b) => `${x(b.week)},${y(b.maxKg)}`);
  const lower = chart.band.map((b) => `${x(b.week)},${y(b.minKg)}`).reverse();
  const last = chart.points.length - 1;

  return (
    <Svg width={w} height={h} accessibilityLabel={t("gain.chartLabel")}>
      {yTicks.map((kg) => (
        <G key={kg}>
          <Line
            x1={PAD.left}
            x2={w - PAD.right}
            y1={y(kg)}
            y2={y(kg)}
            stroke={theme.colors.hairline}
            strokeWidth={1}
          />
          <SvgText x={PAD.left - 6} y={y(kg) + 3} textAnchor="end" fontSize={10} fill={labelColor}>
            {step < 1 ? fmtDecimal(kg, 1) : fmtInt(kg)}
          </SvgText>
        </G>
      ))}
      <Polygon points={[...upper, ...lower].join(" ")} fill={theme.colors.makan} fillOpacity={0.16} />
      <Polyline
        points={upper.join(" ")}
        stroke={theme.colors.makan}
        strokeOpacity={0.45}
        strokeWidth={1}
        fill="none"
      />
      <Polyline
        points={lower.join(" ")}
        stroke={theme.colors.makan}
        strokeOpacity={0.45}
        strokeWidth={1}
        fill="none"
      />
      {chart.points.length > 1 ? (
        <Polyline
          points={chart.points.map((p) => `${x(p.week)},${y(p.gainKg)}`).join(" ")}
          stroke={theme.colors.tidur}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          fill="none"
        />
      ) : null}
      {chart.points.map((p, i) => (
        <Circle
          key={p.date}
          cx={x(p.week)}
          cy={y(p.gainKg)}
          r={i === last ? 4.5 : 3}
          fill={theme.colors.tidur}
          fillOpacity={i === last ? 1 : 0.6}
        />
      ))}
      {xTicks.map((week, i) => (
        <SvgText
          key={week}
          x={x(week)}
          y={h - 22}
          textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
          fontSize={10}
          fill={labelColor}
        >
          {week}
        </SvgText>
      ))}
      <SvgText x={PAD.left + innerW / 2} y={h - 6} textAnchor="middle" fontSize={10} fill={labelColor}>
        {t("gain.axis.week")}
      </SvgText>
    </Svg>
  );
}

/**
 * Pregnancy weight-gain card for the weight page: IOM band by week with the
 * user's gain since the pre-pregnancy weight. No target line, no projection.
 */
export function WeightGainCard({ onWeighIn }: { onWeighIn: () => void }) {
  const { t } = useTranslation("maternal");
  const { theme } = useUnistyles();
  const { data: chart } = usePregnancyChart();
  const currentLine = useGainLine(chart?.current);
  if (!chart) return null;
  const { plan, current } = chart;
  const tone = current?.status === "within";

  return (
    <Card>
      <View style={styles.head}>
        <Text style={styles.title}>{t("gain.title")}</Text>
        <Text style={styles.sub}>{t("gain.subtitle")}</Text>
      </View>

      {current ? (
        <View style={[styles.status, { backgroundColor: tone ? theme.colors.makanSoft : theme.colors.muted }]}>
          <Num style={styles.statusLine}>{currentLine}</Num>
          <Text style={styles.statusBody}>{t(`gain.status.${current.status}`)}</Text>
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.sub}>{t("gain.empty")}</Text>
          <Button variant="secondary" label={t("gain.weighIn")} onPress={onWeighIn} />
        </View>
      )}

      <GainSvg chart={chart} />

      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendBand, { backgroundColor: theme.colors.makan }]} />
          <Text style={styles.legendText}>{t("gain.band")}</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { backgroundColor: theme.colors.tidur }]} />
          <Text style={styles.legendText}>{t("gain.you")}</Text>
        </View>
        <Text style={styles.legendText}>{t("gain.axis.kg")}</Text>
      </View>

      <View style={styles.facts}>
        <Text style={styles.fact}>{t("gain.preWeight", { kg: fmtKg(plan.prePregnancyWeightKg) })}</Text>
        <Text style={styles.fact}>
          {t("gain.bmi", {
            bmi: fmtKg(plan.bmi),
            category: t(`gain.category.${plan.category}`),
          })}
        </Text>
        <Text style={styles.fact}>
          {t(plan.twins ? "gain.totalTwins" : "gain.total", {
            min: fmtKg(plan.totalMinKg),
            max: fmtKg(plan.totalMaxKg),
          })}
        </Text>
        {plan.weeklyRateKg ? (
          <Text style={styles.fact}>
            {t("gain.rate", {
              min: fmtDecimal(plan.weeklyRateKg.minKg, 2),
              max: fmtDecimal(plan.weeklyRateKg.maxKg, 2),
            })}
          </Text>
        ) : null}
        {plan.borrowedRange ? <Text style={styles.fact}>{t("notes.TWINS_UNDERWEIGHT")}</Text> : null}
        <Text style={styles.source}>{t("gain.source")}</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  head: {
    gap: 2,
  },
  title: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  sub: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.mutedForeground,
  },
  status: {
    gap: 4,
    padding: theme.spacing.md,
    borderRadius: theme.radius.tile,
  },
  statusLine: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  statusBody: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.mutedForeground,
  },
  empty: {
    gap: theme.spacing.sm,
  },
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendBand: {
    width: 14,
    height: 10,
    borderRadius: 3,
    opacity: 0.3,
  },
  legendLine: {
    width: 14,
    height: 3,
    borderRadius: 2,
  },
  legendText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  facts: {
    gap: 4,
  },
  fact: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.foreground,
  },
  source: {
    fontSize: theme.fontSize.xs,
    lineHeight: 17,
    color: theme.colors.mutedForeground,
  },
}));
