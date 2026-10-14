import { View } from "react-native";
import { useRef } from "react";
import { StyleSheet } from "react-native-unistyles";

import { formatIdrInput, idrKeystroke, parseIdrInput } from "@joyorogo/api/lib/format";

import { Field, Input, Text } from "@/components/ui";

/** The three plate fields shared by scan confirm and manual forms. */
export type PlateValues = { name: string; place: string; price: string };

/**
 * "Harga sepiring": price in rupiah plus the plate name and where it came
 * from. `name` arrives prefilled (last price paid, else the AI's first item)
 * and stays editable. `price` holds plain digits; the input shows "Rp28.000".
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
  // Caret inside the price input, so backspacing a separator drops the digit.
  const priceCaret = useRef(0);
  return (
    <View style={styles.gap}>
      <Text style={styles.title}>{title}</Text>
      <Field label={priceLabel}>
        <Input
          value={formatIdrInput(values.price)}
          onChangeText={(text) =>
            onChange({
              ...values,
              price: idrKeystroke(text, formatIdrInput(values.price), priceCaret.current),
            })
          }
          onSelectionChange={({ nativeEvent: { selection } }) => {
            priceCaret.current = selection.start;
          }}
          keyboardType="number-pad"
          maxLength={13}
          placeholder="Rp0"
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
  const price = parseIdrInput(values.price);
  const priceIdr = price !== null && price >= 0 ? price : null;
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
