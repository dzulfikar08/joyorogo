import "@/unistyles";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { Switch, View } from "react-native";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { i18n, LOCALES, LOCALE_NAMES } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

import { Card, ListGroup, ListRow, Segmented, Text } from "@/components/ui";
import { serverUrl } from "@/components/billing";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { useToast } from "@/components/toast";
import { setLocale } from "@/src/lib/i18n";
import { applyThemePref, saveThemePref } from "@/src/lib/theme-pref";
import { syncPrefs } from "@/src/lib/prefs-sync";
import { loadScanSimple, saveScanSimple } from "@/src/lib/scan-prefs";
import { errorMessage } from "@/utils/format";
import { client, orpc, queryClient } from "@/utils/orpc";
import { useDelayedDelete, useOptimisticMutation } from "@/lib/optimistic";

/** Share-progress public page toggle + copy link (profile.shareToggle). */
export function ShareRow() {
  const { t } = useTranslation(["settings", "common"]);
  const { theme } = useUnistyles();
  const profileQuery = useQuery(orpc.profile.myProfile.queryOptions());
  const toggle = useOptimisticMutation<
    { enabled: boolean },
    unknown,
    boolean | undefined
  >({
    mutationFn: (input) => client.profile.shareToggle(input),
    patch: (input, cache) => {
      const key = orpc.profile.myProfile.queryOptions().queryKey;
      const previous = queryClient.getQueryData<{ profile?: { shareEnabled?: boolean } | null }>(
        key,
      )?.profile?.shareEnabled;
      cache.value<{ profile?: Record<string, unknown> | null }>(key, (old) => ({
        profile: { ...old?.profile, shareEnabled: input.enabled },
      }));
      return previous;
    },
    success: (_input, _data, previous) => ({
      message: t("toast.saved"),
      undo:
        previous === undefined
          ? undefined
          : () => toggle.mutate({ enabled: previous }),
    }),
    invalidate: () => [orpc.profile.key()],
  });
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 5000);
    return () => clearTimeout(timer);
  }, [copied]);

  const enabled = profileQuery.data?.profile?.shareEnabled ?? false;
  const code = profileQuery.data?.profile?.shareCode ?? null;
  if (profileQuery.data?.profile == null) return null;

  const copyLink = async () => {
    if (!code) return;
    // Web builds the same URL: server origin + /u/<shareCode>.
    await Clipboard.setStringAsync(`${serverUrl()}/u/${code}`);
    setCopied(true);
  };

  return (
    <View>
      <Card>
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.rowTitle}>{t("privacy.share.titleNative")}</Text>
            <Text style={styles.note}>{t("privacy.share.hintNative")}</Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={(value) => {
              setCopied(false);
              toggle.mutate({ enabled: value });
            }}
            trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
            thumbColor={theme.colors.background}
            accessibilityLabel={t("privacy.share.titleNative")}
          />
        </View>
        {toggle.isError ? <Text style={styles.error}>{errorMessage(toggle.error)}</Text> : null}
      </Card>
      {enabled && code ? (
        <>
          <ListGroup style={styles.shareLinkGroup}>
            <ListRow
              icon="link"
              iconTint="muted"
              title={t("privacy.share.copyLink")}
              value={`/u/${code}`}
              chevron
              onPress={() => void copyLink()}
            />
          </ListGroup>
          {copied ? (
            <Text style={styles.copiedNote}>{t("privacy.share.copied")}</Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

export type ThemeValue = "light" | "dark" | "system";

export function AppearanceList() {
  const { t } = useTranslation(["settings", "common"]);
  const { rt } = useUnistyles();
  // rt.themeName is undefined while adaptive (following the OS).
  const current: ThemeValue = rt.themeName ?? "system";
  const options: Array<{ value: ThemeValue; label: string }> = [
    { value: "light", label: t("theme.light") },
    { value: "dark", label: t("theme.dark") },
    { value: "system", label: t("theme.system") },
  ];

  const pick = (value: ThemeValue) => {
    applyThemePref(value);
    void saveThemePref(value);
  };

  return (
    <Card>
      <Text style={styles.cardTitle}>{t("section.appearance")}</Text>
      <Segmented options={options} value={current} onChange={pick} />
      <Text style={styles.note}>{t("theme.hint")}</Text>
    </Card>
  );
}

/** App language: applies at once on this device, then saves on the account. */
export function LanguageList() {
  const { t, i18n: instance } = useTranslation(["settings", "common"]);
  const toast = useToast();
  const save = useMutation(
    orpc.profile.setLocale.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: orpc.profile.myProfile.queryOptions().queryKey }),
      onError: () => toast.error(i18n.t("settings:language.saveError")),
    }),
  );

  const pick = (locale: Locale) => {
    if (locale === instance.language) return;
    // Patch the cached profile first so LocaleSync keeps the new choice instead
    // of re-applying the old saved one while the request is in flight.
    queryClient.setQueryData(orpc.profile.myProfile.queryOptions().queryKey, (data) =>
      data?.profile ? ({ ...data, profile: { ...data.profile, locale } } as typeof data) : data,
    );
    void setLocale(locale);
    save.mutate({ locale });
  };

  return (
    <Card>
      <Text style={styles.cardTitle}>{t("language.title")}</Text>
      <Segmented
        options={LOCALES.map((locale) => ({ value: locale, label: LOCALE_NAMES[locale] }))}
        value={instance.language as Locale}
        onChange={pick}
      />
      <Text style={styles.note}>{t("language.caption")}</Text>
    </Card>
  );
}

