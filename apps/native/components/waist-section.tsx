import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Circle, Path, Rect, Svg, Text as SvgText } from "react-native-svg";

import { jakartaToday } from "@joyorogo/api/lib/engine";

import {
  Button,
  Card,
  Field,
  Input,
  ListGroup,
  ListRow,
  Num,
  Skeleton,
  Text,
} from "@/components/ui";
import { errorMessage, fmtDateMedium, fmtKg, parseNum } from "@/utils/format";
import { client, orpc } from "@/utils/orpc";
import { useOptimisticMutation } from "@/lib/optimistic";

/**
 * Lingkar perut section for the Berat screen. Sits below the weight content;
 * owns the waist history query and check-in mutation.
 */
export function WaistSection({
  gender,
  heightCm,
}: {
  gender: string | null;
  heightCm: number | null;
}) {
  const { theme } = useUnistyles();
  const [cm, setCm] = useState("");
  const [error, setError] = useState<string | null>(null);
  // null = follow the default (open without entries, collapsed otherwise).
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);

  const historyQuery = useQuery(orpc.waist.history.queryOptions({ input: { limit: 90 } }));

  const data = historyQuery.data ?? null;
  const entries = data?.entries ?? [];
  const loggedToday = data?.loggedToday ?? false;
  const assessment = data?.assessment ?? null;
  const latest = entries.length > 0 ? entries[entries.length - 1].waistCm : null;
  const deltaCm = data?.deltaCm ?? null;

  // Prefill with today's saved value so "Ubah" starts from the real number.
  // Runs only when the saved value changes, so the user can clear the field.
  useEffect(() => {
    if (loggedToday && latest !== null) {
      setCm(fmtKg(latest));
    }
  }, [loggedToday, latest]);

  type WaistCheckInInput = { waistCm: number };

  const checkIn = useOptimisticMutation<WaistCheckInInput, unknown>({
    mutationFn: (input) => client.waist.checkIn(input),
    success: (_input) => {
      setError(null);
      const previous = entries.at(-1)?.waistCm;
      return {
        message: "Lingkar perut dicatat",
        undo: previous === undefined ? undefined : () => checkIn.mutate({ waistCm: previous }),
      };
    },
    onError: (e) => setError(errorMessage(e)),
    invalidate: () => [orpc.waist.key(), orpc.day.key()],
  });

  const submit = () => {
    const num = parseNum(cm);
    if (num === null || num < 40 || num > 250) {
      setError("Isi lingkar perut antara 40 dan 250 cm.");
      return;
    }
    setError(null);
    checkIn.mutate({ waistCm: num });
  };

  // Personalised cutoff: from the assessment when present, else locally.
  const cutoffCm =
    assessment?.cutoffCm ?? (gender === "female" ? 80 : gender === "male" ? 90 : null);
  const halfHeightCm =
    assessment?.halfHeightCm ?? (heightCm !== null ? Math.round(heightCm * 5) / 10 : null);

  const open = openOverride ?? entries.length === 0;

  const statusTone =
    assessment?.band === "high"
      ? "destructive"
      : assessment?.overCutoff || assessment?.band === "raised"
        ? "warning"
        : "ok";
  const statusColor =
    statusTone === "destructive"
      ? theme.colors.destructive
      : statusTone === "warning"
        ? theme.colors.eatNear
        : theme.colors.makan;
  const statusText =
    assessment === null
      ? null
      : assessment.band === "high"
        ? "Rasio lingkar perut terhadap tinggi " +
          (assessment.ratio !== null ? fmtRatio(assessment.ratio) : "-") +
          ": risiko tinggi. Cek gula darah dan tekanan darah di puskesmas atau dokter."
        : assessment.overCutoff || assessment.band === "raised"
          ? "Di atas batas sehat. Turun beberapa cm saja sudah menurunkan risiko."
          : "Di bawah batas sehat. Pertahankan.";

  const recent = entries.slice(-5).toReversed();

  return (
    <Card>
      <Text style={styles.title}>Lingkar perut</Text>
      <Text style={styles.lead}>
        Berat badan tidak membedakan lemak dan otot. Lingkar perut menunjukkan lemak di sekitar
        organ dalam, yang paling terkait dengan diabetes dan penyakit jantung.
      </Text>

      {historyQuery.isPending ? (
        <Skeleton width="100%" height={180} radius={16} />
      ) : (
        <>
          <Field label="Lingkar perut (cm)">
            <View style={styles.inputRow}>
              <Input
                style={styles.input}
                value={cm}
                onChangeText={setCm}
                keyboardType="decimal-pad"
                placeholder="78,5"
              />
              <Button
                label={loggedToday ? "Ubah" : "Simpan"}
                variant={loggedToday ? "secondary" : "primary"}
                onPress={submit}
                loading={checkIn.isPending}
              />
            </View>
          </Field>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {loggedToday ? (
            <Text style={styles.note}>
              Tersimpan untuk hari ini. Menyimpan lagi menimpa angka tadi.
            </Text>
          ) : null}

          {assessment !== null && latest !== null ? (
            <View style={styles.statusBox}>
              <View style={styles.statusRow}>
                <Num style={styles.statusValue}>{fmtKg(latest)}</Num>
                <Text style={styles.statusUnit}>cm</Text>
              </View>
              {deltaCm !== null ? (
                <Text style={styles.note}>
                  <Num>
                    {deltaCm > 0 ? "+" : ""}
                    {fmtKg(deltaCm)}
                  </Num>{" "}
                  cm sejak ukuran pertama
                </Text>
              ) : null}
              <Text style={[styles.statusText, { color: statusColor }]}>{statusText}</Text>
            </View>
          ) : null}

          <View style={styles.standar}>
            <Text style={styles.standarTitle}>Standar</Text>
            <Text style={styles.note}>
              Batas obesitas sentral untuk orang Asia: pria 90 cm, wanita 80 cm.
              {cutoffCm !== null ? ` Batasmu ${cutoffCm} cm.` : ""}
            </Text>
            {heightCm !== null && halfHeightCm !== null ? (
              <Text style={styles.note}>
                Rasio lingkar perut terhadap tinggi badan sebaiknya di bawah 0,5. Untuk tinggi{" "}
                {heightCm.toLocaleString("id-ID")} cm, jaga lingkar perut di bawah{" "}
                {fmtKg(halfHeightCm)} cm.
              </Text>
            ) : null}
            <Text style={styles.footnote}>
              Sumber: WHO Asia Pasifik (2000), Kemenkes RI, WHO Expert Consultation (2008), NICE
              (2022).
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            onPress={() => setOpenOverride(!open)}
            style={styles.disclosureHead}
          >
            <Text style={styles.standarTitle}>Cara mengukur</Text>
            <Ionicons
              name={open ? "chevron-up" : "chevron-down"}
              size={18}
              color={theme.colors.mutedForeground}
            />
          </Pressable>
          {open ? (
            <View style={styles.howBox}>
              <WaistIllustration />
              {HOW_STEPS.map((step, i) => (
                <Text key={i} style={styles.step}>
                  {i + 1}. {step}
                </Text>
              ))}
              <Text style={styles.footnote}>
                Ukur pagi hari sebelum makan. Seminggu sekali sudah cukup.
              </Text>
            </View>
          ) : null}

          {recent.length > 0 ? (
            <View style={styles.recentBox}>
              <Text style={styles.standarTitle}>Terbaru</Text>
              <ListGroup>
                {recent.map((entry) => (
                  <ListRow
                    key={entry.id}
                    title={entry.date === jakartaToday() ? "Hari ini" : fmtDateMedium(entry.date)}
                    value={`${fmtKg(entry.waistCm)} cm`}
                  />
                ))}
              </ListGroup>
            </View>
          ) : null}
        </>
      )}
    </Card>
  );
}

