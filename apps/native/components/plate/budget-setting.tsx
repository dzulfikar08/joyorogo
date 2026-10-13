import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { StyleSheet } from "react-native-unistyles";

import { Button, Field, Input, Card, Segmented, Text } from "@/components/ui";
import { errorMessage, parseNum } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

/**
 * "Anggaran belanja makan": amount + period, saved via plate.setBudget.
 * An empty amount clears the budget (idr null).
 */
export function BudgetSetting() {
  const profile = useQuery(orpc.profile.myProfile.queryOptions());
  const setBudget = useMutation(
    orpc.plate.setBudget.mutationOptions({
      onSuccess: () => {
        setError(null);
        queryClient.invalidateQueries();
      },
    }),
  );

  const current = profile.data?.profile?.foodBudgetIdr ?? null;
  const [amount, setAmount] = useState(current !== null ? String(current) : "");
  const [period, setPeriod] = useState<"day" | "month">(
    profile.data?.profile?.foodBudgetPeriod === "day" ? "day" : "month",
  );
  const [error, setError] = useState<string | null>(null);

  // Prefill once the profile lands; later refetches never clobber typing.
  useEffect(() => {
    if (current !== null && amount === "") setAmount(String(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current !== null]);

  const save = () => {
    const value = amount.trim() === "" ? null : parseNum(amount);
    if (value !== null && (value < 0 || !Number.isInteger(value))) {
      setError("Isi angka rupiah bulat, contoh: 30000.");
      return;
    }
    setBudget.mutate({ idr: value !== null ? Math.round(value) : null, period });
  };

  return (
    <Card style={styles.gap}>
      <Text style={styles.title}>Anggaran belanja makan</Text>
      <Text style={styles.note}>
        Opsional. Biar ketahuan sisa budget makanmu tiap hari atau tiap bulan.
      </Text>
      <Field label="Jumlah (Rp)" hint="Kosongkan untuk mematikan anggaran.">
        <Input
          value={amount}
          onChangeText={setAmount}
          keyboardType="number-pad"
          maxLength={9}
          placeholder="30000"
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
