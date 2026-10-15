import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import {
  CHALLENGE_DURATIONS,
  CHALLENGE_TITLE_MAX,
  GOALS,
  GOAL_ORDER,
  MAX_START_AHEAD_DAYS,
  challengeEndDate,
  defaultChallengeTitle,
  validateChallengeInput,
} from "@joyorogo/api/lib/challenge";
import type { ChallengeGoal } from "@joyorogo/api/lib/challenge";
import { jakartaToday, shiftDate } from "@joyorogo/api/lib/engine";

import { Button, Chip, Field, Input, Segmented, Sheet, Text } from "@/components/ui";
import { errorMessage, parseNum } from "@/utils/format";
import { isPaywallError, orpc, queryClient } from "@/utils/orpc";

import { challengeHref, fmtGoalValue, fmtShortDay } from "./shared";

const START_OFFSETS = Array.from({ length: MAX_START_AHEAD_DAYS + 1 }, (_, offset) => offset);

/** Target text as the user types it: decimal comma, like parseNum reads. */
const toInput = (value: number) => String(value).replace(".", ",");

const defaultTargetText = (goal: ChallengeGoal) => {
  const range = GOALS[goal].range;
  return range ? toInput(range.default) : "";
};

/**
 * Host form for a new group challenge: goal, target (fixed goals only),
 * length, start day and an optional title. Validated live with the same rules
 * the server applies; the server's message is shown inline when it still
 * refuses. A Founder-only gate that slips through opens the upsell.
 */
