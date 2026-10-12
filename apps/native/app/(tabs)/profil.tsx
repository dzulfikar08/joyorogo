import "@/unistyles";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Image, Switch, View } from "react-native";
import { useEffect, useState } from "react";
import { Redirect, router } from "expo-router";
import { StyleSheet, UnistylesRuntime, useUnistyles } from "react-native-unistyles";

import { ACTIVITY_LABELS, jakartaToday, idealWeightRange } from "@joyorogo/api/lib/engine";

import {
  Avatar,
  BootLoader,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  ListGroup,
  ListRow,
  Num,
  PageHeader,
  Screen,
  Segmented,
  Sheet,
  Skeleton,
  Text,
} from "@/components/ui";
import { StravaCard } from "@/components/strava-card";
import { authClient } from "@/lib/auth-client";
import { useSessionGate } from "@/lib/use-session-gate";
import { syncHealthConnect, isHealthConnectSupported } from "@/src/lib/health-connect";
import {
  loadReminderPrefs,
  setMealReminders,
  setWeighInReminder,
  teardownReminders,
} from "@/src/lib/notifications";
import { saveThemePref } from "@/src/lib/theme-pref";
import { errorMessage, fmtDateId, fmtKcal, fmtKg, parseNum } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

const NOTE_EXPLANATIONS: Record<string, string> = {
  MAINTENANCE: "Berat sudah mencapai target. Rencana sekarang menjaga berat.",
  BELOW_HEALTHY_RANGE: "Target berat di bawah rentang sehat. Naikkan sedikit agar aman.",
  PLAN_CLAMPED: "Rencana disesuaikan agar aman. Defisit kalori dibatasi.",
  ADAPTIVE: "Disesuaikan dari data makan + timbanganmu 3 minggu terakhir.",
};

