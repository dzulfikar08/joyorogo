import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { weekdayName } from "@joyorogo/api/lib/recap";
import type { DayView } from "@joyorogo/api/lib/meal/view";
import { fmtDateShort } from "@joyorogo/i18n";

import { Button, ListGroup, ListRow, Sheet, Text } from "@/components/ui";

import { useMealPlanMutations } from "./use-meal-plan";

type Scope = "day" | "week";

function RegenBody({ day, onClose }: { day: DayView | null; onClose: () => void }) {
  const { t } = useTranslation("mealPlan");
  const { generate, replanDay } = useMealPlanMutations();
  const [scope, setScope] = useState<Scope | null>(null);
  const dayName = day ? `${weekdayName(day.date)}, ${fmtDateShort(day.date)}` : "";

  if (scope === null) {
    return (
      <ListGroup>
        {day ? (
          <ListRow
            icon="today"
            title={day.isToday ? t("regen.day") : t("native.regenDayOf", { day: dayName })}
            chevron
            onPress={() => setScope("day")}
          />
        ) : null}
        <ListRow icon="calendar" title={t("regen.week")} chevron onPress={() => setScope("week")} />
      </ListGroup>
    );
  }

  const pending = generate.isPending || replanDay.isPending;
  const confirm = () => {
    if (scope === "day" && day) replanDay.mutate({ date: day.date }, { onSuccess: onClose });
    else generate.mutate({ regenerate: true }, { onSuccess: onClose });
  };
  const body =
    scope === "week" ? t("regen.bodyWeek") : day?.isToday ? t("regen.bodyDay") : t("native.regenDayBody", { day: dayName });

  return (
    <>
      <Text style={styles.body}>{body}</Text>
      <View style={styles.buttons}>
        <Button variant="secondary" label={t("regen.cancel")} disabled={pending} onPress={onClose} style={styles.button} />
        <Button
          label={pending ? t("regen.working") : t("regen.confirm")}
          loading={pending}
          onPress={confirm}
          style={styles.button}
        />
      </View>
    </>
  );
}

/**
 * "Susun ulang": pick the shown day or the week, then confirm, since the open meals are replaced.
 * `day` is null when the shown day is already past (nothing left to plan).
 */
export function RegenSheet({ open, day, onClose }: { open: boolean; day: DayView | null; onClose: () => void }) {
  const { t } = useTranslation("mealPlan");
  return (
    <Sheet visible={open} onClose={onClose} title={t("regen.title")}>
      {open ? <RegenBody day={day} onClose={onClose} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    fontSize: theme.fontSize.base,
    lineHeight: 22,
    color: theme.colors.mutedForeground,
  },
  buttons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  button: {
    flexGrow: 1,
    flexBasis: 120,
  },
}));