export function CreateChallengeSheet({
  visible,
  groupId,
  onClose,
  onPaywall,
}: {
  visible: boolean;
  groupId: string;
  onClose: () => void;
  /** Server said Founder only: the screen opens the Founder paywall. */
  onPaywall: () => void;
}) {
  const { theme } = useUnistyles();
  const router = useRouter();
  const today = useMemo(() => jakartaToday(), [visible]);

  const [goal, setGoal] = useState<ChallengeGoal>("steps");
  const [targetText, setTargetText] = useState(defaultTargetText("steps"));
  const [durationDays, setDurationDays] = useState<number>(7);
  const [startOffset, setStartOffset] = useState(0);
  const [title, setTitle] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setGoal("steps");
    setTargetText(defaultTargetText("steps"));
    setDurationDays(7);
    setStartOffset(0);
    setTitle("");
    setServerError(null);
  }, [visible]);

  const spec = GOALS[goal];
  const range = spec.range;
  const target = range ? parseNum(targetText) : null;
  const startDate = shiftDate(today, startOffset);
  const liveError = validateChallengeInput({ goal, target, durationDays, startDate }, today);

  const create = useMutation(
    orpc.challenge.create.mutationOptions({
      onSuccess: async (data) => {
        await queryClient.invalidateQueries({ queryKey: orpc.challenge.key() });
        onClose();
        router.push(challengeHref(groupId, data.id));
      },
      onError: (e) => {
        if (isPaywallError(e)) {
          onClose();
          onPaywall();
          return;
        }
        setServerError(errorMessage(e));
      },
    }),
  );

  const edit = <T,>(set: (value: T) => void) => (value: T) => {
    setServerError(null);
    set(value);
  };

  const pickGoal = (next: ChallengeGoal) => {
    setServerError(null);
    setGoal(next);
    setTargetText(defaultTargetText(next));
  };

  /** One step up or down, snapped onto the goal's step grid inside its range. */
  const bump = (direction: 1 | -1) => {
    if (!range) return;
    const current = target ?? range.default;
    const snapped = range.min + Math.round((current - range.min) / range.step) * range.step;
    const next = Math.min(range.max, Math.max(range.min, snapped + direction * range.step));
    setServerError(null);
    setTargetText(toInput(next));
  };

  const submit = () => {
    setServerError(null);
    create.mutate({
      groupId,
      title: title.trim() || undefined,
      goal,
      target,
      durationDays,
      startDate: startOffset === 0 ? undefined : startDate,
    });
  };

  const error = serverError ?? liveError;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Buat tantangan"
      footer={
        <View style={styles.footer}>
          {error ? <Text style={[styles.error, { color: theme.colors.destructive }]}>{error}</Text> : null}
          <Button
            label="Buat tantangan"
            disabled={liveError !== null}
            loading={create.isPending}
            onPress={submit}
          />
        </View>
      }
    >
      <View style={styles.form}>
        <Field label="Jenis tantangan">
          <View style={styles.goals}>
            {GOAL_ORDER.map((id) => {
              const option = GOALS[id];
              const selected = id === goal;
              return (
                <Pressable
                  key={id}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected }}
                  onPress={() => pickGoal(id)}
                  style={({ pressed }) => [
                    styles.goal,
                    {
                      backgroundColor: selected ? theme.colors.makanSoft : theme.colors.muted,
                      borderColor: selected ? theme.colors.primary : "transparent",
                    },
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.goalText}>
                    <Text style={styles.goalLabel}>{option.label}</Text>
                    <Text style={styles.goalBlurb}>{option.blurb}</Text>
                  </View>
                  {selected ? (
                    <Ionicons name="checkmark-circle" size={20} color={theme.colors.primary} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.source}>{spec.source}</Text>
        </Field>

        {range ? (
          <Field
            label={`Target (${spec.unit})`}
            hint={`Antara ${fmtGoalValue(range.min)} dan ${fmtGoalValue(range.max)}, kelipatan ${fmtGoalValue(range.step)}.`}
          >
            <View style={styles.chips}>
              {range.presets.map((preset) => (
                <Chip
                  key={preset}
                  label={fmtGoalValue(preset)}
                  selected={target === preset}
                  onPress={() => {
                    setServerError(null);
                    setTargetText(toInput(preset));
                  }}
                />
              ))}
            </View>
            <View style={styles.stepper}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Kurangi target"
                onPress={() => bump(-1)}
                style={({ pressed }) => [
                  styles.step,
                  { backgroundColor: theme.colors.muted },
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons name="remove" size={22} color={theme.colors.foreground} />
              </Pressable>
              <View style={styles.stepInput}>
                <Input
                  value={targetText}
                  onChangeText={edit(setTargetText)}
                  keyboardType="decimal-pad"
                  accessibilityLabel={`Target ${spec.unit}`}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Tambah target"
                onPress={() => bump(1)}
                style={({ pressed }) => [
                  styles.step,
                  { backgroundColor: theme.colors.muted },
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons name="add" size={22} color={theme.colors.foreground} />
              </Pressable>
            </View>
          </Field>
        ) : (
          <View style={[styles.note, { backgroundColor: theme.colors.tidurSoft }]}>
            <Ionicons name="information-circle" size={18} color={theme.colors.tidurText} />
            <Text style={[styles.noteText, { color: theme.colors.tidurText }]}>
              Targetnya ikut profil tiap peserta dan dibekukan saat mereka bergabung.
            </Text>
          </View>
        )}

        <Field label="Durasi">
          <Segmented
            options={CHALLENGE_DURATIONS.map((days) => ({ value: String(days), label: `${days} hari` }))}
            value={String(durationDays)}
            onChange={edit((value: string) => setDurationDays(Number(value)))}
          />
        </Field>

        <Field label="Mulai" hint={`Berakhir ${fmtShortDay(challengeEndDate(startDate, durationDays))}.`}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {START_OFFSETS.map((offset) => (
              <Chip
                key={offset}
                label={
                  offset === 0
                    ? "Hari ini"
                    : offset === 1
                      ? "Besok"
                      : fmtShortDay(shiftDate(today, offset))
                }
                selected={offset === startOffset}
                onPress={() => edit(setStartOffset)(offset)}
              />
            ))}
          </ScrollView>
        </Field>

        <Field
          label="Nama tantangan (opsional)"
          hint={`Kosongkan untuk nama otomatis. ${title.length}/${CHALLENGE_TITLE_MAX}`}
        >
          <Input
            value={title}
            onChangeText={edit(setTitle)}
            maxLength={CHALLENGE_TITLE_MAX}
            placeholder={defaultChallengeTitle(goal, target, durationDays)}
          />
        </Field>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: {
    gap: theme.spacing.lg,
  },
  footer: {
    gap: theme.spacing.sm,
  },
  error: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.7,
  },
  goals: {
    gap: theme.spacing.sm,
  },
  goal: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.tile,
    borderWidth: 1.5,
  },
  goalText: {
    flex: 1,
    gap: 2,
  },
  goalLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
  },
  goalBlurb: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  source: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    marginTop: theme.spacing.xs,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  chipRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  step: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.input,
    alignItems: "center",
    justifyContent: "center",
  },
  stepInput: {
    flex: 1,
  },
  note: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.radius.tile,
  },
  noteText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
  },
}));
