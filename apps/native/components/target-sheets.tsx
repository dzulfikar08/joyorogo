import { useEffect, useMemo, useState } from "react";
import { Platform, View } from "react-native";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { StyleSheet } from "react-native-unistyles";

import {
  daysBetween,
  idealWeightRange,
  jakartaToday,
  KCAL_PER_KG_FAT,
} from "@joyorogo/api/lib/engine";

import { Button, Field, Input, Sheet, Text } from "@/components/ui";
import { errorMessage, fmtDateId, fmtKcal, fmtKg, parseNum } from "@/utils/format";

/** WIB date N days from now as 'YYYY-MM-DD' (fixed UTC+7, no DST). */
function jakartaDatePlusDays(days: number): string {
  return new Date(Date.now() + 7 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
}

function dateToIso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Sheet "Berat target": one focused input, healthy-range hint, and the web's
 * below-healthy-range warning (profil.tsx TargetWeightForm).
 */
export function TargetWeightSheet({
  visible,
  onClose,
  heightCm,
  targetWeightKg,
  pending,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  heightCm: number;
  targetWeightKg: number;
  pending: boolean;
  onSave: (targetWeightKg: number) => Promise<void>;
}) {
  const [weight, setWeight] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Fresh form per open: an unsaved edit must not leak into the next visit.
  useEffect(() => {
    if (visible) {
      setWeight(null);
      setError(null);
      setSaveError(null);
    }
  }, [visible]);

  const shown = weight ?? String(targetWeightKg);
  const ideal = idealWeightRange(heightCm);
  const parsed = parseNum(shown);
  const belowRange = parsed !== null && parsed < ideal.minKg;

  const submit = async () => {
    if (parsed === null || parsed < 25 || parsed > 400) {
      setError("Berat target harus 25-400 kg.");
      return;
    }
    setError(null);
    setSaveError(null);
    try {
      await onSave(parsed);
    } catch (e) {
      setSaveError(errorMessage(e));
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Berat target"
      footer={<Button label="Simpan" onPress={() => void submit()} loading={pending} />}
    >
      <Field label="Berat target (kg)">
        <Input
          value={shown}
          onChangeText={(text) => {
            setWeight(text);
            setError(null);
          }}
          keyboardType="decimal-pad"
          style={styles.bigInput}
        />
      </Field>
      <Text style={styles.note}>
        Berat sehat untuk tinggimu: {fmtKg(ideal.minKg)}–{fmtKg(ideal.maxKg)} kg
      </Text>
      {belowRange ? (
        <Text style={styles.warnText}>
          Di bawah rentang berat sehat. Boleh dilanjutkan, perhatikan kesehatanmu.
        </Text>
      ) : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {saveError ? <Text style={styles.errorText}>{saveError}</Text> : null}
      <Text style={styles.note}>Angka harian dihitung ulang otomatis.</Text>
    </Sheet>
  );
}

/**
 * Sheet "Tanggal target": real calendar picker plus the web's too-fast guard
 * (profil.tsx TargetDateForm): warn when the target date demands more than
 * ~1.000 kkal/day of deficit and offer a realistic date.
 */
export function TargetDateSheet({
  visible,
  onClose,
  targetDate,
  weightNowKg,
  targetWeightKg,
  pending,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  targetDate: string;
  weightNowKg: number;
  targetWeightKg: number;
  pending: boolean;
  onSave: (targetDate: string) => Promise<void>;
}) {
  const [date, setDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setDate(null);
      setError(null);
      setSaveError(null);
    }
  }, [visible]);

  const shown = date ?? targetDate;
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(shown) ? new Date(`${shown}T00:00:00`) : new Date();
  const minDate = new Date(`${jakartaToday()}T00:00:00`);

  const tooFast = useMemo(() => {
    if (targetWeightKg >= weightNowKg) return null;
    const days = daysBetween(jakartaToday(), shown);
    if (days < 1) return null;
    const lossKg = weightNowKg - targetWeightKg;
    const rawDeficit = Math.round((lossKg * KCAL_PER_KG_FAT) / days);
    if (rawDeficit <= 1000) return null;
    return {
      rawDeficit,
      lossKg,
      feasibleDays: Math.ceil((lossKg * KCAL_PER_KG_FAT) / 1000),
    };
  }, [shown, weightNowKg, targetWeightKg]);

  const onPicked = (picked: Date | undefined) => {
    if (picked) {
      setDate(dateToIso(picked));
      setError(null);
    }
  };

  const openPicker = () => {
    if (Platform.OS !== "android") return;
    DateTimePickerAndroid.open({
      value: selected,
      mode: "date",
      minimumDate: minDate,
      onChange: (_event, picked) => onPicked(picked),
    });
  };

  const submit = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(shown) || shown < jakartaToday()) {
      setError("Tanggal target harus belum lewat.");
      return;
    }
    setError(null);
    setSaveError(null);
    try {
      await onSave(shown);
    } catch (e) {
      setSaveError(errorMessage(e));
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Tanggal target"
      footer={<Button label="Simpan" onPress={() => void submit()} loading={pending} />}
    >
      {Platform.OS === "android" ? (
        <Button
          variant="secondary"
          icon="calendar"
          label={fmtDateId(shown)}
          onPress={openPicker}
          style={styles.dateButton}
        />
      ) : (
        <DateTimePicker
          value={selected}
          mode="date"
          display="spinner"
          minimumDate={minDate}
          onChange={(_event, picked) => onPicked(picked)}
        />
      )}
      {tooFast ? (
        <View style={styles.warnBox}>
          <Text style={styles.warnTitle}>
            Target ini menuntut defisit ~{fmtKcal(tooFast.rawDeficit)} kkal/hari, di atas batas
            aman.
          </Text>
          <Text style={styles.warnBody}>
            JoyoRogo membatasi defisit pada sekitar 1.000 kkal/hari. Turun {fmtKg(tooFast.lossKg)}{" "}
            kg dengan ritme itu butuh sekitar {fmtKcal(tooFast.feasibleDays)} hari.
          </Text>
          <Button
            variant="secondary"
            size="sm"
            label={`Pakai tanggal realistis (+${fmtKcal(tooFast.feasibleDays)} hari)`}
            onPress={() => {
              setDate(jakartaDatePlusDays(tooFast.feasibleDays));
              setError(null);
            }}
            style={styles.warnAction}
          />
        </View>
      ) : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {saveError ? <Text style={styles.errorText}>{saveError}</Text> : null}
      <Text style={styles.note}>Kapan kamu ingin mencapai berat target.</Text>
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  bigInput: {
    textAlign: "center",
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
  },
  note: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
  warnText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
    lineHeight: 20,
  },
  errorText: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.destructive,
  },
  warnBox: {
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.bakarSoft,
  },
  warnTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.bakarText,
    lineHeight: 20,
  },
  warnBody: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
  warnAction: {
    alignSelf: "flex-start",
  },
  dateButton: {
    height: 64,
  },
}));
