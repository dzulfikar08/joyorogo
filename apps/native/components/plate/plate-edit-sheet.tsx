import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { MEAL_EDIT_LABELS, jakartaToday, relativeDayLabel } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { formatIdrInput, idrKeystroke, parseIdrInput } from "@joyorogo/api/lib/format";

import { DateSheet, DayChips } from "@/components/plate/date-sheet";
import { MealSlotField } from "@/components/plate/meal-slot-field";
import { RecalcSheet, useRecalcPlate } from "@/components/plate/recalc-plate";
import { SaveLocationToggle } from "@/components/places/location-toggle";
import { SheetActions } from "@/components/sheet-actions";
import { StickerHero } from "@/components/sticker";
import { Button, Field, Input, Sheet, Text } from "@/components/ui";
import { usePlaceLocation } from "@/src/lib/location";
import { fmtDateMedium } from "@/utils/format";

/** One plate as the diary shows it (plate.byDate), plus its cutout. */
export type PlateEditTarget = {
  id: string;
  name: string;
  place: string | null;
  priceIdr: number | null;
  date: string;
  meal: Meal;
  lat: number | null;
  lng: number | null;
  /** Cutout of the first component that has one. */
  scanId: string | null;
};

export type PlateEditInput = {
  id: string;
  name?: string;
  place?: string | null;
  priceIdr?: number | null;
  date?: string;
  meal?: Meal;
  lat?: number | null;
  lng?: number | null;
};

/**
 * Bottom sheet that edits one diary plate: sticker hero, name, place, price,
 * day (chips + calendar), the opt-in location of the place, and the Favorit
 * toggle. Simpan / Batal live in the footer. Only changed fields are sent, so
 * an untouched place never loses its coordinates. Saving is optimistic with
 * undo, handled by the caller's mutation.
 */
