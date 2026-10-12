import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { Pressable, View } from "react-native";
import { useState } from "react";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import {
  ACTIVITY_LABELS,
  jakartaToday,
  idealWeightRange,
  type Targets,
} from "@joyorogo/api/lib/engine";

import {
  BootLoader,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  Num,
  Screen,
  Text,
} from "@/components/ui";
import { useSessionGate } from "@/lib/use-session-gate";
import { errorMessage, fmtKcal, fmtKg, parseNum } from "@/utils/format";
import { client, orpc } from "@/utils/orpc";

type Gender = "male" | "female";
type ActivityLevel = "low" | "mid" | "high";

const TOTAL_STEPS = 6;

function defaultTargetDate(): string {
  const day = new Date(`${jakartaToday()}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 90);
  return day.toISOString().slice(0, 10);
}

/** Big single-select choice row for onboarding questions. */
function ChoiceRow({
  label,
  description,
  selected,
  onPress,
}: {
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { theme } = useUnistyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        { backgroundColor: selected ? theme.colors.makanSoft : theme.colors.muted },
        pressed && styles.pressedSoft,
      ]}
    >
      <View style={styles.choiceText}>
        <Text
          style={[
            styles.choiceLabel,
            { color: selected ? theme.colors.makanText : theme.colors.foreground },
          ]}
        >
          {label}
        </Text>
        {description ? (
          <Text
            style={[
              styles.choiceDesc,
              { color: selected ? theme.colors.makanText : theme.colors.mutedForeground },
            ]}
          >
            {description}
          </Text>
        ) : null}
      </View>
      <Ionicons
        name={selected ? "checkmark-circle" : "ellipse-outline"}
        size={24}
        color={selected ? theme.colors.primary : theme.colors.mutedForeground}
      />
    </Pressable>
  );
}

export default function Onboarding() {
  const gate = useSessionGate();
  const { theme } = useUnistyles();
  const profileQuery = useQuery(orpc.profile.myProfile.queryOptions());

  const [saving, setSaving] = useState(false);
  const [savedTargets, setSavedTargets] = useState<Targets | null>(null);
  const [step, setStep] = useState(0);
  const [gender, setGender] = useState<Gender>("male");
  const [birthYear, setBirthYear] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [targetWeightKg, setTargetWeightKg] = useState("");
  const [targetDate, setTargetDate] = useState(defaultTargetDate);
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>("mid");
  const [formError, setFormError] = useState<string | null>(null);

  if (gate === "loading" || profileQuery.isPending) {
    return <BootLoader />;
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }
  if (profileQuery.isError) {
    return (
      <Screen>
        <ErrorState
          message={errorMessage(profileQuery.error)}
          onRetry={() => profileQuery.refetch()}
        />
      </Screen>
    );
  }
  if (!savedTargets && profileQuery.data?.profile) {
    return <Redirect href="/" />;
  }

  const height = parseNum(heightCm);
  const weight = parseNum(weightKg);
  const ideal = height ? idealWeightRange(height) : null;
  const target = parseNum(targetWeightKg);

  const nextStep = () => {
    setFormError(null);
    setStep((s) => s + 1);
  };

  const submitBirth = () => {
    const year = parseNum(birthYear);
    if (year === null || !Number.isInteger(year) || year < 1930 || year > 2020) {
      setFormError("Tahun lahir harus berupa angka antara 1930 dan 2020.");
      return;
    }
    nextStep();
  };

  const submitHeight = () => {
    if (height === null || height < 100 || height > 250) {
      setFormError("Tinggi badan harus antara 100 dan 250 cm.");
      return;
    }
    nextStep();
  };

  const submitWeight = () => {
    if (weight === null || weight < 25 || weight > 400) {
      setFormError("Berat badan harus antara 25 dan 400 kg.");
      return;
    }
    nextStep();
  };

  const submitTarget = () => {
    if (target === null || target < 25 || target > 400) {
      setFormError("Target berat harus antara 25 dan 400 kg.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || targetDate < jakartaToday()) {
      setFormError("Isi tanggal target dengan format TAHUN-BULAN-TANGGAL dan belum lewat.");
      return;
    }
    nextStep();
  };

  const submitAll = async () => {
    const year = parseNum(birthYear);
    if (year === null || height === null || weight === null || target === null) {
      setFormError("Ada data yang belum lengkap. Ulangi langkah sebelumnya.");
      return;
    }
    setSaving(true);
    try {
      // Native TS resolves this procedure's client type as void; the runtime
      // shape is { targets } (web infers it fine), so pin it here.
      const result = (await client.profile.upsert({
        birthYear: year,
        gender,
        heightCm: height,
        weightKg: weight,
        targetWeightKg: target,
        targetDate,
        activityLevel,
      })) as unknown as { targets: Targets };
      setSavedTargets(result.targets);
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const targets = savedTargets;

  const goBack = () => {
    setFormError(null);
    setStep((s) => Math.max(0, s - 1));
  };

  return (
    <Screen>
      {/* Progress bar */}
      <View style={styles.progressRow}>
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <View
            key={i}
            style={[
              styles.progressSegment,
              {
                backgroundColor: i <= step && !targets ? theme.colors.primary : theme.colors.muted,
              },
            ]}
          />
        ))}
      </View>

      {targets ? (
        <>
          <Text style={styles.stepTitle}>Rencana harianmu</Text>
          <Card style={styles.resultCard}>
            <Text style={styles.resultLabel}>Boleh makan</Text>
            <Num style={styles.resultValue}>{fmtKcal(targets.eatKcal)}</Num>
            <Text style={styles.resultHint}>kcal per hari, ini anggaran makanmu.</Text>
          </Card>
          <Card style={styles.resultCard}>
            <Text style={styles.resultLabel}>Harus dibakar</Text>
            <Num style={styles.resultValue}>{fmtKcal(targets.burnKcal)}</Num>
            <Text style={styles.resultHint}>kcal lewat olahraga tiap hari.</Text>
          </Card>
          <Card style={styles.resultCard}>
            <Text style={styles.resultLabel}>Jam tidur</Text>
            <Num style={styles.resultValue}>{fmtKg(targets.sleepHours)}</Num>
            <Text style={styles.resultHint}>jam tiap malam agar pemulihan terjaga.</Text>
          </Card>
          {targets.notes.includes("BELOW_HEALTHY_RANGE") ? (
            <Text style={styles.warning}>
              Target beratmu di bawah rentang sehat ({fmtKg(targets.idealMinKg)}–
              {fmtKg(targets.idealMaxKg)} kg). Ubah kapan saja di menu Profil.
            </Text>
          ) : null}
          {targets.notes.includes("PLAN_CLAMPED") ? (
            <Text style={styles.warning}>
              Rencana disesuaikan agar aman, defisit kalorimu dibatasi.
            </Text>
          ) : null}
          {targets.notes.includes("MAINTENANCE") ? (
            <Text style={styles.hint}>
              Beratmu sudah di target. Rencana sekarang menjaga berat, bukan menurunkan.
            </Text>
          ) : null}
          <Button label="Mulai di Beranda" onPress={() => router.replace("/")} />
        </>
      ) : (
        <>
          {step > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Kembali"
              onPress={goBack}
              hitSlop={8}
              style={({ pressed }) => [styles.backButton, pressed && styles.pressedSoft]}
            >
              <Ionicons name="chevron-back" size={24} color={theme.colors.foreground} />
            </Pressable>
          ) : null}

          {step === 0 ? (
            <>
              <Text style={styles.stepTitle}>Kapan kamu lahir?</Text>
              <Card>
                <Field label="Tahun lahir">
                  <Input
                    value={birthYear}
                    onChangeText={setBirthYear}
                    keyboardType="number-pad"
                    placeholder="1995"
                    maxLength={4}
                  />
                </Field>
                {formError ? <Text style={styles.error}>{formError}</Text> : null}
                <Button label="Lanjut" onPress={submitBirth} />
              </Card>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <Text style={styles.stepTitle}>Jenis kelaminmu?</Text>
              <View style={styles.choiceList}>
                <ChoiceRow
                  label="Laki-laki"
                  selected={gender === "male"}
                  onPress={() => setGender("male")}
                />
                <ChoiceRow
                  label="Perempuan"
                  selected={gender === "female"}
                  onPress={() => setGender("female")}
                />
              </View>
              {formError ? <Text style={styles.error}>{formError}</Text> : null}
              <Button label="Lanjut" onPress={nextStep} />
            </>
          ) : null}

          {step === 2 ? (
            <>
              <Text style={styles.stepTitle}>Berapa tinggimu?</Text>
              <Card>
                <Field label="Tinggi badan (cm)">
                  <Input
                    value={heightCm}
                    onChangeText={setHeightCm}
                    keyboardType="decimal-pad"
                    placeholder="170"
                  />
                </Field>
                {formError ? <Text style={styles.error}>{formError}</Text> : null}
                <Button label="Lanjut" onPress={submitHeight} />
              </Card>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <Text style={styles.stepTitle}>Berapa beratmu sekarang?</Text>
              <Card>
                <Field
                  label="Berat badan (kg)"
                  hint={
                    ideal
                      ? `Berat sehat untuk tinggimu: ${fmtKg(ideal.minKg)}–${fmtKg(ideal.maxKg)} kg`
                      : undefined
                  }
                >
                  <Input
                    value={weightKg}
                    onChangeText={setWeightKg}
                    keyboardType="decimal-pad"
                    placeholder="80"
                  />
                </Field>
                <Text style={styles.hint}>
                  Angka ini jadi titik awal perjalananmu dan timbangan pertamamu.
                </Text>
                {formError ? <Text style={styles.error}>{formError}</Text> : null}
                <Button label="Lanjut" onPress={submitWeight} />
              </Card>
            </>
          ) : null}

          {step === 4 ? (
            <>
              <Text style={styles.stepTitle}>Apa targetmu?</Text>
              <Card>
                <Field
                  label="Target berat (kg)"
                  hint={
                    ideal
                      ? `Berat sehat untuk tinggimu: ${fmtKg(ideal.minKg)}–${fmtKg(ideal.maxKg)} kg`
                      : undefined
                  }
                >
                  <Input
                    value={targetWeightKg}
                    onChangeText={setTargetWeightKg}
                    keyboardType="decimal-pad"
                    placeholder="70"
                  />
                </Field>
                {ideal && target !== null && target < ideal.minKg ? (
                  <Text style={styles.warning}>
                    Target di bawah rentang sehat. Boleh dilanjutkan, tapi pertimbangkan naikkan
                    sedikit agar tubuhmu tetap terjaga.
                  </Text>
                ) : null}
                <Field label="Tanggal target" hint="Format TAHUN-BULAN-TANGGAL, contoh 2026-12-15">
                  <Input value={targetDate} onChangeText={setTargetDate} placeholder="2026-12-15" />
                </Field>
                {formError ? <Text style={styles.error}>{formError}</Text> : null}
                <Button label="Lanjut" onPress={submitTarget} />
              </Card>
            </>
          ) : null}

          {step === 5 ? (
            <>
              <Text style={styles.stepTitle}>Seberapa aktif harimu?</Text>
              <Text style={styles.stepCaption}>Di luar olahraga: kerja, jalan kaki, rumah.</Text>
              <View style={styles.choiceList}>
                {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((key) => (
                  <ChoiceRow
                    key={key}
                    label={ACTIVITY_LABELS[key]}
                    selected={activityLevel === key}
                    onPress={() => setActivityLevel(key)}
                  />
                ))}
              </View>
              {formError ? <Text style={styles.error}>{formError}</Text> : null}
              <Button
                label="Simpan & Lihat Hasil"
                onPress={() => void submitAll()}
                loading={saving}
              />
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  pressedSoft: {
    opacity: 0.7,
  },
  progressRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: theme.spacing.md,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: theme.radius.pill,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  stepTitle: {
    fontSize: theme.fontSize.title,
    fontWeight: "800",
    letterSpacing: -0.5,
    color: theme.colors.foreground,
    marginTop: theme.spacing.sm,
  },
  stepCaption: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    marginTop: -theme.spacing.sm,
  },
  choiceList: {
    gap: theme.spacing.md,
  },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    borderRadius: theme.radius.tile,
    padding: 16,
    minHeight: 56,
  },
  choiceText: {
    flex: 1,
    gap: 2,
  },
  choiceLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
  },
  choiceDesc: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
  },
  resultCard: {
    alignItems: "flex-start",
  },
  resultLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  resultValue: {
    fontSize: theme.fontSize.hero,
    fontWeight: "800",
    letterSpacing: -1.5,
    color: theme.colors.foreground,
  },
  resultHint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  hint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
  warning: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.warning,
    lineHeight: 20,
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
}));
