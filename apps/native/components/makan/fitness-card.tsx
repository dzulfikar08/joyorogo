import { useQuery } from "@tanstack/react-query";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { READINESS_ID, fitnessHints, hasFitnessData } from "@joyorogo/api/lib/fitness-hint";

import { Card, Num, Text } from "@/components/ui";
import { orpc } from "@/utils/orpc";

/**
 * Recovery, strain and sleep of the day from JoyoFit (the Huawei watch app),
 * with a short food hint. Renders nothing for a day JoyoFit pushed no scores
 * for, and nothing while loading or when the request fails: it is an extra,
 * not part of the diary.
 */
export function FitnessCard({ date }: { date: string }) {
  const { data } = useQuery(orpc.fitness.byDate.queryOptions({ input: { date } }));
  if (!hasFitnessData(data)) return null;
  const hints = fitnessHints(data);

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>Kebugaran dari JoyoFit</Text>
        {data.readiness ? <Text style={styles.readiness}>{READINESS_ID[data.readiness]}</Text> : null}
      </View>
      <View style={styles.row}>
        <Metric label="Pemulihan" value={data.recoveryPct === null ? null : `${data.recoveryPct}%`} />
        <Metric label="Strain" value={data.strain === null ? null : `${data.strain.toFixed(1)} / 21`} />
        <Metric label="Tidur" value={data.sleepPct === null ? null : `${data.sleepPct}%`} />
      </View>
      {hints.map((hint) => (
        <Text key={hint} style={styles.hint}>
          {hint}
        </Text>
      ))}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.metric}>
      <Num style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
        {value ?? "-"}
      </Num>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    gap: theme.spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  title: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  readiness: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.tidurText,
  },
  row: {
    flexDirection: "row",
    gap: theme.spacing.md,
  },
  metric: {
    flex: 1,
    gap: 2,
  },
  value: {
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
  },
  label: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  hint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
}));