export function PlateEditSheet({
  plate,
  saving,
  favorite,
  onFavorite,
  onSave,
  onClose,
}: {
  plate: PlateEditTarget;
  saving: boolean;
  favorite: boolean;
  onFavorite: () => void;
  onSave: (input: PlateEditInput) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation(["makan", "common"]);
  const [name, setName] = useState(plate.name);
  const [place, setPlace] = useState(plate.place ?? "");
  const [price, setPrice] = useState(plate.priceIdr !== null ? String(plate.priceIdr) : "");
  const [date, setDate] = useState(plate.date);
  const [meal, setMeal] = useState<Meal>(plate.meal);
  const [pickingDate, setPickingDate] = useState(false);
  const [recalcOpen, setRecalcOpen] = useState(false);
  const recalc = useRecalcPlate(plate.id, () => setRecalcOpen(false));
  // "Simpan lokasi di sini" only applies when switched on in this sheet: an
  // edit from home must not overwrite where the plate was eaten.
  const [locate, setLocate] = useState(false);
  const [clearLocation, setClearLocation] = useState(false);
  const location = usePlaceLocation();
  // Caret inside the price input, so backspacing a separator drops the digit.
  const priceCaret = useRef(0);

  const placeClean = place.trim();
  const priceNum = price.trim() === "" ? null : parseIdrInput(price);
  const priceValid = price.trim() === "" || (priceNum !== null && priceNum >= 0);
  const hasLocation = plate.lat !== null && plate.lng !== null && !clearLocation;
  const wantsCoords = locate && placeClean !== "" && location.coords !== null;
  const dateChanged = date !== plate.date;
  const mealChanged = meal !== plate.meal;

  const changed =
    name.trim() !== plate.name ||
    placeClean !== (plate.place ?? "") ||
    (priceNum ?? null) !== plate.priceIdr ||
    dateChanged ||
    mealChanged ||
    wantsCoords ||
    clearLocation;
  const valid = name.trim() !== "" && priceValid;

  const submit = () => {
    if (!valid || !changed) return;
    // The server drops coordinates when the place text changes, so a new place
    // without a fresh fix ends up location-less, never with the old spot.
    const coords =
      wantsCoords && location.coords
        ? { lat: location.coords.lat, lng: location.coords.lng }
        : clearLocation || (placeClean === "" && plate.lat !== null)
          ? { lat: null, lng: null }
          : {};
    onSave({
      id: plate.id,
      ...(name.trim() !== plate.name ? { name: name.trim() } : {}),
      ...(placeClean !== (plate.place ?? "") ? { place: placeClean === "" ? null : placeClean } : {}),
      ...((priceNum ?? null) !== plate.priceIdr ? { priceIdr: priceNum } : {}),
      ...(dateChanged ? { date } : {}),
      ...(mealChanged ? { meal } : {}),
      ...coords,
    });
    onClose();
  };

  return (
    <>
      <Sheet
        visible
        onClose={onClose}
        title={t("plate.edit.title")}
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
              onPress={submit}
              disabled={!valid || !changed}
              loading={saving}
              style={styles.footerBtn}
            />
          </View>
        }
      >
        <View style={styles.body}>
          <StickerHero scanId={plate.scanId} name={plate.name} />

          <Field label={t("plate.edit.name")}>
            <Input
              value={name}
              onChangeText={setName}
              maxLength={200}
              placeholder={t("plate.edit.namePlaceholder")}
              accessibilityLabel={t("plate.edit.name")}
            />
          </Field>

          <Field label={t("plate.edit.place")}>
            <Input
              value={place}
              onChangeText={setPlace}
              maxLength={200}
              placeholder={t("plate.fields.placePlaceholder")}
              accessibilityLabel={t("plate.fields.placeAria")}
            />
          </Field>

          <Field label={t("plate.edit.price")}>
            <Input
              value={formatIdrInput(price)}
              onChangeText={(text) =>
                setPrice(idrKeystroke(text, formatIdrInput(price), priceCaret.current))
              }
              onSelectionChange={({ nativeEvent: { selection } }) => {
                priceCaret.current = selection.start;
              }}
              keyboardType="number-pad"
              maxLength={13}
              placeholder="Rp0"
              accessibilityLabel={t("plate.editNative.priceAria")}
            />
          </Field>

          <Field label={t("plate.edit.loggedOn")}>
            <View style={styles.dateBox}>
              <DayChips value={date} onChange={setDate} />
              <Button
                variant="ghost"
                size="sm"
                icon="calendar"
                label={relativeDayLabel(date, jakartaToday())}
                onPress={() => setPickingDate(true)}
              />
              {dateChanged ? (
                <Text style={styles.hint}>
                  {t("plate.editNative.movedHint", {
                    date: fmtDateMedium(date),
                    relative: relativeDayLabel(date, jakartaToday()),
                  })}
                </Text>
              ) : (
                <Text style={styles.hint}>{t("plate.edit.dateHint")}</Text>
              )}
            </View>
          </Field>

          <MealSlotField
            value={meal}
            current={plate.meal}
            onChange={setMeal}
            hint={
              mealChanged
                ? t("plate.editNative.slotMovedHint", { meal: MEAL_EDIT_LABELS[meal] })
                : t("plate.edit.slotHint")
            }
          />

          <SaveLocationToggle
            enabled={locate}
            status={location.status}
            onChange={(on) => {
              setLocate(on);
              if (on) {
                setClearLocation(false);
                location.setEnabled(true);
              }
            }}
          />
          {hasLocation ? (
            <View style={styles.locationRow}>
              <Text style={styles.hint}>{t("plate.editNative.hasLocation")}</Text>
              <Button
                variant="ghost"
                size="sm"
                icon="trash-outline"
                label={t("plate.editNative.removeLocation")}
                destructive
                onPress={() => {
                  setLocate(false);
                  setClearLocation(true);
                }}
              />
            </View>
          ) : null}
          {locate && placeClean === "" ? (
            <Text style={styles.hint}>{t("plate.editNative.needPlace")}</Text>
          ) : null}

          {recalc.data && recalc.data.items.length > 0 ? (
            <View style={styles.actionRow}>
              <Button
                variant="secondary"
                size="sm"
                icon="calculator-outline"
                label={t("plate.recalc.action")}
                onPress={() => setRecalcOpen(true)}
              />
            </View>
          ) : null}

          <SheetActions favorite={favorite} onFavorite={onFavorite} />
        </View>
      </Sheet>
      {recalc.data && recalc.data.items.length > 0 ? (
        <RecalcSheet
          visible={recalcOpen}
          data={recalc.data}
          saving={recalc.saving}
          onSave={recalc.save}
          onClose={() => setRecalcOpen(false)}
        />
      ) : null}
      <DateSheet
        visible={pickingDate}
        value={date}
        onPick={setDate}
        onClose={() => setPickingDate(false)}
      />
    </>
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
  actionRow: {
    flexDirection: "row",
  },
  dateBox: {
    gap: theme.spacing.sm,
  },
  hint: {
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
    color: theme.colors.mutedForeground,
  },
  locationRow: {
    gap: theme.spacing.xs,
  },
}));