export function RamadanList({ mode, maternal }: { mode: "auto" | "on" | "off"; maternal: boolean }) {
  const { t } = useTranslation(["settings", "common", "maternal"]);
  const options: Array<{ value: "auto" | "on" | "off"; label: string }> = [
    { value: "auto", label: t("ramadan.option.auto") },
    { value: "on", label: t("ramadan.option.on") },
    { value: "off", label: t("ramadan.option.off") },
  ];
  const setMode = useOptimisticMutation<
    { mode: "auto" | "on" | "off" },
    unknown,
    "auto" | "on" | "off" | undefined
  >({
    mutationFn: (input) => client.profile.setRamadanMode(input),
    patch: (input, cache) => {
      const key = orpc.profile.myProfile.queryOptions().queryKey;
      const previous = queryClient.getQueryData<{
        profile?: { ramadanMode?: "auto" | "on" | "off" } | null;
      }>(key)?.profile?.ramadanMode;
      cache.value<{ profile?: Record<string, unknown> | null }>(key, (old) => ({
        profile: { ...old?.profile, ramadanMode: input.mode },
      }));
      return previous;
    },
    success: (_input, _data, previous) => ({
      message: t("toast.saved"),
      undo: previous === undefined ? undefined : () => setMode.mutate({ mode: previous }),
    }),
    invalidate: () => [orpc.profile.key()],
  });
  return (
    <Card>
      <Text style={styles.cardTitle}>{t("section.ramadan")}</Text>
      <Segmented
        options={options}
        value={mode}
        onChange={(value) => setMode.mutate({ mode: value })}
        disabled={setMode.isPending}
      />
      <Text style={styles.note}>{t("ramadan.hintNative")}</Text>
      {maternal ? <Text style={styles.note}>{t("maternal:settings.ramadanNote")}</Text> : null}
    </Card>
  );
}

