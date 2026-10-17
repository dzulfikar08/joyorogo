import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Circle, Path, Rect, Svg, Text as SvgText } from "react-native-svg";

import { jakartaToday } from "@joyorogo/api/lib/engine";

import { Disclosure } from "@/components/disclosure";
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
import { errorMessage, fmtDateMedium, fmtInt, fmtKg, fmtRatio, parseNum } from "@/utils/format";
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
  const { t } = useTranslation(["berat", "common"]);
  const [cm, setCm] = useState("");
  const [error, setError] = useState<string | null>(null);

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
    success: (input) => {
      setError(null);
      const previous = entries.at(-1)?.waistCm;
      return {
        message: t("toast.waistLogged", { cm: fmtKg(input.waistCm) }),
        undo: previous === undefined ? undefined : () => checkIn.mutate({ waistCm: previous }),
      };
    },
    onError: (e) => setError(errorMessage(e)),
    invalidate: () => [orpc.waist.key(), orpc.day.key()],
  });

  const submit = () => {
    const num = parseNum(cm);
    if (num === null || num < 40 || num > 250) {
      setError(t("waist.error.range", { min: 40, max: 250 }));
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
        ? t("waist.status.high", {
            ratio: assessment.ratio !== null ? fmtRatio(assessment.ratio) : "-",
          })
        : assessment.overCutoff || assessment.band === "raised"
          ? t("waist.status.above")
          : t("waist.status.below");

  const recent = entries.slice(-5).toReversed();

  return (
    <Card>
      <Text style={styles.title}>{t("waist.title")}</Text>

      {historyQuery.isPending ? (
        <Skeleton width="100%" height={180} radius={16} />
      ) : (
        <>
          <Field label={t("waist.inputLabel")}>
            <View style={styles.inputRow}>
              <Input
                style={styles.input}
                value={cm}
                onChangeText={setCm}
                keyboardType="decimal-pad"
                placeholder="78,5"
              />
              <Button
                label={loggedToday ? t("common:actions.edit") : t("common:actions.save")}
                variant={loggedToday ? "secondary" : "primary"}
                onPress={submit}
                loading={checkIn.isPending}
              />
            </View>
          </Field>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {loggedToday ? <Text style={styles.note}>{t("waist.loggedToday")}</Text> : null}

          {assessment !== null && latest !== null ? (
            <View style={styles.statusBox}>
              <View style={styles.statusRow}>
                <Num style={styles.statusValue}>{fmtKg(latest)}</Num>
                <Text style={styles.statusUnit}>cm</Text>
              </View>
              {deltaCm !== null ? (
                <Num style={styles.note}>
                  {t("waist.sinceFirst", {
                    delta: `${deltaCm > 0 ? "+" : ""}${fmtKg(deltaCm)}`,
                  })}
                </Num>
              ) : null}
              <Text style={[styles.statusText, { color: statusColor }]}>{statusText}</Text>
            </View>
          ) : null}

          {recent.length > 0 ? (
            <View style={styles.recentBox}>
              <Text style={styles.standarTitle}>{t("waist.latest")}</Text>
              <ListGroup>
                {recent.map((entry) => (
                  <ListRow
                    key={entry.id}
                    title={
                      entry.date === jakartaToday()
                        ? t("common:date.today")
                        : fmtDateMedium(entry.date)
                    }
                    value={`${fmtKg(entry.waistCm)} cm`}
                  />
                ))}
              </ListGroup>
            </View>
          ) : null}

          <Disclosure plain title={t("waist.about.title")}>
            <Text style={styles.note}>{t("waist.about.intro")}</Text>

            <View style={styles.standar}>
              <Text style={styles.standarTitle}>{t("waist.standard.title")}</Text>
              <Text style={styles.note}>
                {t("waist.standard.cutoff")}
                {cutoffCm !== null ? ` ${t("waist.standard.cutoffYours", { cm: cutoffCm })}` : ""}
              </Text>
              {heightCm !== null && halfHeightCm !== null ? (
                <Text style={styles.note}>
                  {t("waist.standard.ratio", {
                    height: fmtInt(heightCm),
                    half: fmtKg(halfHeightCm),
                  })}
                </Text>
              ) : null}
              <Text style={styles.footnote}>{t("waist.standard.source")}</Text>
            </View>

            <View style={styles.howBox}>
              <Text style={styles.standarTitle}>{t("waist.guide.title")}</Text>
              <WaistIllustration />
              {STEP_KEYS.map((key, i) => (
                <Text key={key} style={styles.step}>
                  {i + 1}. {t(key)}
                </Text>
              ))}
              <Text style={styles.footnote}>{t("waist.guide.tip")}</Text>
            </View>
          </Disclosure>
        </>
      )}
    </Card>
  );
}

const STEP_KEYS = [
  "waist.guide.step1",
  "waist.guide.step2",
  "waist.guide.step3",
  "waist.guide.step4",
] as const;

/** Theme-mapped tape-measure illustration: ribs and pelvis guides in muted
    foreground, the tape and bracket in primary green. */
function WaistIllustration() {
  const { t } = useTranslation("berat");
  const { theme } = useUnistyles();
  const c = theme.colors;
  return (
    <Svg
      viewBox="0 0 320 230"
      width="100%"
      height={230}
      accessibilityLabel={t("waist.illustration.alt")}
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
        {t("waist.illustration.ribs")}
      </SvgText>
      <Path d="M144 128 L170 128" stroke={c.primary} strokeWidth={1.5} />
      <SvgText x={174} y={126} fontSize={13} fontWeight="700" fill={c.primary}>
        {t("waist.illustration.measureHere")}
      </SvgText>
      <SvgText x={174} y={141} fontSize={13} fill={c.foreground}>
        {t("waist.illustration.middle")}
      </SvgText>
      <Path d="M138 160 L170 184" stroke={c.mutedForeground} strokeWidth={1} />
      <SvgText x={174} y={188} fontSize={13} fill={c.foreground}>
        {t("waist.illustration.pelvis")}
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
