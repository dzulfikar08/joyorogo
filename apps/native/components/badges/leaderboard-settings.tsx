import "@/unistyles";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { useBadges } from "@/components/badges/use-badges";
import { Button, Card, Input, Segmented, Text } from "@/components/ui";
import { useToast } from "@/components/toast";
import { errorMessage } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

type Mode = "username" | "anonim";
type Prefs = { optIn: boolean; displayMode: Mode; alias: string | null; aliasMin: number; aliasMax: number; eligible: boolean };

function PrefsForm({ prefs }: { prefs: Prefs }) {
  const { t } = useTranslation("badges");
  const { theme } = useUnistyles();
  const toast = useToast();
  const [optIn, setOptIn] = useState(prefs.optIn);
  const [mode, setMode] = useState<Mode>(prefs.displayMode);
  const [alias, setAlias] = useState(prefs.alias ?? "");
  const save = useMutation(
    orpc.leaderboard.setPrefs.mutationOptions({
      onSuccess: () => {
        toast.success(t("board.saved"));
        void queryClient.invalidateQueries({ queryKey: orpc.leaderboard.key() });
      },
    }),
  );
  const clean = alias.trim().toLowerCase();
  const dirty = optIn !== prefs.optIn || mode !== prefs.displayMode || clean !== (prefs.alias ?? "");

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{t("board.title")}</Text>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>{t("board.optIn")}</Text>
        <Switch
          value={optIn && prefs.eligible}
          disabled={!prefs.eligible}
          onValueChange={setOptIn}
          trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
          thumbColor={theme.colors.background}
          accessibilityLabel={t("board.optIn")}
        />
      </View>
      {prefs.eligible ? <Text style={styles.body}>{t("board.consent")}</Text> : <Text style={styles.body}>{t("board.maternal")}</Text>}
      {prefs.eligible ? (
        <>
          <Text style={styles.label}>{t("board.displayMode")}</Text>
          <Segmented<Mode>
            options={[
              { value: "username", label: t("board.displayUsername") },
              { value: "anonim", label: t("board.displayAnonymous") },
            ]}
            value={mode}
            onChange={setMode}
          />
          {mode === "anonim" ? (
            <View style={styles.aliasBlock}>
              <Text style={styles.label}>{t("board.alias")}</Text>
              <Input
                value={alias}
                onChangeText={setAlias}
                placeholder={t("board.aliasPlaceholder")}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={prefs.aliasMax}
                accessibilityLabel={t("board.alias")}
              />
              <Text style={styles.body}>{t("board.aliasHint", { min: prefs.aliasMin, max: prefs.aliasMax })}</Text>
            </View>
          ) : null}
          {save.isError ? <Text style={styles.error}>{errorMessage(save.error)}</Text> : null}
          <Button
            label={t("board.save")}
            loading={save.isPending}
            disabled={!dirty}
            onPress={() => save.mutate({ optIn, displayMode: mode, alias: clean === "" ? null : clean })}
          />
          <Text style={styles.body}>{t("board.optOutNote")}</Text>
        </>
      ) : null}
    </Card>
  );
}

/** Privasi section: opt in to the weekly board, pick username or alias. Hidden when the feature is off. */
export function LeaderboardSettings() {
  const badges = useBadges();
  const enabled = badges.data?.enabled === true;
  const prefs = useQuery(orpc.leaderboard.prefs.queryOptions({ enabled, retry: false }));
  if (!enabled || !prefs.data || !prefs.data.enabled) return null;
  return <PrefsForm prefs={prefs.data} />;
}

const styles = StyleSheet.create((theme) => ({
  card: { gap: theme.spacing.md },
  title: { fontSize: theme.fontSize.md, fontWeight: "700", color: theme.colors.foreground },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.spacing.md, minHeight: 48 },
  switchLabel: { flex: 1, fontSize: theme.fontSize.base, fontWeight: "600", color: theme.colors.foreground },
  body: { fontSize: theme.fontSize.sm, lineHeight: 20, color: theme.colors.mutedForeground },
  label: { fontSize: theme.fontSize.sm, fontWeight: "700", color: theme.colors.foreground },
  aliasBlock: { gap: theme.spacing.sm },
  error: { fontSize: theme.fontSize.sm, fontWeight: "600", color: theme.colors.destructiveText },
}));