export default function Profil() {
  const gate = useSessionGate();
  const { data: session } = authClient.useSession();
  const profileQuery = useQuery(orpc.profile.myProfile.queryOptions());
  const updateTargets = useMutation(
    orpc.profile.updateTargets.mutationOptions({
      onSuccess: () => {
        setSheetOpen(false);
        queryClient.invalidateQueries();
      },
    }),
  );

  const [sheetOpen, setSheetOpen] = useState(false);
  const [targetWeightKg, setTargetWeightKg] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const [hcBusy, setHcBusy] = useState(false);
  const [hcMessage, setHcMessage] = useState<string | null>(null);
  const [hcError, setHcError] = useState<string | null>(null);

  const prof = profileQuery.data?.profile ?? null;
  const targets = profileQuery.data?.targets ?? null;

  // Prefill the target editor from the live profile when it opens.
  useEffect(() => {
    if (sheetOpen && prof) {
      if (targetWeightKg === "") setTargetWeightKg(String(prof.targetWeightKg));
      if (targetDate === "") setTargetDate(prof.targetDate);
    }
  }, [sheetOpen, prof, targetWeightKg, targetDate]);

  if (gate === "loading") {
    return <BootLoader />;
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }
  if (profileQuery.isPending) {
    return (
      <Screen>
        <PageHeader title="Profil" />
        <Skeleton width="100%" height={96} radius={24} />
        <Skeleton width="100%" height={180} radius={24} />
        <Skeleton width="100%" height={160} radius={24} />
      </Screen>
    );
  }
  if (profileQuery.isError) {
    return (
      <Screen>
        <PageHeader title="Profil" />
        <ErrorState
          message={errorMessage(profileQuery.error)}
          onRetry={() => profileQuery.refetch()}
        />
      </Screen>
    );
  }

  const saveTarget = async () => {
    if (!prof) return;
    const target = parseNum(targetWeightKg);
    if (target === null || target < 25 || target > 400) {
      setFormError("Target berat harus antara 25 dan 400 kg.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || targetDate < jakartaToday()) {
      setFormError("Tanggal target harus format TAHUN-BULAN-TANGGAL dan belum lewat.");
      return;
    }
    setFormError(null);
    try {
      await updateTargets.mutateAsync({ targetWeightKg: target, targetDate });
      setTargetWeightKg("");
      setTargetDate("");
    } catch (e) {
      setFormError(errorMessage(e));
    }
  };

  const deleteData = useMutation(
    orpc.privacy.deleteMyData.mutationOptions({
      onSuccess: async () => {
        queryClient.clear();
        await teardownReminders();
        router.replace("/onboarding");
      },
      onError: (e) => Alert.alert("Gagal menghapus", errorMessage(e)),
    }),
  );

  const confirmWipe = () => {
    Alert.alert(
      "Hapus semua data?",
      "Profil, berat, makanan, olahraga, dan tidur dihapus permanen. Akunmu tetap bisa dipakai.",
      [
        { text: "Batal", style: "cancel" },
        { text: "Hapus", style: "destructive", onPress: () => deleteData.mutate() },
      ],
    );
  };

  const importHealthConnect = async () => {
    setHcBusy(true);
    setHcError(null);
    setHcMessage(null);
    try {
      const result = await syncHealthConnect(profileQuery.data?.latestWeightKg ?? null);
      const parts = [
        `${result.workoutsImported} latihan diimpor`,
        `${result.activityDays} hari aktivitas`,
        `${result.sleepNights} malam tidur`,
      ];
      setHcMessage(`${parts.join(", ")}, ${result.workoutsSkipped} duplikat dilewati.`);
      queryClient.invalidateQueries();
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
  const displayName = session?.user.name ?? "Pengguna JoyoRogo";

  return (
    <Screen>
      <PageHeader title="Profil" />

      {/* Account header */}
      <View style={styles.accountRow}>
        <Avatar name={displayName} size={56} />
        <View style={styles.accountText}>
          <Text style={styles.accountName}>{displayName}</Text>
          <Text style={styles.accountEmail}>{session?.user.email ?? "-"}</Text>
          {profileQuery.data?.tier === "founder" ? (
            <View style={styles.founderBadge}>
              <Text style={styles.founderText}>Founder</Text>
            </View>
          ) : null}
        </View>
      </View>

      {prof && targets ? (
        <>
          {/* Rencana saat ini */}
          <Card>
            <Text style={styles.cardTitle}>Rencana harian</Text>
            <View style={styles.planRow}>
              <View style={styles.planCell}>
                <Text style={styles.planLabel}>Makan</Text>
                <Num style={styles.planValue}>{fmtKcal(targets.eatKcal)}</Num>
                <Text style={styles.planUnit}>kcal/hari</Text>
              </View>
              <View style={styles.planCell}>
                <Text style={styles.planLabel}>Bakar</Text>
                <Num style={styles.planValue}>{fmtKcal(targets.burnKcal)}</Num>
                <Text style={styles.planUnit}>kcal/hari</Text>
              </View>
              <View style={styles.planCell}>
                <Text style={styles.planLabel}>Tidur</Text>
                <Num style={styles.planValue}>{fmtKg(targets.sleepHours)}</Num>
                <Text style={styles.planUnit}>jam/malam</Text>
              </View>
            </View>
            {targets.notes.map((note) => (
              <Text key={note} style={styles.note}>
                {NOTE_EXPLANATIONS[note] ?? note}
              </Text>
            ))}
            {targets.notes.includes("ADAPTIVE") && targets.formulaTdee ? (
              <Text style={styles.note}>
                Estimasi rumus {fmtKcal(targets.formulaTdee)} kcal/hari; rencana memakai{" "}
                {fmtKcal(targets.tdee)} kcal karena lebih cocok dengan datamu.
              </Text>
            ) : null}
            <Text style={styles.note}>
              Target berat {fmtKg(prof.targetWeightKg)} kg pada {fmtDateId(prof.targetDate)}.
              {heightIdeal
                ? ` Rentang sehat untuk tinggimu: ${fmtKg(heightIdeal.minKg)}–${fmtKg(heightIdeal.maxKg)} kg.`
                : ""}
            </Text>
          </Card>

          {/* Rencana rows → sheet editors */}
          <ListGroup>
            <ListRow
              icon="flag"
              iconTint="makan"
              title="Target berat"
              subtitle="Ubah angka targetmu"
              value={`${fmtKg(prof.targetWeightKg)} kg`}
              chevron
              onPress={() => {
                setFormError(null);
                setSheetOpen(true);
              }}
            />
            <ListRow
              icon="calendar"
              iconTint="makan"
              title="Tanggal target"
              subtitle="Kapan kamu ingin sampai"
              value={fmtDateId(prof.targetDate)}
              chevron
              onPress={() => {
                setFormError(null);
                setSheetOpen(true);
              }}
            />
            <ListRow
              icon="walk"
              iconTint="makan"
              title="Aktivitas harian"
              subtitle="Di luar olahraga; diatur saat onboarding"
              value={ACTIVITY_LABELS[prof.activityLevel as "low" | "mid" | "high"]}
            />
          </ListGroup>
        </>
      ) : (
        <Card>
          <Text style={styles.cardTitle}>Belum ada rencana</Text>
          <Text style={styles.note}>
            Kamu belum melengkapi data diri. Isi onboarding untuk mendapat rencana harian.
          </Text>
          <Button
            variant="secondary"
            label="Isi Onboarding"
            onPress={() => router.replace("/onboarding")}
          />
        </Card>
      )}

      {/* Pengingat */}
      <RemindersList />

      {/* Tampilan */}
      <AppearanceList />

      {/* Ramadan */}
      {prof ? <RamadanList mode={prof.ramadanMode} /> : null}

      {/* Privasi */}
      {prof ? <PrivacyList keepPhotos={prof.keepPhotos} /> : null}

      {/* Integrasi */}
      <Text style={styles.sectionLabel}>Integrasi</Text>
      <StravaCard />
      {isHealthConnectSupported() ? (
        <Card>
          <View style={styles.hcHead}>
            {/* Official logo from developer.android.com Health Connect UI guidelines. */}
            <Image
              source={require("@/assets/images/health-connect.png")}
              style={styles.hcLogo}
              accessibilityIgnoresInvertColors
            />
            <Text style={styles.cardTitle}>Health Connect</Text>
          </View>
          <Text style={styles.note}>
            Sumber utama aktivitasmu: latihan, langkah, jarak, kalori aktif, dan tidur 7 hari
            terakhir. Setelah izin diberikan, sinkron berjalan otomatis tiap kali kamu buka
            aplikasi.
          </Text>
          <Button
            variant="secondary"
            label="Izinkan & Sinkronkan 7 Hari"
            onPress={() => void importHealthConnect()}
            loading={hcBusy}
          />
          {hcMessage ? <Text style={styles.note}>{hcMessage}</Text> : null}
          {hcError ? <Text style={styles.error}>{hcError}</Text> : null}
        </Card>
      ) : null}

      {/* Data & privasi */}
      {prof ? <ShareRow /> : null}
      <ListGroup>
        <ListRow
          icon="trash"
          iconTint="muted"
          title="Hapus semua data saya"
          subtitle="Permanen: profil, berat, makanan, olahraga, tidur"
          destructive
          onPress={confirmWipe}
          right={deleteData.isPending ? <Text style={styles.error}>Menghapus…</Text> : undefined}
        />
        <ListRow
          icon="log-out"
          iconTint="muted"
          title="Keluar"
          destructive
          onPress={() => void signOut()}
        />
      </ListGroup>

      {/* Target editor sheet */}
      <Sheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Ubah target"
        footer={
          <Button
            label="Simpan Perubahan"
            onPress={() => void saveTarget()}
            loading={updateTargets.isPending}
          />
        }
      >
        <Field
          label="Target berat (kg)"
          hint={
            heightIdeal
              ? `Berat sehat untuk tinggimu: ${fmtKg(heightIdeal.minKg)}–${fmtKg(heightIdeal.maxKg)} kg`
              : undefined
          }
        >
          <Input
            value={targetWeightKg}
            onChangeText={setTargetWeightKg}
            keyboardType="decimal-pad"
          />
        </Field>
        <Field label="Tanggal target" hint="Format TAHUN-BULAN-TANGGAL">
          <Input value={targetDate} onChangeText={setTargetDate} placeholder="2026-12-15" />
        </Field>
        {formError ? <Text style={styles.error}>{formError}</Text> : null}
        <Text style={styles.note}>Mengubah target akan menghitung ulang tiga angka harianmu.</Text>
      </Sheet>
    </Screen>
  );
}

/** Share-progress public page toggle (profile.shareToggle). */
function ShareRow() {
  const { theme } = useUnistyles();
  const profileQuery = useQuery(orpc.profile.myProfile.queryOptions());
  const toggle = useMutation(
    orpc.profile.shareToggle.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.profile.key() }),
    }),
  );
  const enabled = profileQuery.data?.profile?.shareEnabled ?? false;
  if (profileQuery.data?.profile == null) return null;
  return (
    <Card>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.rowTitle}>Bagikan progres</Text>
          <Text style={styles.note}>
            Halaman publik ringan berisi tren beratmu; tanpa nama maupun email.
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={(value) => toggle.mutate({ enabled: value })}
          trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
          thumbColor={theme.colors.background}
          accessibilityLabel="Bagikan progres"
        />
      </View>
      {toggle.isError ? <Text style={styles.error}>{errorMessage(toggle.error)}</Text> : null}
    </Card>
  );
}

