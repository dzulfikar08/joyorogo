import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { formatIdrInput, idrKeystroke, parseIdrInput } from "@joyorogo/api/lib/format";

import { SaveLocationToggle } from "@/components/places/location-toggle";
import { Field, Input, Text } from "@/components/ui";
import { usePlaceLocation } from "@/src/lib/location";

/** The plate fields shared by scan confirm and manual forms; coords are set by PlateFields. */
export type PlateValues = {
  name: string;
  place: string;
  price: string;
  coords?: { lat: number; lng: number } | null;
};

/**
 * "Harga sepiring": price in rupiah plus the plate name and where it came
 * from. `name` arrives prefilled (last price paid, else the AI's first item)
 * and stays editable. `price` holds plain digits; the input shows "Rp28.000".
 */
export function PlateFields({
  values,
  onChange,
  title: titleProp,
  priceLabel: priceLabelProp,
}: {
  values: PlateValues;
  onChange: (next: PlateValues) => void;
  /** Group context, e.g. "Piring: Sarapan hari ini". */
  title?: string;
  priceLabel?: string;
}) {
  const { t } = useTranslation("makan");
  const title = titleProp ?? t("plate.fields.title");
  const priceLabel = priceLabelProp ?? t("plate.edit.price");
  // Caret inside the price input, so backspacing a separator drops the digit.
  const priceCaret = useRef(0);
  // Opt-in location of the place: kept on the values so plateInput can send it.
  const location = usePlaceLocation();
  const wanted = location.enabled && values.place.trim() !== "" ? location.coords : null;
  useEffect(() => {
    if (values.coords?.lat === wanted?.lat && values.coords?.lng === wanted?.lng) return;
    onChange({ ...values, coords: wanted });
  }, [wanted?.lat, wanted?.lng]);
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
          accessibilityLabel={t("plate.fields.priceAria")}
        />
      </Field>
      <Field label={t("plate.edit.name")} hint={t("plate.fields.nameHint")}>
        <Input
          value={values.name}
          onChangeText={(name) => onChange({ ...values, name })}
          maxLength={200}
          placeholder={t("plate.edit.namePlaceholder")}
          accessibilityLabel={t("plate.edit.name")}
        />
      </Field>
      <Field label={t("plate.edit.place")}>
        <Input
          value={values.place}
          onChangeText={(place) => onChange({ ...values, place })}
          maxLength={200}
          placeholder={t("plate.fields.placePlaceholder")}
          accessibilityLabel={t("plate.fields.placeAria")}
        />
      </Field>
      <SaveLocationToggle
        enabled={location.enabled}
        status={location.status}
        onChange={location.setEnabled}
      />
    </View>
  );
}

/** Plate input for food.addScan/food.add, or undefined when nothing is filled. */
export function plateInput(
  values: PlateValues,
  fallbackName: string | undefined,
): { name?: string; place?: string; priceIdr?: number; lat?: number; lng?: number } | undefined {
  const name = values.name.trim();
  const place = values.place.trim();
  const price = parseIdrInput(values.price);
  const priceIdr = price !== null && price >= 0 ? price : null;
  if (name === "" && place === "" && priceIdr === null) return undefined;
  return {
    ...(name !== "" ? { name } : fallbackName ? { name: fallbackName } : {}),
    ...(place !== "" ? { place } : {}),
    // Coordinates only ever ride along with a place name (see PlateFields).
    ...(place !== "" && values.coords ? values.coords : {}),
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
