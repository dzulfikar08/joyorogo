import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { basisLabel, type Basis } from "@joyorogo/api/lib/challenge";

import { Avatar, Card, Num, Text } from "@/components/ui";

import { BASIS_ICON, fmtGoalValue, fmtShortDay, type ChallengeMember } from "./shared";

const BASIS_ORDER: Basis[] = ["device", "photo", "manual"];

/**
 * One participant: rank, name, hit days, streak, a dot per challenge day
 * (hit, miss, pending), today's value when visible, and how the hit days are
 * backed. Manual and photo days are labelled as such, never as verified.
 */
export function LeaderboardRow({ member, unit }: { member: ChallengeMember; unit: string }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation("challenge");
  const m = member;

  const todayLine =
    m.todayValue !== null
      ? `${t("board.today")} ${t("board.value", { value: fmtGoalValue(m.todayValue), unit })}${m.todayStatus === "hit" ? ` • ${t("board.day.hit")}` : ""}`
      : m.todayStatus === "hit"
        ? `${t("board.today")} ${t("board.day.hit")}`
        : null;

  const dotColor = {
    hit: theme.colors.primary,
    miss: theme.colors.bakar,
    pending: theme.colors.mutedForeground,
  } as const;

  return (
    <Card style={m.isMe ? { borderWidth: 1.5, borderColor: theme.colors.primary } : undefined}>
      <View style={styles.head}>
        <View style={[styles.rank, { backgroundColor: m.rank === 1 ? theme.colors.bakarSoft : theme.colors.muted }]}>
          <Num style={[styles.rankText, { color: m.rank === 1 ? theme.colors.bakarText : theme.colors.foreground }]}>
            {m.rank}
          </Num>
        </View>
        <Avatar name={m.name} image={m.image} size={40} />
        <View style={styles.headText}>
          <Text style={styles.name} numberOfLines={1}>
            {m.name}
            {m.isMe ? ` (${t("board.you")})` : ""}
          </Text>
          <Num style={styles.score}>
            {m.judgedDays === 0
              ? t("board.noJudged")
              : t("board.score", { hit: m.hitDays, judged: m.judgedDays })}
          </Num>
        </View>
        {m.streak > 0 ? (
          <View style={[styles.streak, { backgroundColor: theme.colors.bakarSoft }]}>
            <Ionicons name="flame" size={12} color={theme.colors.bakarText} />
            <Num style={[styles.streakText, { color: theme.colors.bakarText }]}>{m.streak}</Num>
          </View>
        ) : null}
      </View>

      <View
        style={styles.dots}
        accessible
        accessibilityLabel={t("board.dots", { hit: m.hitDays, total: m.totalDays })}
      >
        {m.days.map((day) => (
          <View
            key={day.date}
            accessibilityLabel={`${fmtShortDay(day.date)}: ${t(`board.day.${day.status}`)}`}
            style={[
              styles.dot,
              day.status === "pending"
                ? { borderWidth: 1.5, borderColor: dotColor.pending }
                : { backgroundColor: dotColor[day.status] },
            ]}
          />
        ))}
      </View>

      {todayLine ? <Text style={styles.today}>{todayLine}</Text> : null}
      {!m.hasData ? <Text style={styles.today}>{t("board.noData")}</Text> : null}

      {BASIS_ORDER.some((basis) => m.hitsByBasis[basis] > 0) ? (
        <View style={styles.basisRow}>
          {BASIS_ORDER.filter((basis) => m.hitsByBasis[basis] > 0).map((basis) => (
            <View
              key={basis}
              style={[
                styles.basis,
                {
                  backgroundColor: basis === "device" ? theme.colors.makanSoft : theme.colors.muted,
                },
              ]}
            >
              <Ionicons
                name={BASIS_ICON[basis]}
                size={12}
                color={basis === "device" ? theme.colors.makanText : theme.colors.mutedForeground}
              />
              <Text
                style={[
                  styles.basisText,
                  { color: basis === "device" ? theme.colors.makanText : theme.colors.mutedForeground },
                ]}
              >
                {basisLabel(basis)} {m.hitsByBasis[basis]}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  rank: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  rankText: {
    fontSize: theme.fontSize.sm,
    fontWeight: "800",
  },
  headText: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
  },
  score: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
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
  dots: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    marginTop: theme.spacing.md,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  today: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    marginTop: theme.spacing.sm,
  },
  basisRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  basis: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
  },
  basisText: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
  },
}));