const THEME_OPTIONS = [
  { value: "light", label: "Terang" },
  { value: "dark", label: "Gelap" },
  { value: "system", label: "Sistem" },
] as const;

type ThemeValue = (typeof THEME_OPTIONS)[number]["value"];

function AppearanceList() {
  const { rt } = useUnistyles();
  // rt.themeName is undefined while adaptive (following the OS).
  const current: ThemeValue = rt.themeName ?? "system";

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
      <Text style={styles.cardTitle}>Tampilan</Text>
      <Segmented
        options={THEME_OPTIONS.map(({ value, label }) => ({ value, label }))}
        value={current}
        onChange={pick}
      />
      <Text style={styles.note}>Mode gelap mengikuti setelan sistemmu bila memilih Sistem.</Text>
    </Card>
  );
}

const RAMADAN_OPTIONS: Array<{ value: "auto" | "on" | "off"; label: string }> = [
  { value: "auto", label: "Otomatis" },
  { value: "on", label: "Aktif" },
  { value: "off", label: "Mati" },
];

function RamadanList({ mode }: { mode: "auto" | "on" | "off" }) {
  const setMode = useMutation(
    orpc.profile.setRamadanMode.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.profile.key() });
      },
    }),
  );
  return (
    <Card>
      <Text style={styles.cardTitle}>Mode Ramadan</Text>
      <Segmented
        options={RAMADAN_OPTIONS}
        value={mode}
        onChange={(value) => setMode.mutate({ mode: value })}
        disabled={setMode.isPending}
      />
      <Text style={styles.note}>
        Slot makan ganti jadi sahur & berbuka; angka harian dibagi ke jendela makan.
      </Text>
    </Card>
  );
}

