import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Field, Input, Text } from "@/components/ui";

/** The three plate fields shared by scan confirm and manual forms. */
export type PlateValues = { name: string; place: string; price: string };

/**
 * "Harga sepiring": price in rupiah plus the plate name and where it came
 * from. `name` arrives prefilled (last price paid, else the AI's first item)
 * and stays editable.
 */
export function PlateFields({
  values,
  onChange,
  title = "Piring ini",
  priceLabel = "Harga sepiring (Rp)",
}: {
  values: PlateValues;
  onChange: (next: PlateValues) => void;
  /** Group context, e.g. "Piring: Sarapan hari ini". */
  title?: string;
  priceLabel?: string;
}) {
  return (
    <View style={styles.gap}>
      <Text style={styles.title}>{title}</Text>
      <Field label={priceLabel}>
        <Input
          value={values.price}
          onChangeText={(price) => onChange({ ...values, price })}
          keyboardType="number-pad"
          maxLength={9}
          placeholder="28000"
          accessibilityLabel="Harga sepiring dalam rupiah"
        />
      </Field>
      <Field label="Nama piring" hint="Biar harga yang sama tak perlu diisi ulang.">
        <Input
          value={values.name}
          onChangeText={(name) => onChange({ ...values, name })}
          maxLength={200}
          placeholder="Nasi padang"
          accessibilityLabel="Nama piring"
        />
      </Field>
      <Field label="Tempat (opsional)">
        <Input
          value={values.place}
          onChangeText={(place) => onChange({ ...values, place })}
          maxLength={200}
          placeholder="Warung Bu Siti"
          accessibilityLabel="Tempat membeli"
        />
      </Field>
    </View>
  );
}

/** Plate input for food.addScan/food.add, or undefined when nothing is filled. */
export function plateInput(
  values: PlateValues,
  fallbackName: string | undefined,
): { name?: string; place?: string; priceIdr?: number } | undefined {
  const name = values.name.trim();
  const place = values.place.trim();
  const price = values.price.trim() === "" ? null : Number(values.price.replace(",", "."));
  const priceIdr = price !== null && Number.isFinite(price) && price >= 0 ? Math.round(price) : null;
  if (name === "" && place === "" && priceIdr === null) return undefined;
  return {
    ...(name !== "" ? { name } : fallbackName ? { name: fallbackName } : {}),
    ...(place !== "" ? { place } : {}),
    ...(priceIdr !== null ? { priceIdr } : {}),
  };
}

const styles = StyleSheet.create((theme) => ({
  gap: {
    gap: theme.spacing.sm,
  },
  title: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
    marginTop: theme.spacing.xs,
  },
}));
