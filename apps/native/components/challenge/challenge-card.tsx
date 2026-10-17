import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button, Card, Num, Text } from "@/components/ui";

import { challengeStatusLabel, type ChallengeListItem } from "./shared";

/** Fields of a challenge header the status wording depends on. */
export type ChallengeTiming = Pick<
  ChallengeListItem,
  "status" | "startsInDays" | "dayNumber" | "durationDays"
>;

/** Status pill: upcoming (tidur), running (makan), ended (muted). */
export function StatusChip({ challenge }: { challenge: ChallengeTiming }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation("challenge");
  const tone =
    challenge.status === "active"
      ? { bg: theme.colors.makanSoft, fg: theme.colors.makanText }
      : challenge.status === "upcoming"
        ? { bg: theme.colors.tidurSoft, fg: theme.colors.tidurText }
        : { bg: theme.colors.muted, fg: theme.colors.mutedForeground };
  return (
    <View style={[styles.chip, { backgroundColor: tone.bg }]}>
      <Text style={[styles.chipText, { color: tone.fg }]}>{challengeStatusLabel(t, challenge)}</Text>
    </View>
  );
}

/** One challenge of the group list: header, status, my progress, join. */
export function ChallengeCard({
  challenge,
  joining,
  onOpen,
  onJoin,
}: {
  challenge: ChallengeListItem;
  joining: boolean;
  onOpen: () => void;
  onJoin: () => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation("challenge");
  const c = challenge;
  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("card.open", { title: c.title })}
        onPress={onOpen}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <View style={styles.head}>
          <View style={styles.headText}>
            <Text style={styles.title}>{c.title}</Text>
            <Text style={styles.sub}>
              {c.goalLabel} • {c.rule}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.mutedForeground} />
        </View>

        <View style={styles.metaRow}>
          <StatusChip challenge={c} />
          <Text style={styles.meta}>{t("card.participants", { count: c.participants })}</Text>
        </View>

        {c.joined ? (
          <View style={styles.mine}>
            {c.status === "upcoming" ? (
              <Text style={styles.mineText}>{t("card.joined")}</Text>
            ) : c.judgedDays === 0 ? (
              <Text style={styles.mineText}>{t("card.firstDay")}</Text>
            ) : (
              <Num style={styles.mineText}>
                {t("card.progress", { hit: c.hitDays, judged: c.judgedDays })}
              </Num>
            )}
            {c.streak > 0 ? (
              <View style={[styles.streak, { backgroundColor: theme.colors.bakarSoft }]}>
                <Ionicons name="flame" size={12} color={theme.colors.bakarText} />
                <Num style={[styles.streakText, { color: theme.colors.bakarText }]}>{c.streak}</Num>
              </View>
            ) : null}
          </View>
        ) : null}
      </Pressable>

      {!c.joined && c.status !== "ended" ? (
        <View style={styles.actions}>
          <Button size="sm" icon="enter-outline" label={t("card.join")} loading={joining} onPress={onJoin} />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  pressed: {
    opacity: 0.7,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  headText: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
  },
  sub: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  chip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
  },
  chipText: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
  },
  meta: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  mine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  mineText: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
  },
  streak: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
  },
  streakText: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
  },
  actions: {
    flexDirection: "row",
    marginTop: theme.spacing.md,
  },
}));
