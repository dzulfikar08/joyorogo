import { useRef, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { jakartaToday, relativeDayLabel } from "@joyorogo/api/lib/engine";
import { formatIdrInput, idrKeystroke, parseIdrInput, recentDayLabel } from "@joyorogo/api/lib/format";

import { DateSheet, DayChips } from "@/components/plate/date-sheet";
import { SaveLocationToggle } from "@/components/places/location-toggle";
import { SheetActions } from "@/components/sheet-actions";
import { StickerHero } from "@/components/sticker";
import { Button, Field, Input, Sheet, Text } from "@/components/ui";
import { usePlaceLocation } from "@/src/lib/location";
import { fmtDateId } from "@/utils/format";

/** One plate as the diary shows it (plate.byDate), plus its cutout. */
export type PlateEditTarget = {
  id: string;
  name: string;
  place: string | null;
  priceIdr: number | null;
  date: string;
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
  const [name, setName] = useState(plate.name);
  const [place, setPlace] = useState(plate.place ?? "");
  const [price, setPrice] = useState(plate.priceIdr !== null ? String(plate.priceIdr) : "");
  const [date, setDate] = useState(plate.date);
  const [pickingDate, setPickingDate] = useState(false);
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

  const changed =
    name.trim() !== plate.name ||
    placeClean !== (plate.place ?? "") ||
    (priceNum ?? null) !== plate.priceIdr ||
    dateChanged ||
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
      ...coords,
    });
    onClose();
  };

  return (
    <>
      <Sheet
        visible
        onClose={onClose}
        title="Ubah piring"
        footer={
          <View style={styles.footer}>
            <Button variant="ghost" label="Batal" onPress={onClose} style={styles.footerBtn} />
            <Button
              label="Simpan"
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

          <Field label="Nama piring">
            <Input
              value={name}
              onChangeText={setName}
              maxLength={200}
              placeholder="Nasi padang"
              accessibilityLabel="Nama piring"
            />
          </Field>

          <Field label="Tempat (opsional)">
            <Input
              value={place}
              onChangeText={setPlace}
              maxLength={200}
              placeholder="Warung Bu Siti"
              accessibilityLabel="Tempat membeli"
            />
          </Field>

          <Field label="Harga sepiring (Rp)">
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
              accessibilityLabel="Harga piring dalam rupiah"
            />
          </Field>

          <Field label="Dicatat pada">
            <View style={styles.dateBox}>
              <DayChips value={date} onChange={setDate} />
              <Button
                variant="ghost"
                size="sm"
                icon="calendar"
                label={recentDayLabel(date, jakartaToday())}
                onPress={() => setPickingDate(true)}
              />
              {dateChanged ? (
                <Text style={styles.hint}>
                  Akan dipindah ke {fmtDateId(date)} ({relativeDayLabel(date, jakartaToday())}).
                </Text>
              ) : (
                <Text style={styles.hint}>Pindahkan piring ini ke hari lain bila salah hari.</Text>
              )}
            </View>
          </Field>

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
              <Text style={styles.hint}>Piring ini punya lokasi tersimpan, cuma kamu yang lihat.</Text>
              <Button
                variant="ghost"
                size="sm"
                icon="trash-outline"
                label="Hapus lokasi"
                destructive
                onPress={() => {
                  setLocate(false);
                  setClearLocation(true);
                }}
              />
            </View>
          ) : null}
          {locate && placeClean === "" ? (
            <Text style={styles.hint}>Isi nama tempat dulu supaya lokasinya bisa disimpan.</Text>
          ) : null}

          <SheetActions favorite={favorite} onFavorite={onFavorite} />
        </View>
      </Sheet>
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