/** "0,52" — two decimals with an Indonesian decimal comma. */
function fmtRatio(ratio: number): string {
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(ratio);
}

const HOW_STEPS = [
  "Berdiri tegak, kaki rapat, lengan rileks di samping badan.",
  "Raba tulang rusuk terbawah dan puncak tulang panggul. Lingkarkan pita ukur tepat di tengah keduanya.",
  "Pita mendatar sejajar lantai, menempel di kulit tapi tidak menekan.",
  "Baca angka di akhir buang napas biasa. Jangan menahan atau mengempiskan perut.",
];

/** Theme-mapped tape-measure illustration: ribs and pelvis guides in muted
    foreground, the tape and bracket in primary green. */
function WaistIllustration() {
  const { theme } = useUnistyles();
  const c = theme.colors;
  return (
    <Svg
      viewBox="0 0 320 230"
      width="100%"
      height={230}
      accessibilityLabel="Ilustrasi: pita ukur dilingkarkan di tengah antara tulang rusuk terbawah dan puncak tulang panggul"
      accessibilityRole="image"
    >
      {/* Torso outline */}
      <Path
        d="M88 2 V14 Q62 18 40 30 C46 70 58 95 64 120 C58 145 48 170 46 226 M112 2 V14 Q138 18 160 30 C154 70 142 95 136 120 C142 145 152 170 154 226"
        fill="none"
        stroke={c.mutedForeground}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Lowest rib guide */}
      <Path
        d="M62 94 Q100 116 138 94"
        fill="none"
        stroke={c.mutedForeground}
        strokeWidth={2}
        strokeDasharray="5 4"
        strokeLinecap="round"
      />
      {/* Pelvic crest guides */}
      <Path
        d="M58 166 Q72 150 88 163 M112 163 Q128 150 142 166"
        fill="none"
        stroke={c.mutedForeground}
        strokeWidth={2}
        strokeDasharray="5 4"
        strokeLinecap="round"
      />
      <Circle cx={100} cy={142} r={2.5} fill={c.mutedForeground} />
      {/* Tape */}
      <Rect x={60} y={122} width={80} height={12} rx={3} fill={c.primary} />
      <Path
        d="M72 122v5M84 122v7M96 122v5M108 122v7M120 122v5M132 122v7"
        stroke={c.card}
        strokeWidth={1.5}
      />
      {/* Half-height bracket */}
      <Path
        d="M30 104 V158 M26 104 H34 M26 158 H34 M26 128 H34"
        stroke={c.primary}
        strokeWidth={1.5}
        fill="none"
      />
      {/* Callouts */}
      <Path d="M132 100 L170 78" stroke={c.mutedForeground} strokeWidth={1} />
      <SvgText x={174} y={76} fontSize={13} fill={c.foreground}>
        Tulang rusuk terbawah
      </SvgText>
      <Path d="M144 128 L170 128" stroke={c.primary} strokeWidth={1.5} />
      <SvgText x={174} y={126} fontSize={13} fontWeight="700" fill={c.primary}>
        Ukur di sini:
      </SvgText>
      <SvgText x={174} y={141} fontSize={13} fill={c.foreground}>
        tengah-tengahnya
      </SvgText>
      <Path d="M138 160 L170 184" stroke={c.mutedForeground} strokeWidth={1} />
      <SvgText x={174} y={188} fontSize={13} fill={c.foreground}>
        Puncak tulang panggul
      </SvgText>
    </Svg>
  );
}

const styles = StyleSheet.create((theme) => ({
  title: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  lead: {
    marginTop: 6,
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  input: {
    flex: 1,
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
  note: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
  statusBox: {
    marginTop: 16,
    gap: 6,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  statusValue: {
    fontSize: theme.fontSize.hero,
    fontWeight: "800",
    letterSpacing: -1.5,
    color: theme.colors.foreground,
  },
  statusUnit: {
    fontSize: theme.fontSize.lg,
    color: theme.colors.mutedForeground,
  },
  statusText: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    lineHeight: 20,
  },
  standar: {
    marginTop: 16,
    gap: 6,
  },
  standarTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  footnote: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    lineHeight: 18,
  },
  disclosureHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
    marginTop: 8,
  },
  howBox: {
    gap: 8,
  },
  step: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    lineHeight: 20,
  },
  recentBox: {
    marginTop: 16,
    gap: 8,
  },
}));
