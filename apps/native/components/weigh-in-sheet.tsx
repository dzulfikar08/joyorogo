import { useEffect, useState } from "react";
import { View } from "react-native";
import { useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";

import { Button, Field, Input, Sheet, Text } from "@/components/ui";
import { jakartaToday, relativeDayLabel } from "@joyorogo/api/lib/engine";
import { errorMessage, fmtKg, parseNum } from "@/utils/format";
import { client, orpc, queryClient } from "@/utils/orpc";
import { useOptimisticMutation } from "@/lib/optimistic";

/** Weigh-in form in a bottom sheet, shared by Beranda and Berat. */
export function WeighInSheet({
  visible,
  onClose,
  latestKg,
  date,
}: {
  visible: boolean;
  onClose: () => void;
  latestKg?: number | null;
  /** WIB day key the weigh-in lands on; defaults to today. */
  date?: string;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation(["berat", "common"]);
  const [kg, setKg] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Prefill with the latest known weight each time the sheet opens.
  useEffect(() => {
    if (visible && kg === "" && latestKg != null) {
      setKg(String(latestKg));
    }
  }, [visible, kg, latestKg]);

  type WeightCheckInInput = { weightKg: number; date?: string };

  const checkIn = useOptimisticMutation<WeightCheckInInput, unknown>({
    mutationFn: (input) => client.weight.checkIn(input),
    patch: (input, cache) => {
      cache.weight({ date: input.date ?? jakartaToday(), weightKg: input.weightKg });
    },
    success: (input) => {
      setError(null);
      setKg("");
      onClose();
      // Undo re-logs the weight the day had before this check-in, if known.
      const historyKey = orpc.weight.history.queryOptions({ input: { limit: 30 } }).queryKey;
      const rows =
        (queryClient.getQueryData<{ entries?: Array<{ date: string; weightKg: number }> }>(
          historyKey,
        )?.entries ?? []).filter((entry) => entry.date !== (input.date ?? jakartaToday()));
      const previous = rows.at(-1)?.weightKg;
      return {
        message: t("toast.logged", { kg: fmtKg(input.weightKg) }),
        undo:
          previous === undefined
            ? undefined
            : () => checkIn.mutate({ weightKg: previous, ...(input.date ? { date: input.date } : {}) }),
      };
    },
    onError: (e) => setError(errorMessage(e)),
    invalidate: (input) => [
      orpc.weight.key(),
      orpc.day.key(),
      ...(input.date === undefined ? [orpc.profile.key()] : []),
    ],
  });

  const submit = () => {
    const num = parseNum(kg);
    if (num === null || num < 25 || num > 400) {
      setError(t("error.weightRange", { min: 25, max: 400 }));
      return;
    }
    setError(null);
    checkIn.mutate({ weightKg: num, ...(date === undefined ? {} : { date }) });
  };

  const today = jakartaToday();
  const isToday = date === undefined || date === today;
  const dayLabel = relativeDayLabel(date ?? today, today);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={isToday ? t("sheet.title") : t("sheet.titleDay", { day: dayLabel })}
      footer={<Button label={t("common:actions.save")} onPress={submit} loading={checkIn.isPending} />}
    >
      <Field
        label={t("sheet.weightLabel")}
        hint={isToday ? t("sheet.hintToday") : t("sheet.hintDay", { day: dayLabel })}
      >
        <Input
          value={kg}
          onChangeText={setKg}
          keyboardType="decimal-pad"
          placeholder="68,5"
          autoFocus
        />
      </Field>
      {error ? (
        <View>
          <Text style={{ fontSize: 13, color: theme.colors.destructive }}>{error}</Text>
        </View>
      ) : null}
    </Sheet>
  );
}
