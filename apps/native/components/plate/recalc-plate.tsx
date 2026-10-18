import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Button, Sheet, Text } from "@/components/ui";
import { useToast } from "@/components/toast";
import { client, orpc, queryClient } from "@/utils/orpc";
import { fmtGramsLabel, fmtInt, fmtKcalLabel } from "@/utils/format";

/**
 * "Hitung ulang kalori" for one plate. The server previews which AI rows would
 * change (food.recalculatePlate without `apply`); `changes` is empty when there
 * is nothing to fix, which hides the action. `save` writes exactly that preview.
 */
export function useRecalcPlate(plateId: string, onSaved: () => void) {
  const { t } = useTranslation("makan");
  const toast = useToast();
  const preview = useQuery(orpc.food.recalculatePlate.queryOptions({ input: { plateId } }));
  const apply = useMutation({
    mutationFn: () => client.food.recalculatePlate({ plateId, apply: true }),
    onSuccess: () => {
      onSaved();
      toast.success(t("plate.recalc.done"));
    },
    onError: () => toast.error(t("plate.recalc.error")),
    onSettled: () => {
      for (const key of [orpc.food.key(), orpc.plate.key(), orpc.day.key(), orpc.diary.key()]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
  return { data: preview.data, saving: apply.isPending, save: () => apply.mutate() };
}

type RecalcPreview = NonNullable<ReturnType<typeof useRecalcPlate>["data"]>;

/** Preview of the recalculation: per item old → new kcal, then the plate total. Simpan writes it. */
export function RecalcSheet({
  visible,
  data,
  saving,
  onSave,
  onClose,
}: {
  visible: boolean;
  data: RecalcPreview;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation(["makan", "common"]);
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t("plate.recalc.title")}
      footer={
        <View style={styles.footer}>
          <Button
            variant="ghost"
            label={t("common:actions.cancel")}
            onPress={onClose}
            style={styles.footerBtn}
          />
          <Button
            label={t("common:actions.save")}
            onPress={onSave}
            loading={saving}
            style={styles.footerBtn}
          />
        </View>
      }
    >
      <View style={styles.body}>
        <Text style={styles.hint}>{t("plate.recalc.description")}</Text>
        {data.items.map((item) => (
          <View key={item.id} style={styles.row}>
            <View style={styles.rowName}>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              {item.grams !== null ? (
                <Text style={styles.hint}>{fmtGramsLabel(item.grams)}</Text>
              ) : null}
            </View>
            <Text style={styles.change}>
              {t("plate.recalc.change", {
                from: fmtInt(item.before.kcal),
                to: fmtInt(item.after.kcal),
              })}
            </Text>
          </View>
        ))}
        <View style={[styles.row, styles.total]}>
          <Text style={styles.name}>{t("plate.recalc.total")}</Text>
          <Text style={styles.change}>
            {fmtKcalLabel(data.totals.before)} → {fmtKcalLabel(data.totals.after)}
          </Text>
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing.md,
    paddingBottom: theme.spacing.md,
  },
  footer: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  footerBtn: {
    flex: 1,
  },
  hint: {
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
    color: theme.colors.mutedForeground,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  rowName: {
    flex: 1,
  },
  name: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
  },
  change: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  total: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.hairline,
    paddingTop: theme.spacing.md,
  },
}));
