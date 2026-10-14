import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native-unistyles";

import { formatIdrInput, idrKeystroke, parseIdrInput } from "@joyorogo/api/lib/format";

import { Button, Field, Input, Card, Segmented, Text } from "@/components/ui";
import { errorMessage } from "@/utils/format";
import { client, orpc, queryClient } from "@/utils/orpc";
import { useOptimisticMutation } from "@/lib/optimistic";

/**
 * "Anggaran belanja makan": amount + period, saved via plate.setBudget.
 * An empty amount clears the budget (idr null).
 */
export function BudgetSetting() {
  const profile = useQuery(orpc.profile.myProfile.queryOptions());
  type BudgetInput = { idr: number | null; period: "day" | "month" };

  const setBudget = useOptimisticMutation<
    BudgetInput,
    unknown,
    { idr: number | null; period: "day" | "month" } | null
  >({
    mutationFn: (input) => client.plate.setBudget(input),
    patch: (input, cache) => {
      const key = orpc.profile.myProfile.queryOptions().queryKey;
      const previous = queryClient.getQueryData<{
        profile?: { foodBudgetIdr: number | null; foodBudgetPeriod: string } | null;
      }>(key);
      const previousBudget =
        previous?.profile == null
          ? null
          : {
              idr: previous.profile.foodBudgetIdr,
              period:
                previous.profile.foodBudgetPeriod === "day" ? ("day" as const) : ("month" as const),
            };
      cache.value<typeof previous>(key, (old) => ({
        ...old,
        profile: {
          ...old?.profile,
          foodBudgetIdr: input.idr,
          foodBudgetPeriod: input.period,
        },
      }));
      return previousBudget;
    },
    success: (_input, _data, context) => {
      const previous = context ?? null;
      return {
        message: "Anggaran disimpan",
        undo: previous === null ? undefined : () => setBudget.mutate(previous),
      };
    },
    invalidate: () => [orpc.profile.key()],
  });

  const current = profile.data?.profile?.foodBudgetIdr ?? null;
  const [amount, setAmount] = useState(current !== null ? String(current) : "");
  const [period, setPeriod] = useState<"day" | "month">(
    profile.data?.profile?.foodBudgetPeriod === "day" ? "day" : "month",
  );
  const [error, setError] = useState<string | null>(null);
  // Caret inside the amount input, so backspacing a separator drops the digit.
  const amountCaret = useRef(0);

  // Prefill once the profile lands; later refetches never clobber typing.
  useEffect(() => {
    if (current !== null && amount === "") setAmount(String(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current !== null]);

  const save = () => {
    const value = parseIdrInput(amount);
    if (amount.trim() !== "" && value === null) {
      setError("Isi angka rupiah bulat, contoh: 30000.");
      return;
    }
    setBudget.mutate({ idr: value, period });
  };

  return (
    <Card style={styles.gap}>
      <Text style={styles.title}>Anggaran belanja makan</Text>
      <Text style={styles.note}>
        Opsional. Biar ketahuan sisa budget makanmu tiap hari atau tiap bulan.
      </Text>
      <Field label="Jumlah (Rp)" hint="Kosongkan untuk mematikan anggaran.">
        <Input
          value={formatIdrInput(amount)}
          onChangeText={(text) =>
            setAmount(idrKeystroke(text, formatIdrInput(amount), amountCaret.current))
          }
          onSelectionChange={({ nativeEvent: { selection } }) => {
            amountCaret.current = selection.start;
          }}
          keyboardType="number-pad"
          maxLength={13}
          placeholder="Rp0"
          accessibilityLabel="Jumlah anggaran belanja makan"
        />
      </Field>
      <Segmented
        options={[
          { value: "day", label: "Per hari" },
          { value: "month", label: "Per bulan" },
        ]}
        value={period}
        onChange={(value) => setPeriod(value)}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {setBudget.isError ? <Text style={styles.error}>{errorMessage(setBudget.error)}</Text> : null}
      <Button label="Simpan Anggaran" onPress={save} loading={setBudget.isPending} />
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  gap: {
    gap: theme.spacing.md,
  },
  title: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  note: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  error: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.destructive,
  },
}));
