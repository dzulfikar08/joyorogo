import "@/unistyles";
import * as AppleAuthentication from "expo-apple-authentication";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Image, Platform, Switch, View } from "react-native";
import { useEffect, useState } from "react";
import { Redirect, Stack, router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useTranslation } from "react-i18next";
import { StyleSheet, UnistylesRuntime, useUnistyles } from "react-native-unistyles";

import { ACTIVITY_LABELS, idealWeightRange, jakartaToday, MAX_TARGET_DAYS, shiftDate } from "@joyorogo/api/lib/engine";
import {
  bmiOf,
  suggestedDays,
  suggestGainTarget,
  UNDERWEIGHT_BMI,
  type Goal,
} from "@joyorogo/api/lib/gain";
import { i18n, LOCALES, LOCALE_NAMES } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

import {
  Avatar,
  BootLoader,
  Button,
  Card,
  ErrorState,
  ListGroup,
  ListRow,
  PageHeader,
  Screen,
  Segmented,
  Skeleton,
  StatTile,
  Text,
} from "@/components/ui";
import { FounderCards, serverUrl, useAppConfig } from "@/components/billing";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { useToast } from "@/components/toast";
import { BudgetSetting } from "@/components/plate/budget-setting";
import { NeedsSheet } from "@/components/needs-sheet";
import { TargetPaceNotice } from "@/components/target-pace-notice";
import { TargetDateSheet, TargetWeightSheet } from "@/components/target-sheets";
import {
  EndPregnancySheet,
} from "@/components/maternal/end-pregnancy-sheet";
import { MaternalEditSheet, MaternalSettingsSheet, useSetMaternal } from "@/components/maternal/maternal-sheets";
import { GainDisclaimer, GainNotes } from "@/components/gain/gain-notes";
import { GoalChooser } from "@/components/gain/goal-chooser";
import { StravaCard } from "@/components/strava-card";
import { KoneksiRow } from "@/components/koneksi-row";
import { FastingSettingsCard } from "@/components/fasting/settings-card";
import { RemindersCard } from "@/components/reminders/reminders-card";
import { FeedSettingsCard } from "@/components/feed/settings";
import { OtaUpdateCard } from "@/components/ota-update-card";
import { authClient } from "@/lib/auth-client";
import { useSessionGate } from "@/lib/use-session-gate";
import {
  downloadAndInstallApk,
  installedAppVersion,
  useApkUpdate,
} from "@/src/lib/apk-update";
import { isHealthSyncSupported, syncHealthData } from "@/src/lib/health-sync";
import { backfillNutritionToHealth, isNutritionMirrorSupported } from "@/src/lib/health-nutrition";
import { setLocale } from "@/src/lib/i18n";
import { teardownReminders } from "@/src/lib/notifications";
import { saveThemePref } from "@/src/lib/theme-pref";
import { errorMessage, fmtDateMedium, fmtInt, fmtKg, fmtMegabytes } from "@/utils/format";
import { client, orpc, queryClient } from "@/utils/orpc";
import { useDelayedDelete, useOptimisticMutation } from "@/lib/optimistic";

const SHEET_SWAP_MS = 350;

