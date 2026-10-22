import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { isFastLossDismissed } from "@joyorogo/api/lib/safety";
import type { FastLossNote as FastLossNoteData } from "@joyorogo/api/lib/safety";

import { Button, Text } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { readFastLossClosedOn, writeFastLossClosedOn } from "@/src/lib/fast-loss-store";
import { fmtDecimal } from "@/utils/format";

/**
 * One calm card when weight is falling fast or food has sat far below the body's resting need (`day.summary.fastLoss`,
 * today only; the server sends nothing for Hamil / Menyusui, gain plans or thin data). "Tutup" snoozes it on this phone
 * for a few days. `today` is the summary's day: the card only shows on a day the server judged.
 */
export function FastLossNote({ note, today }: { note: FastLossNoteData | null | undefined; today: string }) {
  const { t } = useTranslation("makan");
  const { theme } = useUnistyles();
  const { data: session } = authClient.useSession();
  const userId = session?.user.id ?? null;
  // Hidden until the stored stamp has been read, so a closed card never flashes.
  const [closedOn, setClosedOn] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    void readFastLossClosedOn(userId).then((stored) => {
      if (live) setClosedOn(stored);
    });
    return () => {
      live = false;
    };
  }, [userId]);

  if (!note || !userId || closedOn === undefined || isFastLossDismissed(closedOn, today)) return null;

  const body =
    note.reasons.length === 2
      ? t("safety.fastLoss.both", { pct: fmtDecimal(note.weeklyPct ?? 0, 1) })
      : note.reasons[0] === "weight"
        ? t("safety.fastLoss.weight", { pct: fmtDecimal(note.weeklyPct ?? 0, 1) })
        : t("safety.fastLoss.intake");

  return (
    <View style={styles.note}>
      <Ionicons
        name="information-circle-outline"
        size={18}
        color={theme.colors.mutedForeground}
        style={styles.icon}
      />
      <View style={styles.text}>
        <Text style={styles.title}>{t("safety.fastLoss.title")}</Text>
        <Text style={styles.body}>{body}</Text>
        <Text style={styles.hint}>{t("safety.fastLoss.hint")}</Text>
        <View style={styles.actions}>
          <Button
            variant="ghost"
            size="sm"
            label={t("safety.fastLoss.dismiss")}
            onPress={() => {
              setClosedOn(today);
              void writeFastLossClosedOn(userId, today);
            }}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  note: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.muted,
  },
  icon: {
    marginTop: 1,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  body: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.mutedForeground,
  },
  hint: {
    fontSize: theme.fontSize.xs,
    lineHeight: 17,
    color: theme.colors.mutedForeground,
  },
  actions: {
    alignItems: "flex-start",
    marginTop: theme.spacing.xs,
  },
}));