/** "Simpan foto asli" (profile.setKeepPhotos); turning it off deletes stored originals. */
export function PrivacyList({ keepPhotos }: { keepPhotos: boolean }) {
  const { t } = useTranslation(["settings", "common"]);
  const { theme } = useUnistyles();
  const [keepConfirm, setKeepConfirm] = useState(false);
  const setKeep = useOptimisticMutation<
    { keep: boolean },
    unknown,
    boolean | undefined
  >({
    mutationFn: (input) => client.profile.setKeepPhotos(input),
    patch: (input, cache) => {
      const key = orpc.profile.myProfile.queryOptions().queryKey;
      const previous = queryClient.getQueryData<{
        profile?: { keepPhotos?: boolean } | null;
      }>(key)?.profile?.keepPhotos;
      cache.value<{ profile?: Record<string, unknown> | null }>(key, (old) => ({
        profile: { ...old?.profile, keepPhotos: input.keep },
      }));
      return previous;
    },
    success: (_input, _data, previous) => ({
      message: t("toast.saved"),
      undo: previous === undefined ? undefined : () => setKeep.mutate({ keep: previous }),
    }),
    invalidate: () => [orpc.profile.key(), orpc.food.key()],
  });

  // keep=false destroys stored originals server-side, so it gets the same
  // delayed commit as a delete; keep=true is instant and simply undoable.
  const setKeepOff = useDelayedDelete<{ id: string }>({
    remove: () => client.profile.setKeepPhotos({ keep: false }),
    patch: (_row, cache) => {
      const key = orpc.profile.myProfile.queryOptions().queryKey;
      cache.value<{ profile?: Record<string, unknown> | null }>(key, (old) => ({
        profile: { ...old?.profile, keepPhotos: false },
      }));
    },
    label: () => t("toast.saved"),
    invalidate: () => [orpc.profile.key(), orpc.food.key()],
  });

  const change = (value: boolean) => {
    if (!value) {
      setKeepConfirm(true);
      return;
    }
    setKeep.mutate({ keep: true });
  };

  return (
    <Card>
      <Text style={styles.cardTitle}>{t("section.privacy")}</Text>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.rowTitle}>{t("privacy.keepPhotos.title")}</Text>
        </View>
        <Switch
          value={keepPhotos}
          onValueChange={change}
          disabled={setKeep.isPending}
          trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
          thumbColor={theme.colors.background}
          accessibilityLabel={t("privacy.keepPhotos.title")}
        />
      </View>
      <Text style={styles.note}>
        {keepPhotos ? t("privacy.keepPhotos.onNative") : t("privacy.keepPhotos.offNative")}
      </Text>
      {setKeep.isError ? <Text style={styles.error}>{errorMessage(setKeep.error)}</Text> : null}

      <ConfirmSheet
        visible={keepConfirm}
        onClose={() => setKeepConfirm(false)}
        title={t("privacy.keepPhotos.confirm.title")}
        message={t("privacy.keepPhotos.confirm.messageNative")}
        confirmLabel={t("privacy.keepPhotos.confirm.actionNative")}
        onConfirm={() => {
          setKeepConfirm(false);
          setKeepOff({ id: "keep-photos" });
        }}
      />
    </Card>
  );
}

/** "Mode simpel" for the scan result (synced pref scan.simple, off by default): applies the next time a result opens. */
export function ScanSimpleCard() {
  const { t } = useTranslation("settings");
  const { theme } = useUnistyles();
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    void loadScanSimple().then((loaded) => {
      if (live) setEnabled(loaded);
    });
    return () => {
      live = false;
    };
  }, []);

  if (enabled === null) return null;

  const change = async (value: boolean) => {
    setEnabled(value);
    await saveScanSimple(value);
    await syncPrefs().catch(() => null);
  };

  return (
    <Card>
      <Text style={styles.cardTitle}>{t("scanSimple.title")}</Text>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.rowTitle}>{t("scanSimple.label")}</Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={(value) => void change(value)}
          trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
          thumbColor={theme.colors.background}
          accessibilityLabel={t("scanSimple.label")}
        />
      </View>
      <Text style={styles.note}>{enabled ? t("scanSimple.on") : t("scanSimple.off")}</Text>
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  cardTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  shareLinkGroup: {
    marginTop: -theme.spacing.sm,
  },
  copiedNote: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.makanText,
    marginTop: -theme.spacing.sm,
  },
  note: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
  rowTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    color: theme.colors.foreground,
    flex: 1,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  switchText: {
    flex: 1,
    gap: 4,
  },
}));
