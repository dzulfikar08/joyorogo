import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useUnistyles } from "react-native-unistyles";

import { Button, Field, Input, Sheet, Text } from "@/components/ui";
import { errorMessage, parseNum } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

/** Weigh-in form in a bottom sheet, shared by Beranda and Berat. */
export function WeighInSheet({
  visible,
  onClose,
  latestKg,
}: {
  visible: boolean;
  onClose: () => void;
  latestKg?: number | null;
}) {
  const { theme } = useUnistyles();
  const [kg, setKg] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Prefill with the latest known weight each time the sheet opens.
  useEffect(() => {
    if (visible && kg === "" && latestKg != null) {
      setKg(String(latestKg));
    }
  }, [visible, kg, latestKg]);

  const checkIn = useMutation(
    orpc.weight.checkIn.mutationOptions({
      onSuccess: () => {
        setError(null);
        setKg("");
        queryClient.invalidateQueries();
        onClose();
      },
      onError: (e) => setError(errorMessage(e)),
    }),
  );

  const submit = () => {
    const num = parseNum(kg);
    if (num === null || num < 25 || num > 400) {
      setError("Isi berat badan antara 25 dan 400 kg.");
      return;
    }
    setError(null);
    checkIn.mutate({ weightKg: num });
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Timbang hari ini"
      footer={<Button label="Simpan" onPress={submit} loading={checkIn.isPending} />}
    >
      <Field
        label="Berat badan (kg)"
        hint="Satu catatan per hari. Menyimpan lagi akan menimpa catatan hari ini."
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