/** "Simpan foto asli" (profile.setKeepPhotos); turning it off deletes stored originals. */
function PrivacyList({ keepPhotos }: { keepPhotos: boolean }) {
  const { theme } = useUnistyles();
  const setKeep = useMutation(
    orpc.profile.setKeepPhotos.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.profile.key() });
        queryClient.invalidateQueries({ queryKey: orpc.food.key() });
      },
    }),
  );

  const change = (value: boolean) => {
    if (!value) {
      Alert.alert(
        "Matikan simpan foto asli?",
        "Foto asli yang sudah tersimpan ikut dihapus permanen. Catatan makan dan stiker tiap makanan tetap ada.",
        [
          { text: "Batal", style: "cancel" },
          {
            text: "Ya, matikan dan hapus",
            style: "destructive",
            onPress: () => setKeep.mutate({ keep: false }),
          },
        ],
      );
      return;
    }
    setKeep.mutate({ keep: true });
  };

  return (
    <Card>
      <Text style={styles.cardTitle}>Privasi</Text>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.rowTitle}>Simpan foto asli</Text>
        </View>
        <Switch
          value={keepPhotos}
          onValueChange={change}
          disabled={setKeep.isPending}
          trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
          thumbColor={theme.colors.background}
          accessibilityLabel="Simpan foto asli"
        />
      </View>
      <Text style={styles.note}>
        {keepPhotos
          ? "Foto asli tiap scan yang kamu simpan bisa dilihat lagi di diari. Hanya kamu yang bisa membukanya. Mematikan ini menghapus semua foto asli yang tersimpan."
          : "Hanya potongan tiap makanan yang disimpan sebagai stiker. Foto aslinya dibuang setelah dianalisis."}
      </Text>
      {setKeep.isError ? <Text style={styles.error}>{errorMessage(setKeep.error)}</Text> : null}
    </Card>
  );
}

function RemindersList() {
  const { theme } = useUnistyles();
  const [meals, setMeals] = useState(false);
  const [weighIn, setWeighIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const prefs = await loadReminderPrefs();
      if (cancelled) return;
      setMeals(prefs.meals);
      setWeighIn(prefs.weighIn);
      // Reschedule on mount so saved choices keep firing after reboots.
      if (prefs.meals) setMeals(await setMealReminders(true));
      if (prefs.weighIn) setWeighIn(await setWeighInReminder(true));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <Text style={styles.cardTitle}>Pengingat</Text>
      <View style={styles.switchRow}>
        <Text style={styles.rowTitle}>Pengingat makan</Text>
        <Switch
          value={meals}
          onValueChange={(value) => void setMealReminders(value).then(setMeals)}
          trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
          thumbColor={theme.colors.background}
          accessibilityLabel="Pengingat makan (09:00 / 13:00 / 19:00)"
        />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.rowTitle}>Timbang pagi 07:00</Text>
        <Switch
          value={weighIn}
          onValueChange={(value) => void setWeighInReminder(value).then(setWeighIn)}
          trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
          thumbColor={theme.colors.background}
          accessibilityLabel="Pengingat timbang pagi 07:00"
        />
      </View>
      <Text style={styles.note}>
        Selama pengingat aktif, notifikasi harian muncul di jam yang tertera.
      </Text>
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
  planRow: {
    flexDirection: "row",
    gap: theme.spacing.md,
  },
  planCell: {
    flex: 1,
    gap: 2,
  },
  planLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  planValue: {
    fontSize: theme.fontSize["2xl"],
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  planUnit: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
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
