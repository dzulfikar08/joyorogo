import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { jakartaToday } from "@joyorogo/api/lib/engine";
import { formatIdrInput, idrKeystroke, recentDayLabel } from "@joyorogo/api/lib/format";

import { Button, Input, Text } from "@/components/ui";
import { MacroLine } from "@/components/macro-line";
import { fmtIdr } from "@/components/plate/belanja";
import { DayChips, DateSheet } from "@/components/plate/date-sheet";
import { fmtKcal } from "@/utils/format";

/** One plate's info as the diary shows it, with the components' totals. */
type PlateInfo = { id: string; name: string; priceIdr: number | null };
type PlateEdit = { id: string; name: string; price: string; date: string } | null;

/**
 * Diary plate header: "Piring: Nasi padang · Rp28.000" plus the plate's total
 * kcal (and protein when the rows carry it). Tapping opens a tiny inline
 * editor (name + price + day) saved via plate.update; an emptied price clears
 * it. `price` stays plain digits — the input renders it as "Rp28.000".
 */
export function PlateHeader({
  plate,
  kcal,
  protein,
  carbs,
  fat,
  fiber,
  edit,
  onEdit,
  onSave,
  saving,
  action,
}: {
  plate: PlateInfo & { date: string };
  /** Component totals summed by the diary, shown in the bar. */
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  edit: PlateEdit;
  onEdit: (next: PlateEdit) => void;
  onSave: (id: string, name: string, price: string, date?: string) => void;
  saving: boolean;
  /** Secondary actions (Favorit) shown inside the open plate editor. */
  action?: ReactNode;
}) {
  const { theme } = useUnistyles();
  const [pickingDate, setPickingDate] = useState(false);
  const editing = edit?.id === plate.id;
  const today = jakartaToday();
  // Caret inside the price input, so backspacing a separator drops the digit.
  const priceCaret = useRef(0);

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
        style={({ pressed }) => [styles.bar, styles.barColumn, pressed && styles.pressed]}
      >
        <View style={styles.barRow}>
          <Ionicons name="restaurant" size={14} color={theme.colors.makanText} />
          <Text style={styles.label} numberOfLines={1}>
            Piring: {plate.name}
          </Text>
          {plate.priceIdr !== null ? (
            <Text style={styles.price}>{fmtIdr(plate.priceIdr)}</Text>
          ) : null}
          <Ionicons name="pencil" size={12} color={theme.colors.mutedForeground} />
        </View>
        {kcal > 0 ? (
          <View style={styles.totals}>
            <Text style={styles.kcal}>{fmtKcal(kcal)} kcal</Text>
            <MacroLine protein={protein} carbs={carbs} fat={fat} fiber={fiber} />
          </View>
        ) : null}
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
          value={formatIdrInput(edit.price)}
          onChangeText={(text) =>
            edit &&
            onEdit({
              ...edit,
              price: idrKeystroke(text, formatIdrInput(edit.price), priceCaret.current),
            })
          }
          onSelectionChange={({ nativeEvent: { selection } }) => {
            priceCaret.current = selection.start;
          }}
          keyboardType="number-pad"
          maxLength={13}
          placeholder="Rp0"
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
      <DayChips value={edit.date} onChange={(date) => edit && onEdit({ ...edit, date })} />
      <Button
        variant="ghost"
        size="sm"
        icon="calendar"
        label={recentDayLabel(edit.date, today)}
        onPress={() => setPickingDate(true)}
      />
      <DateSheet
        visible={pickingDate}
        value={edit.date}
        onPick={(date) => edit && onEdit({ ...edit, date })}
        onClose={() => setPickingDate(false)}
      />
      {action}
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
  barColumn: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 2,
  },
  barRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
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
  kcal: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  totals: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: theme.spacing.sm,
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