export default function Profil() {
  const { t } = useTranslation(["settings", "common", "maternal", "gain"]);
  const gate = useSessionGate();
  const toast = useToast();
  // refetch keeps every screen's avatar in sync right after ganti/hapus foto.
  const session = authClient.useSession();
  const profileQuery = useQuery(orpc.profile.myProfile.queryOptions());
  const config = useAppConfig();
  type TargetsInput = { targetWeightKg: number; targetDate: string; goal?: Goal };
  type ProfileCache = { profile: Record<string, unknown> | null };
  const myProfileKey = orpc.profile.myProfile.queryOptions().queryKey;

  const updateTargets = useOptimisticMutation<TargetsInput, unknown, TargetsInput | null>({
    mutationFn: (input) => client.profile.updateTargets(input),
    patch: (input, cache) => {
      const row = queryClient.getQueryData<ProfileCache>(myProfileKey);
      const previous =
        row?.profile == null
          ? null
          : {
              targetWeightKg: row.profile.targetWeightKg as number,
              targetDate: row.profile.targetDate as string,
              ...(input.goal ? { goal: row.profile.goal as Goal } : {}),
            };
      cache.value<ProfileCache>(myProfileKey, (old) => ({
        profile: {
          ...old?.profile,
          targetWeightKg: input.targetWeightKg,
          targetDate: input.targetDate,
          ...(input.goal ? { goal: input.goal } : {}),
        },
      }));
      return previous;
    },
    success: (_input, _data, previous) => {
      setSheet(null);
      setGoalDraft(null);
      const undoFrom = previous ?? null;
      return {
        message: t("plan.toast.updated"),
        undo: undoFrom === null ? undefined : () => updateTargets.mutate(undoFrom),
      };
    },
    invalidate: () => [orpc.profile.key()],
  });

  // Focused editors: "weight" and "date" open separately; "needs" is the TDEE
  // breakdown, also opened from Beranda via ?needs=1.
  const [sheet, setSheet] = useState<
    null | "weight" | "date" | "needs" | "maternal" | "maternalEdit" | "end"
  >(null);
  // A goal picked in the chooser that needs a new target first (the weight sheet saves both).
  const [goalDraft, setGoalDraft] = useState<"lose" | "gain" | null>(null);
  const { needs: needsParam } = useLocalSearchParams<{ needs?: string }>();
  useEffect(() => {
    if (needsParam === "1") setSheet("needs");
  }, [needsParam]);
  const [turnOffOpen, setTurnOffOpen] = useState(false);
  const turnOff = useSetMaternal(() => {
    setTurnOffOpen(false);
    setSheet(null);
  });
  /** One Modal at a time: let the leaving sheet finish its slide before the next one opens. */
  const swapTo = (next: "maternal" | "maternalEdit" | "end") => {
    setSheet(null);
    setTimeout(() => setSheet(next), SHEET_SWAP_MS);
  };

  const [hcBusy, setHcBusy] = useState(false);
  const [hcMessage, setHcMessage] = useState<string | null>(null);
  const [hcError, setHcError] = useState<string | null>(null);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  // Server-side delete: wipes data, photos and the user row (sessions and
  // Google/Apple logins cascade). Afterwards the local session is dead, so
  // sign out best-effort just to clear SecureStore.
  const deleteAccount = useMutation(
    orpc.privacy.deleteMyAccount.mutationOptions({
      onSuccess: async () => {
        try {
          await authClient.signOut();
        } catch {
          // the server session is already gone
        }
        queryClient.clear();
        await teardownReminders();
        router.replace("/login");
      },
      onError: (e) => toast.error(t("account.delete.failedTitle"), errorMessage(e)),
    }),
  );
  const [appleChecking, setAppleChecking] = useState(false);
  // Apple 5.1.1(v): an Apple-linked account needs a fresh authorization code so
  // the server can revoke the Sign in with Apple token. Cancelling the Apple
  // sheet keeps the confirm sheet open and does nothing else.
  const confirmDeleteAccount = async () => {
    if (appleChecking || deleteAccount.isPending) return;
    if (Platform.OS !== "ios") {
      setDeleteAccountOpen(false);
      deleteAccount.mutate(undefined);
      return;
    }
    setAppleChecking(true);
    try {
      const accounts = await authClient.listAccounts();
      const hasApple = (accounts.data ?? []).some((a) => a.providerId === "apple");
      if (!hasApple) {
        setDeleteAccountOpen(false);
        deleteAccount.mutate(undefined);
        return;
      }
      const credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
      if (!credential.authorizationCode) {
        toast.error(t("account.delete.failedTitle"), t("account.delete.noAppleCode"));
        return;
      }
      setDeleteAccountOpen(false);
      deleteAccount.mutate({ appleAuthorizationCode: credential.authorizationCode });
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      if (code === "ERR_REQUEST_CANCELED") return;
      toast.error(t("account.delete.failedTitle"), errorMessage(e));
    } finally {
      setAppleChecking(false);
    }
  };
  const [avatarRemoveOpen, setAvatarRemoveOpen] = useState(false);

  // Android only: Profil forces a check on mount so the section reflects the
  // server right now. The app-start check stays silent and throttled.
  const updateState = useApkUpdate(true);
  const updateResult = updateState?.result ?? null;
  const update = updateResult?.state === "available" ? updateResult.update : null;
  const installed = updateState ? installedAppVersion() : null;
  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState(0);
  const [installError, setInstallError] = useState<string | null>(null);

  const installUpdate = async () => {
    if (!update || installing) return;
    setInstalling(true);
    setInstallError(null);
    setInstallProgress(0);
    try {
      await downloadAndInstallApk(update, setInstallProgress);
      // The system installer takes over; if installs from this app are not
      // allowed, Android shows its own prompt before returning here.
    } catch (e) {
      setInstallError(errorMessage(e));
    } finally {
      setInstalling(false);
    }
  };

  const prof = profileQuery.data?.profile ?? null;
  const weightNowKg = profileQuery.data?.latestWeightKg ?? prof?.startWeightKg ?? 0;
  const targets = profileQuery.data?.targets ?? null;
  const maternal = targets?.maternal ?? null;
  const heightCm = prof?.heightCm ?? null;
  const underweight = heightCm !== null && bmiOf(weightNowKg, heightCm) < UNDERWEIGHT_BMI;

  /** A starting target for a goal that has no valid target yet. */
  const draftTargetKg = (goal: "lose" | "gain") => {
    if (goal === "gain" && heightCm !== null) {
      const range = idealWeightRange(heightCm);
      return Math.round(suggestGainTarget(weightNowKg, heightCm, range.minKg, range.maxKg) * 10) / 10;
    }
    return Math.round((weightNowKg - 1) * 10) / 10;
  };
  const draftTargetDate = (goal: "lose" | "gain", targetKg: number) =>
    shiftDate(
      jakartaToday(),
      goal === "gain"
        ? Math.min(suggestedDays(targetKg - weightNowKg, weightNowKg, underweight), MAX_TARGET_DAYS)
        : 90,
    );
  const closeTargetSheet = () => {
    setSheet(null);
    setGoalDraft(null);
  };

  /** Maintain holds today's weight; lose / gain keep the target when it sits on the right side, else ask for a new one first. */
  const chooseGoal = (next: Goal) => {
    if (!prof || next === prof.goal) {
      setGoalDraft(null);
      return;
    }
    if (next === "maintain") {
      setGoalDraft(null);
      updateTargets.mutate({ goal: next, targetWeightKg: prof.targetWeightKg, targetDate: prof.targetDate });
      return;
    }
    const fits = next === "gain" ? prof.targetWeightKg > weightNowKg : prof.targetWeightKg < weightNowKg;
    if (fits) {
      setGoalDraft(null);
      updateTargets.mutate({ goal: next, targetWeightKg: prof.targetWeightKg, targetDate: prof.targetDate });
      return;
    }
    setGoalDraft(next);
    setSheet("weight");
  };

  if (gate === "loading") {
    return <BootLoader />;
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }
  if (profileQuery.isPending) {
    return (
      <Screen>
        <PageHeader title={t("common:nav.title.profile")} />
        <Skeleton width="100%" height={96} radius={24} />
        <Skeleton width="100%" height={180} radius={24} />
        <Skeleton width="100%" height={160} radius={24} />
      </Screen>
    );
  }
  if (profileQuery.isError) {
    return (
      <Screen>
        <PageHeader title={t("common:nav.title.profile")} />
        <ErrorState
          message={errorMessage(profileQuery.error)}
          onRetry={() => profileQuery.refetch()}
        />
      </Screen>
    );
  }

  const deleteData = useMutation(
    orpc.privacy.deleteMyData.mutationOptions({
      onSuccess: async () => {
        queryClient.clear();
        await teardownReminders();
        router.replace("/onboarding");
      },
      onError: (e) => toast.error(t("privacy.wipe.failedTitle"), errorMessage(e)),
    }),
  );

  const confirmWipe = () => setWipeOpen(true);

  const importHealthData = async () => {
    setHcBusy(true);
    setHcError(null);
    setHcMessage(null);
    try {
      const result = await syncHealthData(profileQuery.data?.latestWeightKg ?? null);
      const parts = [
        t("health.summary.workouts", { count: result.workoutsImported }),
        t("health.summary.activityDays", { count: result.activityDays }),
        t("health.summary.sleepNights", { count: result.sleepNights }),
        t("health.summary.skipped", { count: result.workoutsSkipped }),
      ];
      let summary = `${parts.join(", ")}.`;
      const empty =
        result.workoutsImported === 0 && result.activityDays === 0 && result.sleepNights === 0;
      // HealthKit menolak izin secara diam: kueri hanya kembali kosong, jadi
      // arahkan ke Setelan tanpa mengklaim tahu penyebabnya.
      if (Platform.OS === "ios" && empty) {
        summary += ` ${t("health.summary.iosEmpty")}`;
      }
      setHcMessage(summary);
      queryClient.invalidateQueries();
    } catch (e) {
      setHcError(errorMessage(e));
    } finally {
      setHcBusy(false);
    }
  };

  const writeNutrition = async () => {
    setHcBusy(true);
    setHcError(null);
    setHcMessage(null);
    try {
      const result = await backfillNutritionToHealth();
      setHcMessage(t("health.nutritionWritten", { count: result.meals }));
    } catch (e) {
      setHcError(errorMessage(e));
    } finally {
      setHcBusy(false);
    }
  };

  const signOut = async () => {
    await authClient.signOut();
    queryClient.clear();
    await teardownReminders();
    router.replace("/login");
  };

  const heightIdeal = prof ? idealWeightRange(prof.heightCm) : null;
  const displayName = session.data?.user.name ?? t("common:more.fallbackNameNative");
  const avatarImage = session.data?.user.image ?? null;

  // Foto profil: galeri atau kamera (potong persegi di picker), lalu
  // dipampatkan ke persegi 512px JPEG sebelum diunggah.
  const refreshAfterAvatar = async () => {
    await session.refetch();
    queryClient.invalidateQueries({ queryKey: orpc.profile.key() });
  };

  const uploadAvatar = useOptimisticMutation<
    { imageBase64: string; mimeType: "image/png" | "image/jpeg" | "image/webp" },
    unknown
  >({
    mutationFn: (input) => client.avatar.upload(input),
    success: () => {
      void refreshAfterAvatar();
      return {
        message: t("profile.photo.updated"),
        undo: () => {
          void client.avatar.remove().then(() => refreshAfterAvatar());
        },
      };
    },
    onError: (e) => toast.error(t("profile.photo.error.uploadFailed"), errorMessage(e)),
    invalidate: () => [orpc.profile.key()],
  });

  // Hapus foto: optimistic (avatar langsung kosong), DELETE-nya menyusul
  // setelah jendela urungkan lewat. Undo mengembalikan sesi tanpa server call.
  const removeAvatar = useDelayedDelete<{ id: string }>({
    remove: async () => {
      await client.avatar.remove();
      await refreshAfterAvatar();
    },
    patch: (_row, cache) => {
      // Sesi better-auth bukan cache oRPC; temukan query yang punya user.
      for (const query of queryClient.getQueryCache().findAll({ queryKey: [] })) {
        const data = query.state.data as { user?: { image?: string | null } } | undefined;
        if (data?.user === undefined) continue;
        cache.value(query.queryKey, (old: typeof data | undefined) =>
          old === undefined ? undefined : { ...old, user: { ...old.user, image: null } },
        );
      }
    },
    label: () => t("profile.photo.label"),
    invalidate: () => [orpc.profile.key()],
  });
  const pickAvatar = async (source: "gallery" | "camera") => {
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      exif: false,
    };
    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    try {
      // Center-crop ke persegi lalu kecilkan ke 512px: satu bentuk untuk semua.
      const side = Math.min(asset.width, asset.height);
      const rendered = await ImageManipulator.manipulate(asset.uri)
        .crop({
          originX: Math.floor((asset.width - side) / 2),
          originY: Math.floor((asset.height - side) / 2),
          width: side,
          height: side,
        })
        .resize({ width: 512, height: 512 })
        .renderAsync();
      const out = await rendered.saveAsync({
        base64: true,
        compress: 0.85,
        format: SaveFormat.JPEG,
      });
      if (!out.base64) throw new Error(t("profile.photo.error.empty"));
      uploadAvatar.mutate({ imageBase64: out.base64, mimeType: "image/jpeg" });
    } catch (e) {
      toast.error(t("profile.photo.error.processFailed"), errorMessage(e));
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: t("common:nav.title.profile") }} />
      <Screen>
      <PageHeader title={t("common:nav.title.profile")} />

      {/* Account header */}
      <View style={styles.accountRow}>
        <Avatar name={displayName} image={avatarImage} size={56} />
        <View style={styles.accountText}>
          <Text style={styles.accountName}>{displayName}</Text>
          <Text style={styles.accountEmail}>{session.data?.user.email ?? "-"}</Text>
          {profileQuery.data?.tier === "founder" ? (
            <View style={styles.founderBadge}>
              <Text style={styles.founderText}>Pro</Text>
            </View>
          ) : config.data?.paywall ? (
            <View style={styles.freeBadge}>
              <Text style={styles.freeText}>{t("profile.badge.free")}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Foto profil: ganti (galeri/kamera) dan hapus (kembali ke foto Google). */}
      <View style={styles.avatarActions}>
        <Button
          variant="secondary"
          size="sm"
          label={t("profile.photo.camera")}
          loading={uploadAvatar.isPending}
          onPress={() => void pickAvatar("camera")}
        />
        <Button
          variant="secondary"
          size="sm"
          label={t("profile.photo.gallery")}
          loading={uploadAvatar.isPending}
          onPress={() => void pickAvatar("gallery")}
        />
        {avatarImage ? (
          <Button
            variant="secondary"
            size="sm"
            label={t("profile.photo.remove")}
            disabled={uploadAvatar.isPending}
            onPress={() => setAvatarRemoveOpen(true)}
          />
        ) : null}
      </View>

      {/* Kuota scan gratis + langganan Pro (web profil banners) */}
      <FounderCards
        tier={profileQuery.data?.tier ?? "free"}
        founderUntil={profileQuery.data?.founderUntil ?? null}
      />

      {/* Android only: update section. useApkUpdate is null on iOS and web. */}
      {updateState && installed ? (
        <Card>
          <Text style={styles.cardTitle}>{t("update.title")}</Text>
          <Text style={styles.note}>
            {t("update.installed", {
              name: installed.versionName,
              code: installed.versionCode,
            })}
          </Text>
          {/* Empat kondisi: memeriksa / terbaru / tersedia / gagal. */}
          {updateState.refreshing || updateResult === null ? (
            <Text style={styles.note}>{t("update.checking")}</Text>
          ) : updateResult.state === "up-to-date" ? (
            <Text style={styles.note}>{t("update.upToDate")}</Text>
          ) : updateResult.state === "error" ? (
            <Text style={styles.error}>{updateResult.message}</Text>
          ) : (
            <>
              <Text style={styles.note}>
                {t("update.available", {
                  name: updateResult.update.versionName,
                  code: updateResult.update.versionCode,
                  size: fmtMegabytes(updateResult.update.size),
                })}
              </Text>
              <Button
                label={
                  installing
                    ? t("update.downloading", { percent: installProgress })
                    : t("update.install")
                }
                onPress={() => void installUpdate()}
                loading={installing}
              />
              {installError ? <Text style={styles.error}>{installError}</Text> : null}
            </>
          )}
          <Button
            variant="secondary"
            size="sm"
            label={updateState.refreshing ? t("update.checkingShort") : t("update.check")}
            onPress={() => void updateState.refresh()}
            loading={updateState.refreshing}
            disabled={installing}
          />
        </Card>
      ) : null}

      {/* Over-the-air JS updates (expo-updates); renders nothing where OTA is off. */}
      <OtaUpdateCard />

      {prof && targets ? (
        <>
          {/* Tiga angka harian sebagai tile, seperti PlanNumbers web */}
          <View style={styles.planTiles}>
            <StatTile
              icon="restaurant"
              tint="makan"
              label={t("plan.numbers.eat")}
              value={fmtInt(targets.eatKcal)}
              sub={t("plan.numbers.perDay")}
            />
            {maternal ? null : (
              <StatTile
                icon="flame"
                tint="bakar"
                label={t("plan.numbers.burn")}
                value={fmtInt(targets.burnKcal)}
                sub={t("plan.numbers.perDay")}
              />
            )}
            <StatTile
              icon="moon"
              tint="tidur"
              label={t("plan.numbers.sleep")}
              value={fmtKg(targets.sleepHours)}
              sub={t("plan.numbers.perNight")}
            />
          </View>

          {/* TDEE: dari mana target makan datang */}
          <ListGroup>
            <ListRow
              icon="flash"
              iconTint="makan"
              title={t("plan.needs.row")}
              value={t("plan.needs.rowValue", { kcal: fmtInt(targets.tdee) })}
              chevron
              onPress={() => setSheet("needs")}
            />
          </ListGroup>

          {/* Hamil dan menyusui: perempuan saja */}
          {prof.gender === "female" ? (
            <ListGroup>
              <ListRow
                icon="heart"
                iconTint="makan"
                title={t("maternal:settings.title")}
                subtitle={
                  maternal
                    ? maternal.mode === "pregnant"
                      ? t("maternal:settings.rowPregnant", { week: maternal.gestation?.weeks ?? 0 })
                      : t("maternal:settings.rowBreastfeeding", { months: maternal.babyMonths ?? 0 })
                    : t("maternal:settings.rowOff")
                }
                wrapTitle
                chevron
                onPress={() => setSheet("maternal")}
              />
            </ListGroup>
          ) : null}

          {/* Tujuan: Turunin / Jaga / Naikin BB (mati selama Hamil atau Menyusui) */}
          {maternal ? null : (
            <Card>
              <Text style={styles.cardTitle}>{t("gain:goal.title")}</Text>
              <GoalChooser value={goalDraft ?? prof.goal} onChange={chooseGoal} />
            </Card>
          )}

          {/* Rencana rows → sheet editors */}
          <ListGroup>
            {maternal ? null : (
              <ListRow
                icon="flag"
                iconTint="makan"
                title={t("plan.targetWeight.title")}
                subtitle={t("plan.targetWeight.subtitle")}
                value={`${fmtKg(prof.targetWeightKg)} kg`}
                chevron
                onPress={() => setSheet("weight")}
              />
            )}
            {maternal ? null : (
              <ListRow
                icon="calendar"
                iconTint="makan"
                title={t("plan.targetDate.title")}
                subtitle={t("plan.targetDate.subtitle")}
                value={fmtDateMedium(prof.targetDate)}
                chevron
                onPress={() => setSheet("date")}
              />
            )}
            <ListRow
              icon="walk"
              iconTint="makan"
              title={t("plan.activity.title")}
              subtitle={t("plan.activity.subtitle")}
              value={ACTIVITY_LABELS[prof.activityLevel as "low" | "mid" | "high"]}
            />
          </ListGroup>
          {!maternal ? <TargetPaceNotice pace={targets.datePace} /> : null}

          {targets.notes
            .filter((note) => note !== "MATERNAL")
            .map((note) => (
              <Text key={note} style={styles.note}>
                {t(`plan.noteShort.${note}`)}
              </Text>
            ))}
          {!maternal && targets.notes.includes("ADAPTIVE") && targets.formulaTdee ? (
            <Text style={styles.note}>
              {t("plan.formulaEstimate", {
                formula: fmtInt(targets.formulaTdee),
                tdee: fmtInt(targets.tdee),
              })}
            </Text>
          ) : null}
          {maternal ? (
            <Text style={styles.note}>{t("maternal:settings.hiddenNote")}</Text>
          ) : (
            <>
              <Text style={styles.note}>
                {heightIdeal
                  ? t("plan.summary.withRange", {
                      kg: fmtKg(prof.targetWeightKg),
                      date: fmtDateMedium(prof.targetDate),
                      min: fmtKg(heightIdeal.minKg),
                      max: fmtKg(heightIdeal.maxKg),
                    })
                  : t("plan.summary.target", {
                      kg: fmtKg(prof.targetWeightKg),
                      date: fmtDateMedium(prof.targetDate),
                    })}
              </Text>
              <Text style={styles.caption}>{t("plan.recalcNote")}</Text>
              {targets.gain ? (
                <>
                  <GainNotes gain={targets.gain} />
                  <Text style={styles.caption}>{t("gain:plan.estimate")}</Text>
                  <Text style={styles.caption}>
                    {t("gain:estimate.title")}. {t("gain:estimate.body")}
                  </Text>
                  <GainDisclaimer short />
                </>
              ) : null}
            </>
          )}

          {/* Data diri (hanya baca) */}
          <ListGroup>
            <ListRow
              title={t("profile.personal.gender")}
              value={
                prof.gender === "male" || prof.gender === "female"
                  ? t(`profile.gender.${prof.gender}`)
                  : prof.gender
              }
            />
            <ListRow title={t("profile.personal.birthYear")} value={String(prof.birthYear)} />
            <ListRow title={t("profile.personal.height")} value={`${fmtInt(prof.heightCm)} cm`} />
            <ListRow
              title={t("profile.personal.startWeight")}
              value={`${fmtKg(prof.startWeightKg)} kg`}
            />
            <ListRow
              title={t("profile.personal.currentWeight")}
              value={
                profileQuery.data?.latestWeightKg != null
                  ? `${fmtKg(profileQuery.data.latestWeightKg)} kg`
                  : t("profile.personal.currentWeightNone")
              }
            />
          </ListGroup>
          <Text style={styles.caption}>{t("profile.personal.note")}</Text>
        </>
      ) : (
        <Card>
          <Text style={styles.cardTitle}>{t("plan.empty.title")}</Text>
          <Text style={styles.note}>{t("plan.empty.body")}</Text>
          <Button
            variant="secondary"
            label={t("plan.empty.cta")}
            onPress={() => router.replace("/onboarding")}
          />
        </Card>
      )}

      {/* Pengingat */}
      <RemindersCard />

      {/* Tampilan */}
      <AppearanceList />

      {/* Bahasa */}
      <LanguageList />

      {/* Ramadan */}
      {prof ? <RamadanList mode={prof.ramadanMode} maternal={maternal !== null} /> : null}

      {/* Puasa intermiten */}
      {prof && !maternal ? <FastingSettingsCard /> : null}

      {/* Anggaran belanja makan */}
      <BudgetSetting />

      {/* Privasi */}
      {prof ? <PrivacyList keepPhotos={prof.keepPhotos} /> : null}

      {/* Feed komunitas */}
      <FeedSettingsCard />

      {/* Integrasi */}
      <Text style={styles.sectionLabel}>{t("section.integrations")}</Text>
      <StravaCard />
      <KoneksiRow />
      {isHealthSyncSupported() ? (
        <Card>
          {Platform.OS === "ios" ? (
            // No logo: do not invent Apple artwork; the title alone identifies
            // the source on iOS.
            <Text style={styles.cardTitle}>Apple Health</Text>
          ) : (
            <View style={styles.hcHead}>
              {/* Official logo from developer.android.com Health Connect UI guidelines. */}
              <Image
                source={require("@/assets/images/health-connect.png")}
                style={styles.hcLogo}
                accessibilityIgnoresInvertColors
              />
              <Text style={styles.cardTitle}>Health Connect</Text>
            </View>
          )}
          <Text style={styles.note}>
            {Platform.OS === "ios" ? t("health.noteIos") : t("health.noteAndroid")}
          </Text>
          <Button
            variant="secondary"
            label={t("health.syncButton")}
            onPress={() => void importHealthData()}
            loading={hcBusy}
          />
          {isNutritionMirrorSupported() ? (
            <>
              <Text style={styles.note}>{t("health.nutritionNote")}</Text>
              <Button
                variant="secondary"
                label={t("health.nutritionButton")}
                onPress={() => void writeNutrition()}
                loading={hcBusy}
              />
            </>
          ) : null}
          {hcMessage ? <Text style={styles.note}>{hcMessage}</Text> : null}
          {hcError ? <Text style={styles.error}>{hcError}</Text> : null}
        </Card>
      ) : null}

      {/* Data & privasi */}
      {prof && !maternal ? <ShareRow /> : null}
      <ListGroup>
        <ListRow
          icon="shield-checkmark"
          iconTint="makan"
          title={t("privacy.policy")}
          chevron
          onPress={() => void WebBrowser.openBrowserAsync(`${serverUrl()}/privasi`)}
        />
        <ListRow
          icon="trash"
          iconTint="muted"
          title={t("privacy.wipe.title")}
          subtitle={t("privacy.wipe.subtitleNative")}
          destructive
          onPress={confirmWipe}
          right={
            deleteData.isPending ? (
              <Text style={styles.error}>{t("privacy.wipe.deletingNative")}</Text>
            ) : undefined
          }
        />
        <ListRow
          icon="person-remove"
          iconTint="muted"
          title={t("account.delete.title")}
          subtitle={t("account.delete.subtitle")}
          destructive
          onPress={() => setDeleteAccountOpen(true)}
          right={
            deleteAccount.isPending ? (
              <Text style={styles.error}>{t("privacy.wipe.deletingNative")}</Text>
            ) : undefined
          }
        />
        <ListRow
          icon="log-out"
          iconTint="muted"
          title={t("account.signOut")}
          destructive
          onPress={() => void signOut()}
        />
      </ListGroup>

      {/* Target editors: dua sheet terpisah, seperti web */}
      {prof ? (
        <>
          {maternal ? null : (
            <>
              <TargetWeightSheet
                visible={sheet === "weight"}
                onClose={closeTargetSheet}
                heightCm={prof.heightCm}
                weightNowKg={weightNowKg}
                targetWeightKg={goalDraft ? draftTargetKg(goalDraft) : prof.targetWeightKg}
                pending={updateTargets.isPending}
                onSave={async (kg) => {
                  await updateTargets.mutateAsync({
                    targetWeightKg: kg,
                    targetDate: goalDraft ? draftTargetDate(goalDraft, kg) : prof.targetDate,
                    ...(goalDraft ? { goal: goalDraft } : {}),
                  });
                }}
              />
              <TargetDateSheet
                visible={sheet === "date"}
                onClose={() => setSheet(null)}
                targetDate={prof.targetDate}
                weightNowKg={weightNowKg}
                targetWeightKg={prof.targetWeightKg}
                goal={prof.goal}
                heightCm={prof.heightCm}
                pending={updateTargets.isPending}
                onSave={async (date) => {
                  await updateTargets.mutateAsync({
                    targetWeightKg: prof.targetWeightKg,
                    targetDate: date,
                  });
                }}
              />
            </>
          )}
          {targets ? (
            <NeedsSheet visible={sheet === "needs"} onClose={() => setSheet(null)} targets={targets} />
          ) : null}
          <MaternalSettingsSheet
            visible={sheet === "maternal"}
            onClose={() => setSheet(null)}
            onEdit={() => swapTo("maternalEdit")}
            onEnd={() => swapTo("end")}
            onTurnOff={() => {
              setSheet(null);
              setTimeout(() => setTurnOffOpen(true), SHEET_SWAP_MS);
            }}
          />
          <MaternalEditSheet
            visible={sheet === "maternalEdit"}
            onClose={() => (maternal ? swapTo("maternal") : setSheet(null))}
          />
          <EndPregnancySheet visible={sheet === "end"} onClose={() => setSheet(null)} />
        </>
      ) : null}
      </Screen>

      <ConfirmSheet
        visible={turnOffOpen}
        onClose={() => setTurnOffOpen(false)}
        title={t("maternal:settings.turnOffTitle")}
        message={t("maternal:settings.turnOffBody")}
        confirmLabel={t("maternal:settings.turnOffConfirm")}
        cancelLabel={t("common:actions.cancel")}
        destructive={false}
        loading={turnOff.isPending}
        onConfirm={() => turnOff.mutate({ mode: "none" })}
      />
      <ConfirmSheet
        visible={wipeOpen}
        onClose={() => setWipeOpen(false)}
        title={t("privacy.wipe.confirmTitle")}
        message={t("privacy.wipe.confirmMessageNative")}
        confirmLabel={t("common:actions.delete")}
        loading={deleteData.isPending}
        onConfirm={() => {
          setWipeOpen(false);
          deleteData.mutate();
        }}
      />

      <ConfirmSheet
        visible={deleteAccountOpen}
        onClose={() => setDeleteAccountOpen(false)}
        title={t("account.delete.confirmTitle")}
        message={t("account.delete.confirmMessage")}
        confirmLabel={t("account.delete.title")}
        cancelLabel={t("common:actions.cancel")}
        loading={deleteAccount.isPending}
        onConfirm={() => void confirmDeleteAccount()}
      />

      <ConfirmSheet
        visible={avatarRemoveOpen}
        onClose={() => setAvatarRemoveOpen(false)}
        title={t("profile.photo.removeConfirm.title")}
        message={t("profile.photo.removeConfirm.message")}
        confirmLabel={t("common:actions.delete")}
        onConfirm={() => {
          setAvatarRemoveOpen(false);
          removeAvatar({ id: "avatar" });
        }}
      />
    </>
  );
}

