import { useMutation } from "@tanstack/react-query";
import { CollapsibleNotice } from "@/components/collapsible-notice";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import type { DatePace } from "@joyorogo/api/lib/engine";

import { useToast } from "@/components/toast";
import { Button, Text } from "@/components/ui";
import { errorMessage, fmtDateMedium, fmtKg } from "@/utils/format";
import { client, orpc, queryClient } from "@/utils/orpc";

/**
 * The stored target date asks for more than the safe pace allows (the plan quietly
 * follows the clamp instead). Says so, with the date the safe pace really reaches and
 * a one-tap switch to it. Renders nothing when the date is reachable.
 */
export function TargetPaceNotice({ pace }: { pace: DatePace | null | undefined }) {
  const { t } = useTranslation("settings");
  const toast = useToast();
  const apply = useMutation({
    mutationFn: (next: DatePace) =>
      client.profile.updateTargets({
        targetWeightKg: next.targetWeightKg,
        targetDate: next.reachDate,
        goal: next.direction,
      }),
    onSuccess: () => {
      toast.success(t("plan.datePace.saved"));
      void queryClient.invalidateQueries({ queryKey: orpc.profile.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.day.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.weight.key() });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  if (!pace) return null;
  const date = fmtDateMedium(pace.reachDate);
  return (
    <CollapsibleNotice
      id="targetPace"
      tone="warn"
      icon="calendar-outline"
      title={t(pace.reason === "passed" ? "plan.datePace.passed.title" : "plan.datePace.title")}
    >
      <Text style={styles.body}>
        {t(`plan.datePace.${pace.reason === "passed" ? "passed." : ""}${pace.direction}.body`, {
          kg: fmtKg(pace.kg),
          count: pace.feasibleDays,
          date,
        })}
      </Text>
      <Button
        variant="secondary"
        size="sm"
        label={t("plan.datePace.use", { date })}
        loading={apply.isPending}
        onPress={() => apply.mutate(pace)}
        style={styles.action}
      />
    </CollapsibleNotice>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
  action: {
    alignSelf: "flex-start",
  },
}));
