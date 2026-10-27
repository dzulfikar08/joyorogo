import "@/unistyles";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { useBadges } from "@/components/badges/use-badges";
import { Button, Card, EmptyState, ErrorState, Num, SectionTitle, Segmented, Skeleton, Text } from "@/components/ui";
import { useToast } from "@/components/toast";
import { shiftWeeks, weekMonday } from "@/src/lib/badges";
import { errorMessage } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

type Week = "this" | "last";

/** The board is offered only when the feature is on for this person and the server answers `prefs`. */
export function useLeaderboardAvailable(): boolean {
  const badges = useBadges();
  const enabled = badges.data?.enabled === true;
  const prefs = useQuery(orpc.leaderboard.prefs.queryOptions({ enabled, retry: false }));
  return enabled && prefs.data?.enabled === true;
}

function DaysRow({ days, label }: { days: boolean[]; label: string }) {
  return (
    <View style={styles.days} accessible accessibilityLabel={label}>
      {Array.from({ length: 7 }, (_, i) => (
        <View key={i} style={[styles.dot, days[i] && styles.dotOn]} />
      ))}
    </View>
  );
}

type Row = {
  rank: number;
  name: string | null;
  anonymous: boolean;
  isMe: boolean;
  daysLogged: number;
  days: boolean[];
};

function BoardRowView({ row }: { row: Row }) {
  const { t } = useTranslation("badges");
  const name = row.anonymous || !row.name ? t("board.anonymous", { rank: row.rank }) : row.name;
  return (
    <View style={[styles.row, row.isMe && styles.rowMe]}>
      <Num style={styles.rank}>{t("board.rank", { rank: row.rank })}</Num>
      <View style={styles.rowMain}>
        <Text style={styles.name} numberOfLines={1}>
          {row.isMe ? `${name} (${t("board.you")})` : name}
        </Text>
        <DaysRow days={row.days} label={t("board.rowDays", { n: row.daysLogged })} />
      </View>
      <Num style={styles.count}>{row.daysLogged}</Num>
    </View>
  );
}

/**
 * Weekly consistency board: `scope="team"` with a group's id, or `scope="global"`. Handles the opt-in call to action,
 * the maternal notice and the empty state itself. Renders nothing when the feature is off.
 */
export function Leaderboard({ scope, teamId }: { scope: "global" | "team"; teamId?: string }) {
  const { t } = useTranslation("badges");
  const toast = useToast();
  const badges = useBadges();
  const enabled = badges.data?.enabled === true;
  const prefs = useQuery(orpc.leaderboard.prefs.queryOptions({ enabled, retry: false }));
  const [week, setWeek] = useState<Week>("this");
  const p = prefs.data;
  const showBoard = enabled && p?.enabled === true && p.eligible && p.optIn;
  const weekInput = week === "last" ? shiftWeeks(weekMonday(Date.now()), 1) : undefined;
  const board = useQuery(
    orpc.leaderboard.board.queryOptions({
      input: { scope, teamId, week: weekInput },
      enabled: showBoard,
      retry: false,
    }),
  );
  const optIn = useMutation(
    orpc.leaderboard.setPrefs.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.leaderboard.key() }),
      onError: (e) => toast.error(t("board.title"), errorMessage(e)),
    }),
  );

  if (!enabled || p?.enabled === false) return null;
  if (prefs.isPending || badges.isPending) return <Skeleton width="100%" height={200} radius={24} />;
  if (prefs.isError || !p) return <ErrorState message={errorMessage(prefs.error)} onRetry={() => prefs.refetch()} />;

  if (!p.eligible) {
    return (
      <Card>
        <Text style={styles.body}>{t("board.maternal")}</Text>
      </Card>
    );
  }

  if (!p.optIn) {
    return (
      <Card style={styles.cta}>
        <Text style={styles.ctaTitle}>{t("board.title")}</Text>
        <Text style={styles.body}>{t("board.optInBody")}</Text>
        <Button
          label={t("board.optInCta")}
          loading={optIn.isPending}
          onPress={() => optIn.mutate({ optIn: true, displayMode: p.displayMode, alias: p.alias })}
        />
      </Card>
    );
  }

  const data = board.data;
  const pinned = data?.me && !data.rows.some((r) => r.isMe) ? data.me : null;
  return (
    <View style={styles.stack}>
      <Segmented<Week>
        options={[
          { value: "this", label: t("board.thisWeek") },
          { value: "last", label: t("board.lastWeek") },
        ]}
        value={week}
        onChange={setWeek}
      />
      {board.isError ? (
        <ErrorState message={errorMessage(board.error)} onRetry={() => board.refetch()} />
      ) : !data ? (
        <Skeleton width="100%" height={220} radius={24} />
      ) : data.rows.length === 0 ? (
        <EmptyState pose="watch" title={t("board.empty")} description={t("board.emptyHint")} />
      ) : (
        <>
          <SectionTitle title={t("board.total", { count: data.total })} />
          <Card style={styles.list}>
            {data.rows.map((row) => (
              <BoardRowView key={row.rank} row={row} />
            ))}
            {pinned ? (
              <>
                <View style={styles.sep} />
                <BoardRowView row={pinned} />
              </>
            ) : null}
          </Card>
          {!data.me ? <Text style={styles.note}>{t("board.notRanked")}</Text> : null}
          <Text style={styles.note}>{t("board.streakNote")}</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  stack: { gap: theme.spacing.md },
  cta: { gap: theme.spacing.md },
  ctaTitle: { fontSize: theme.fontSize.md, fontWeight: "700", color: theme.colors.foreground },
  body: { fontSize: theme.fontSize.sm, lineHeight: 20, color: theme.colors.mutedForeground },
  note: { fontSize: theme.fontSize.xs, lineHeight: 18, color: theme.colors.mutedForeground },
  list: { gap: 2, padding: theme.spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.input,
  },
  rowMe: { backgroundColor: theme.colors.makanSoft },
  rank: { width: 36, fontSize: theme.fontSize.sm, fontWeight: "800", color: theme.colors.mutedForeground },
  rowMain: { flex: 1, gap: 6 },
  name: { fontSize: theme.fontSize.base, fontWeight: "700", color: theme.colors.foreground },
  count: { fontSize: theme.fontSize.md, fontWeight: "800", color: theme.colors.foreground },
  days: { flexDirection: "row", gap: 4 },
  dot: { width: 14, height: 14, borderRadius: 7, backgroundColor: theme.colors.muted },
  dotOn: { backgroundColor: theme.colors.primary },
  sep: { height: 1, backgroundColor: theme.colors.hairline, marginVertical: theme.spacing.xs },
}));
