import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { useState } from "react";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button, Input, Text } from "@/components/ui";
import { fmtIdr } from "@/components/plate/belanja";
import { DayChips, DateSheet } from "@/components/plate/date-sheet";

/** One plate's info as the diary shows it. */
type PlateInfo = { id: string; name: string; priceIdr: number | null };
type PlateEdit = { id: string; name: string; price: string; date: string } | null;

/**
 * Diary plate header: "Piring: Nasi padang · Rp28.000". Tapping opens a tiny
 * inline editor (name + price + day) saved via plate.update; an emptied price
 * clears it.
 */
export function PlateHeader({
  plate,
  edit,
  onEdit,
  onSave,
  saving,
}: {
  plate: PlateInfo & { date: string };
  edit: PlateEdit;
  onEdit: (next: PlateEdit) => void;
  onSave: (id: string, name: string, price: string, date?: string) => void;
  saving: boolean;
}) {
  const { theme } = useUnistyles();
  const [pickingDate, setPickingDate] = useState(false);
  const editing = edit?.id === plate.id;

  if (!editing) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Ubah piring ${plate.name}`}
        disabled={saving}
        onPress={() =>
          onEdit({
            id: plate.id,
            name: plate.name,
            price: plate.priceIdr !== null ? String(plate.priceIdr) : "",
            date: plate.date,
          })
        }
        style={({ pressed }) => [styles.bar, pressed && styles.pressed]}
      >
        <Ionicons name="restaurant" size={14} color={theme.colors.makanText} />
        <Text style={styles.label} numberOfLines={1}>
          Piring: {plate.name}
        </Text>
        {plate.priceIdr !== null ? (
          <Text style={styles.price}>{fmtIdr(plate.priceIdr)}</Text>
        ) : null}
        <Ionicons name="pencil" size={12} color={theme.colors.mutedForeground} />
      </Pressable>
    );
  }

  return (
    <View style={[styles.bar, styles.editBox]}>
      <Input
        value={edit.name}
        onChangeText={(name) => edit && onEdit({ ...edit, name })}
        maxLength={200}
        placeholder="Nama piring"
        accessibilityLabel="Nama piring"
        style={styles.nameInput}
      />
      <View style={styles.editRow}>
        <Input
          value={edit.price}
          onChangeText={(price) => edit && onEdit({ ...edit, price })}
          keyboardType="number-pad"
          maxLength={9}
          placeholder="Harga (Rp)"
          accessibilityLabel="Harga piring dalam rupiah"
          style={styles.priceInput}
        />
        <Button
          size="sm"
          label="Simpan"
          onPress={() =>
            onSave(
              plate.id,
              edit.name,
              edit.price,
              edit.date !== plate.date ? edit.date : undefined,
            )
          }
          loading={saving}
          style={styles.saveBtn}
        />
        <Button
          variant="ghost"
          size="sm"
          label="Batal"
          onPress={() => onEdit(null)}
          style={styles.cancelBtn}
        />
      </View>
      <DayChips
        value={edit.date}
        onChange={(date) => edit && onEdit({ ...edit, date })}
      />
      <Button
        variant="ghost"
        size="sm"
        label="Pilih tanggal"
        onPress={() => setPickingDate(true)}
      />
      <DateSheet
        visible={pickingDate}
        value={edit.date}
        onPick={(date) => edit && onEdit({ ...edit, date })}
        onClose={() => setPickingDate(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.makanSoft,
    borderRadius: theme.radius.tile,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
  },
  pressed: {
    opacity: 0.7,
  },
  label: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.makanText,
  },
  price: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.makanText,
  },
  editBox: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: theme.spacing.sm,
  },
  editRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  nameInput: {
    flex: 1,
  },
  priceInput: {
    flex: 1,
  },
  saveBtn: {
    alignSelf: "auto",
  },
  cancelBtn: {
    alignSelf: "auto",
  },
}));