/** Share-progress public page toggle + copy link (profile.shareToggle). */
function ShareRow() {
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

type ThemeValue = "light" | "dark" | "system";

function AppearanceList() {
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
    if (value === "system") {
      // Hand control back to the OS scheme; the stored pref re-enables
      // adaptive themes on the next launch.
      UnistylesRuntime.setAdaptiveThemes(true);
    } else {
      // setTheme throws while adaptiveThemes is enabled.
      UnistylesRuntime.setAdaptiveThemes(false);
      UnistylesRuntime.setTheme(value);
    }
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
function LanguageList() {
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

function RamadanList({ mode, maternal }: { mode: "auto" | "on" | "off"; maternal: boolean }) {
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
function PrivacyList({ keepPhotos }: { keepPhotos: boolean }) {
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

const styles = StyleSheet.create((theme) => ({
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  avatarActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  accountText: {
    flex: 1,
    gap: 2,
  },
  accountName: {
    fontSize: theme.fontSize.lg,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  accountEmail: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  founderBadge: {
    alignSelf: "flex-start",
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.makanSoft,
  },
  founderText: {
    color: theme.colors.makanText,
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
  },
  cardTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  hcHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  hcLogo: {
    width: 32,
    height: 32,
  },
  sectionLabel: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
    marginTop: theme.spacing.sm,
  },
  planTiles: {
    flexDirection: "row",
    gap: theme.spacing.md,
  },
  caption: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    lineHeight: 18,
    marginTop: -theme.spacing.sm,
  },
  freeBadge: {
    alignSelf: "flex-start",
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.muted,
  },
  freeText: {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
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
