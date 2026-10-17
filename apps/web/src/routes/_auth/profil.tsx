import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppRouterClient } from "@joyorogo/api/routers/index";

import { OptimisticCache, useDelayedDelete, useOptimisticMutation } from "@/lib/optimistic";
import { Link, Navigate, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  CalendarDays,
  Camera,
  CircleAlert,
  Download,
  Flag,
  Footprints,
  Globe,
  Link2,
  Image as ImageIcon,
  LogOut,
  ShieldCheck,
  Smartphone,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  ACTIVITY_LABELS,
  daysBetween,
  idealWeightRange,
  jakartaToday,
  KCAL_PER_KG_FAT,
} from "@joyorogo/api/lib/engine";
import type { ActivityLevel, Gender, Targets } from "@joyorogo/api/lib/engine";
import { Button } from "@joyorogo/ui/components/button";
import { Calendar } from "@joyorogo/ui/components/calendar";
import { Input } from "@joyorogo/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@joyorogo/ui/components/popover";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";
import {
  Card,
  ListAnchorRow,
  ListButtonRow,
  ListGroup,
  ListLinkRow,
  ListRow,
  Page,
  SectionTitle,
  Segmented,
} from "@/components/kit/surface";
import { Switch } from "@/components/kit/switch";
import { PlanNumbers, TargetNotesList } from "@/components/plan-numbers";
import { BudgetSetting } from "@/components/plate/budget-setting";
import { FastingSettingsSection } from "@/components/fasting/settings-section";
import { useTheme } from "@/components/theme-provider";
import { Avatar } from "@/components/avatar";
import { useCheckoutPicker } from "@/components/checkout-picker";
import { FeedSettingsSection } from "@/components/feed/settings";
import { ScreenError } from "@/components/screen-state";
import { useStrava } from "@/components/strava-card";
import { env } from "@/env.public";
import type { ProfileRow } from "@/lib/api-types";
import { APP_STORE_URL, PLAY_STORE_URL, founderScans, useAppConfig } from "@/lib/app-config";
import { checkOrder, fetchPendingOrder, fmtFounderDate } from "@/lib/billing";
import { sessionQuery, signOut } from "@/lib/auth-client";
import type { Session } from "@/lib/auth-client";
import { fmtDateIndo, fmtInt, fmtKg, jakartaDatePlusDays, parseNum } from "@/lib/format";
import { client, getServerUrl, orpc } from "@/utils/orpc";
import { openIosInstall } from "@/lib/ios-install";
import { usePlatform } from "@/lib/platform";

type MyProfileData = Awaited<ReturnType<AppRouterClient["profile"]["myProfile"]>>;
const profileOptions = orpc.profile.myProfile.queryOptions();

/** Center-crops the pick into a 512px square JPEG; one shape for every upload. */
async function fileToAvatarBase64(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = Math.floor((bitmap.width - side) / 2);
  const sy = Math.floor((bitmap.height - side) / 2);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Browser ini tidak mendukung pengolahan gambar.");
  }
  // Flatten alpha onto white — JPEG has no transparency anyway.
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, 512, 512);
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, 512, 512);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

export const Route = createFileRoute("/_auth/profil")({
  loader: ({ context }) => context.queryClient.ensureQueryData(profileOptions),
  pendingComponent: ProfilSkeleton,
  component: ProfilPage,
});

const GENDER_LABELS: Record<Gender, string> = {
  male: "Pria",
  female: "Wanita",
};

function ProfilPage() {
  const profile = useQuery(profileOptions);
  const { session } = Route.useRouteContext();

  if (profile.isPending) return <ProfilSkeleton />;
  if (profile.error) {
    return <ScreenError message={profile.error.message} onRetry={() => profile.refetch()} />;
  }
  if (!profile.data.profile || !profile.data.targets) {
    return <Navigate to="/onboarding" replace />;
  }

  const { profile: row, targets, latestWeightKg, tier, founderUntil } = profile.data;

  return (
    <ProfilContent
      row={row}
      targets={targets}
      latestWeightKg={latestWeightKg}
      tier={tier}
      founderUntil={founderUntil}
      name={session.user.name ?? null}
      email={session.user.email ?? null}
      image={session.user.image ?? null}
    />
  );
}

function ProfilContent({
  row,
  targets,
  latestWeightKg,
  tier,
  founderUntil,
  name,
  email,
  image,
}: {
  row: ProfileRow;
  targets: Targets;
  latestWeightKg: number | null;
  tier: "free" | "founder";
  founderUntil: Date | null;
  name: string | null;
  email: string | null;
  image: string | null;
}) {
  const platform = usePlatform();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const config = useAppConfig();
  const checkout = useCheckoutPicker();
  const billing = config.data?.billing === true;

  // Foto profil: unggahan dipotong jadi persegi 512px di kanvas dulu, lalu
  // disimpan server-side; sesi diperbarui langsung supaya semua layar ikut.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const patchSessionImage = (cache: OptimisticCache, image: string | null) => {
    cache.value<Session>(sessionQuery.queryKey, (old) =>
      old ? { ...old, user: { ...old.user, image } } : old,
    );
  };
  const uploadAvatar = useOptimisticMutation<
    Parameters<AppRouterClient["avatar"]["upload"]>[0],
    Awaited<ReturnType<AppRouterClient["avatar"]["upload"]>>
  >({
    mutationFn: (input) => client.avatar.upload(input),
    patch: (input, cache) => {
      // Preview the local image instantly; the server URL replaces it on settle.
      const local = `data:${input.mimeType};base64,${input.imageBase64}`;
      patchSessionImage(cache, local);
    },
    invalidate: () => [orpc.social.key(), orpc.group.key()],
    success: (_input, data) => {
      const swap = new OptimisticCache(queryClient);
      patchSessionImage(swap, data.image);
      return {
        message: "Foto profil diperbarui",
        undo: () => void client.avatar.remove({}),
      };
    },
  });
  // Delayed commit: foto hilang dari sesi seketika, DELETE menyusul setelah
  // jendela undo; undo mengembalikan foto tanpa memanggil server.
  const removeAvatar = useDelayedDelete<{ id: string }>({
    remove: async () => {
      const data = await client.avatar.remove({});
      // Server may fall back to the Google picture; reflect whatever it says.
      const swap = new OptimisticCache(queryClient);
      patchSessionImage(swap, data?.image ?? null);
    },
    patch: (_row, cache) => {
      patchSessionImage(cache, null);
    },
    label: () => "Foto profil",
  });
  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5_000_000) {
      toast.error("Fotonya terlalu besar, maksimal 5 MB.");
      return;
    }
    try {
      const imageBase64 = await fileToAvatarBase64(file);
      uploadAvatar.mutate({ imageBase64, mimeType: "image/jpeg" });
    } catch {
      toast.error("Foto tidak bisa dibaca, coba yang lain.");
    }
  };

  // A checkout the user abandoned at the gateway can still be settled: the
  // check endpoint asks DOKU/Pakasir directly and flips Founder on if paid.
  const pendingOrder = useQuery({
    queryKey: ["billing", "pending-order"],
    queryFn: fetchPendingOrder,
    enabled: tier === "free" && billing,
  });
  const checkPending = useMutation({
    mutationFn: () => {
      const orderId = pendingOrder.data?.orderId;
      if (!orderId) throw new Error("Tidak ada pembayaran yang menunggu.");
      return checkOrder(orderId);
    },
    onSuccess: (order) => {
      if (order.status !== "paid") {
        toast.error("Belum ada pembayaran masuk. Coba lagi sebentar.");
        return;
      }
      toast.success("Pembayaran masuk. Pro aktif!");
      queryClient.invalidateQueries({ queryKey: orpc.profile.key() });
      queryClient.invalidateQueries({ queryKey: ["billing", "pending-order"] });
    },
    onError: (error) => toast.error(error.message),
  });

  // Optimistic targets patch; undo re-applies the previous target values.
  const previousTargets = useRef<{ targetWeightKg: number; targetDate: string } | null>(null);
  const edit = useOptimisticMutation<
    Parameters<AppRouterClient["profile"]["updateTargets"]>[0],
    unknown
  >({
    mutationFn: (input) => client.profile.updateTargets(input),
    patch: (input, cache) => {
      const old = queryClient.getQueryData<MyProfileData>(profileOptions.queryKey);
      previousTargets.current =
        old?.profile?.targetWeightKg != null && old.profile.targetDate != null
          ? { targetWeightKg: old.profile.targetWeightKg, targetDate: old.profile.targetDate }
          : null;
      cache.value<MyProfileData>(profileOptions.queryKey, (data) =>
        data?.profile
          ? {
              ...data,
              profile: { ...data.profile, targetWeightKg: input.targetWeightKg, targetDate: input.targetDate },
            }
          : data,
      );
    },
    invalidate: () => [orpc.profile.key(), orpc.day.key(), orpc.weight.key()],
    success: () => {
      const prev = previousTargets.current;
      previousTargets.current = null;
      if (!prev) return { message: "Rencana diperbarui" };
      return {
        message: "Rencana diperbarui",
        undo: () =>
          void client.profile.updateTargets({
            targetWeightKg: prev.targetWeightKg,
            targetDate: prev.targetDate,
          }),
      };
    },
  });

  const [sheet, setSheet] = useState<null | "weight" | "date">(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      navigate({ to: "/login" });
    } finally {
      setSigningOut(false);
    }
  };

  const wipeData = async () => {
    setWiping(true);
    try {
      const res = await fetch(`${getServerUrl(env.VITE_SERVER_URL)}/api/privacy/delete-my-data`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Penghapusan gagal. Coba lagi nanti.");
      }
      toast.success("Semua data kamu sudah dihapus.");
      setConfirmWipe(false);
      queryClient.clear();
      navigate({ to: "/onboarding" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Penghapusan gagal. Coba lagi nanti.");
    } finally {
      setWiping(false);
    }
  };

  return (
    <Page className="max-w-xl">
      <header className="flex items-center gap-4 px-1 pt-2 pb-6">
        <Avatar name={name ?? email ?? "?"} image={image} className="size-16 text-xl" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-[1.375rem] leading-tight font-extrabold tracking-tight">
              {name ?? "Profil"}
            </h1>
            {(tier === "founder" || config.data?.paywall) && (
              <span
                className={cn(
                  "inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-bold",
                  tier === "founder"
                    ? "bg-makan-soft text-makan-ink"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {tier === "founder" ? "Pro" : "Gratis"}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {email ?? "Masuk lewat Google"}
          </p>
          <div className="mt-1.5 flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadAvatar.isPending}
            >
              <Camera />
              Ganti foto
            </Button>
            {image && (
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                onClick={() => removeAvatar({ id: "avatar" })}
                disabled={uploadAvatar.isPending}
              >
                Hapus foto
              </Button>
            )}
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            void pickAvatar(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </header>

      {tier === "free" && billing && (
        <div className="mb-3 rounded-3xl bg-makan-soft p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[0.9375rem] font-bold text-makan-ink">
                Scan AI {config.data?.freeDailyScans} kali sehari
              </p>
              <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
                Pro: {config.data ? founderScans(config.data).toLowerCase() : ""}.
              </p>
            </div>
            <Button
              size="sm"
              className="shrink-0"
              onClick={() =>
                navigate({ to: "/pro", search: { from: "profile", next: "/profil" } })
              }
            >
              Upgrade
            </Button>
          </div>
          {pendingOrder.data && (
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="min-w-0 text-sm leading-snug text-muted-foreground">
                Ada pembayaran Pro yang belum selesai.
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="shrink-0"
                disabled={checkPending.isPending}
                onClick={() => checkPending.mutate()}
              >
                {checkPending.isPending ? "Memeriksa..." : "Sudah bayar? Cek pembayaran"}
              </Button>
            </div>
          )}
        </div>
      )}

      {tier === "founder" && founderUntil && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-3xl bg-card p-5">
          <div className="min-w-0">
            <p className="text-[0.9375rem] font-bold">Pro aktif</p>
            <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
              Sampai {fmtFounderDate(founderUntil)}. Tidak diperpanjang otomatis.
            </p>
          </div>
          {billing && (
            <Button
              size="sm"
              variant="secondary"
              className="shrink-0"
              disabled={checkout.isPending}
              onClick={() => checkout.start((error) => toast.error(error.message))}
            >
              {checkout.isPending ? "Membuka..." : "Perpanjang"}
            </Button>
          )}
          {billing && checkout.sheet}
        </div>
      )}

      <SectionTitle>Rencana</SectionTitle>
      <ListGroup>
        <ListButtonRow
          icon={<Flag className="size-5 text-makan" aria-hidden />}
          title="Berat target"
          value={`${fmtKg(row.targetWeightKg)} kg`}
          onClick={() => setSheet("weight")}
        />
        <ListButtonRow
          icon={<CalendarDays className="size-5 text-bakar" aria-hidden />}
          title="Tanggal target"
          value={fmtDateIndo(row.targetDate).replace(/^\w+, /, "")}
          onClick={() => setSheet("date")}
        />
        <ListRow
          icon={<Footprints className="size-5 text-tidur" aria-hidden />}
          title="Aktivitas harian"
          value={ACTIVITY_LABELS[row.activityLevel as ActivityLevel] ?? row.activityLevel}
        />
      </ListGroup>
      <div className="mt-3">
        <PlanNumbers targets={targets} />
      </div>
      {targets.notes.length > 0 && (
        <div className="mt-3">
          <TargetNotesList notes={targets.notes} />
        </div>
      )}
      <p className="mt-3 px-1 text-xs leading-relaxed text-muted-foreground">
        Ubah target dan angka harian dihitung ulang otomatis.
      </p>

      <Sheet
        open={sheet === "weight"}
        onOpenChange={(open) => {
          if (!open) setSheet(null);
        }}
        title="Berat target"
        description="Angka harian dihitung ulang otomatis."
      >
        <TargetWeightForm
          heightCm={row.heightCm}
          targetWeightKg={row.targetWeightKg}
          pending={edit.isPending}
          onSave={(kg) =>
            edit.mutate(
              { targetWeightKg: kg, targetDate: row.targetDate },
              { onSuccess: () => setSheet(null) },
            )
          }
        />
      </Sheet>

      <Sheet
        open={sheet === "date"}
        onOpenChange={(open) => {
          if (!open) setSheet(null);
        }}
        title="Tanggal target"
        description="Kapan kamu ingin mencapai berat target."
      >
        <TargetDateForm
          targetDate={row.targetDate}
          weightNowKg={latestWeightKg ?? row.startWeightKg}
          targetWeightKg={row.targetWeightKg}
          pending={edit.isPending}
          onSave={(date) =>
            edit.mutate(
              { targetWeightKg: row.targetWeightKg, targetDate: date },
              { onSuccess: () => setSheet(null) },
            )
          }
        />
      </Sheet>

      <SectionTitle className="mt-7">Data diri</SectionTitle>
      <ListGroup>
        <ListRow title="Jenis kelamin" value={GENDER_LABELS[row.gender as Gender] ?? row.gender} />
        <ListRow title="Tahun lahir" value={String(row.birthYear)} />
        <ListRow title="Tinggi" value={`${fmtInt(row.heightCm)} cm`} />
        <ListRow title="Berat awal" value={`${fmtKg(row.startWeightKg)} kg`} />
        <ListRow
          title="Berat terkini"
          value={latestWeightKg !== null ? `${fmtKg(latestWeightKg)} kg` : "belum ada"}
        />
      </ListGroup>
      <p className="mt-3 px-1 text-xs leading-relaxed text-muted-foreground">
        Data diri diatur waktu onboarding. Berat terkini mengikuti timbangmu di halaman Berat.
      </p>

      <SectionTitle className="mt-7">Feed komunitas</SectionTitle>
      <FeedSettingsSection />

      <SectionTitle className="mt-7">Integrasi</SectionTitle>
      <StravaSection />

      <SectionTitle className="mt-7">Tampilan</SectionTitle>
      <ThemeSection />

      <SectionTitle className="mt-7">Mode Ramadan</SectionTitle>
      <RamadanSection mode={row.ramadanMode} />

      <SectionTitle className="mt-7">Puasa Intermiten</SectionTitle>
      <FastingSettingsSection />

      <SectionTitle className="mt-7">Pengingat</SectionTitle>
      <AppRemindersNote />

      <SectionTitle className="mt-7">Belanja makan</SectionTitle>
      <BudgetSetting />

      {platform.os === "ios" ? (
        !platform.standalone && (
          <>
            <SectionTitle className="mt-7">Aplikasi iPhone</SectionTitle>
            <ListGroup>
              <ListButtonRow
                icon={<Smartphone className="size-5 text-makan" aria-hidden />}
                title="Pasang di layar utama"
                subtitle="Web app dengan akun yang sama, terbuka layar penuh."
                onClick={() => openIosInstall("profil")}
              />
            </ListGroup>
          </>
        )
      ) : (
        <>
          <SectionTitle className="mt-7">Aplikasi Android</SectionTitle>
          <ListGroup>
            <ListAnchorRow
              href={PLAY_STORE_URL}
              icon={<Download className="size-5 text-makan" aria-hidden />}
              title="JoyoRogo di Google Play"
              subtitle="Pakai akun yang sama."
            />
            <ListAnchorRow
              href={APP_STORE_URL}
              icon={<Smartphone className="size-5 text-makan" aria-hidden />}
              title="JoyoRogo di App Store"
              subtitle="Untuk iPhone, akun yang sama."
            />
          </ListGroup>
        </>
      )}

      <SectionTitle className="mt-7">Privasi</SectionTitle>
      <ShareSection enabled={row.shareEnabled} code={row.shareCode} />
      <KeepPhotosSection keep={row.keepPhotos} />
      <ListGroup className="mt-3">
        <ListLinkRow
          to="/privasi"
          icon={<ShieldCheck className="size-5 text-makan" aria-hidden />}
          title="Kebijakan privasi"
        />
        <ListButtonRow
          destructive
          icon={<Trash2 className="size-5" aria-hidden />}
          title="Hapus semua data saya"
          subtitle="Profil, berat, makanan, olahraga, tidur. Permanen."
          onClick={() => setConfirmWipe(true)}
        />
      </ListGroup>

      <Sheet
        open={confirmWipe}
        onOpenChange={setConfirmWipe}
        title="Hapus semua data?"
        description="Tindakan ini permanen dan tidak bisa dibatalkan."
      >
        <div className="space-y-4">
          <p className="text-[0.9375rem] leading-relaxed">
            Semua catatan dihapus: profil, berat, makanan, olahraga, tidur. Akunmu tetap bisa
            dipakai, tapi kamu mulai lagi dari nol.
          </p>
          <div className="flex flex-col gap-2">
            <Button
              variant="destructive"
              className="w-full"
              disabled={wiping}
              onClick={() => void wipeData()}
            >
              {wiping ? "Menghapus..." : "Ya, hapus semua data saya"}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              disabled={wiping}
              onClick={() => setConfirmWipe(false)}
            >
              Batal
            </Button>
          </div>
        </div>
      </Sheet>

      <ListGroup className="mt-7">
        <ListButtonRow
          destructive
          icon={<LogOut className="size-5" aria-hidden />}
          title={signingOut ? "Keluar..." : "Keluar"}
          onClick={() => void handleSignOut()}
        />
      </ListGroup>
    </Page>
  );
}

function TargetWeightForm({
  heightCm,
  targetWeightKg,
  pending,
  onSave,
}: {
  heightCm: number;
  targetWeightKg: number;
  pending: boolean;
  onSave: (targetWeightKg: number) => void;
}) {
  const [weight, setWeight] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shownWeight = weight ?? String(targetWeightKg);
  const ideal = idealWeightRange(heightCm);
  const parsedWeight = parseNum(shownWeight);
  const belowRange = parsedWeight !== null && parsedWeight < ideal.minKg;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const kg = parseNum(shownWeight);
        if (kg === null || kg < 25 || kg > 400) {
          setError("Berat target harus 25-400 kg.");
          return;
        }
        setError(null);
        onSave(kg);
      }}
    >
      <div className="relative">
        <Input
          aria-label="Berat target (kg)"
          autoFocus
          type="number"
          step="0.1"
          min="25"
          max="400"
          inputMode="decimal"
          value={shownWeight}
          onChange={(event) => {
            setWeight(event.target.value);
            setError(null);
          }}
          className="h-16 pr-14 text-center text-3xl font-extrabold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="pointer-events-none absolute top-1/2 right-5 -translate-y-1/2 text-base font-semibold text-muted-foreground">
          kg
        </span>
      </div>
      <p className="text-sm text-muted-foreground tabular-nums">
        Berat sehat untuk tinggimu: {fmtKg(ideal.minKg)}–{fmtKg(ideal.maxKg)} kg
      </p>
      {belowRange && (
        <p className="text-sm leading-relaxed text-destructive">
          Di bawah rentang berat sehat. Boleh dilanjutkan, perhatikan kesehatanmu.
        </p>
      )}
      {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Menyimpan..." : "Simpan"}
      </Button>
    </form>
  );
}

function TargetDateForm({
  targetDate,
  weightNowKg,
  targetWeightKg,
  pending,
  onSave,
}: {
  targetDate: string;
  weightNowKg: number;
  targetWeightKg: number;
  pending: boolean;
  onSave: (targetDate: string) => void;
}) {
  const [date, setDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shownDate = date ?? targetDate;

  const tooFast = (() => {
    if (targetWeightKg >= weightNowKg) return null;
    const days = daysBetween(jakartaToday(), shownDate);
    if (days < 1) return null;
    const lossKg = weightNowKg - targetWeightKg;
    const rawDeficit = Math.round((lossKg * KCAL_PER_KG_FAT) / days);
    if (rawDeficit <= 1000) return null;
    const feasibleDays = Math.ceil((lossKg * KCAL_PER_KG_FAT) / 1000);
    return { rawDeficit, lossKg, feasibleDays };
  })();

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(shownDate) || shownDate < jakartaToday()) {
          setError("Tanggal target harus belum lewat.");
          return;
        }
        setError(null);
        onSave(shownDate);
      }}
    >
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            className="h-16 w-full justify-center rounded-xl text-lg font-extrabold tracking-tight"
          >
            <CalendarDays className="size-5 text-muted-foreground" aria-hidden />
            {fmtDateIndo(shownDate).replace(/^\w+, /, "")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={new Date(`${shownDate}T00:00:00`)}
            defaultMonth={new Date(`${shownDate}T00:00:00`)}
            disabled={{ before: new Date() }}
            onSelect={(day) => {
              if (day) {
                setDate(
                  `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`,
                );
                setError(null);
              }
            }}
          />
        </PopoverContent>
      </Popover>
      {tooFast && (
        <div className="rounded-2xl bg-bakar-soft p-4">
          <p className="flex items-start gap-1.5 text-sm leading-snug font-bold text-bakar-ink">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            Target ini menuntut defisit ~{fmtInt(tooFast.rawDeficit)} kkal/hari, di atas batas aman.
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            JoyoRogo membatasi defisit pada ~1.000 kkal/hari. Turun {fmtKg(tooFast.lossKg)} kg
            dengan ritme itu butuh sekitar {tooFast.feasibleDays} hari.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => {
              setDate(jakartaDatePlusDays(tooFast.feasibleDays));
              setError(null);
            }}
          >
            Pakai tanggal realistis (+{tooFast.feasibleDays} hari)
          </Button>
        </div>
      )}
      {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Menyimpan..." : "Simpan"}
      </Button>
    </form>
  );
}

function ShareSection({ enabled, code }: { enabled: boolean; code: string | null }) {
  const queryClient = useQueryClient();
  const previous = useRef<boolean | null>(null);
  const toggle = useOptimisticMutation<
    Parameters<AppRouterClient["profile"]["shareToggle"]>[0],
    unknown
  >({
    mutationFn: (input) => client.profile.shareToggle(input),
    patch: (input, cache) => {
      previous.current = enabled;
      cache.value<MyProfileData>(profileOptions.queryKey, (data) =>
        data?.profile ? { ...data, profile: { ...data.profile, publicPage: input.enabled } } : data,
      );
    },
    invalidate: () => [orpc.profile.key()],
    success: (input) => {
      const prev = previous.current;
      previous.current = null;
      return {
        message: input.enabled ? "Halaman publik aktif." : "Halaman publik dimatikan.",
        undo:
          prev === null
            ? undefined
            : () => void client.profile.shareToggle({ enabled: prev }),
      };
    },
  });
  const link = code ? `${getServerUrl(env.VITE_SERVER_URL)}/u/${code}` : null;

  return (
    <ListGroup>
      <ListRow
        icon={<Globe className="size-5 text-tidur" aria-hidden />}
        title="Progres publik"
        subtitle="Berat awal ke berat sekarang saja. Tanpa email, tanpa data makanan."
        trailing={
          <Switch
            label="Progres publik"
            checked={enabled}
            disabled={toggle.isPending}
            onCheckedChange={(next) => toggle.mutate({ enabled: next })}
          />
        }
      />
      {enabled && link && (
        <ListButtonRow
          icon={<Link2 className="size-5 text-muted-foreground" aria-hidden />}
          title="Salin tautan"
          value={`/u/${code}`}
          onClick={() => {
            void navigator.clipboard.writeText(link);
            toast.success("Tautan disalin, tinggal tempel di Threads.");
          }}
        />
      )}
    </ListGroup>
  );
}

/** Strava's app-icon mark: white glyph on Strava orange (#FC4C02), per their brand guide. */
function StravaLogo() {
  return (
    <span className="grid size-8 place-items-center rounded-lg bg-[#FC4C02]">
      <svg viewBox="0 0 24 24" fill="#fff" className="size-5" aria-hidden>
        <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
      </svg>
    </span>
  );
}

function StravaSection() {
  const {
    isChecking,
    statusError,
    configured,
    connected,
    athleteId,
    authorize,
    sync,
    disconnect,
    isSyncing,
    isDisconnecting,
    recheck,
  } = useStrava();

  if (isChecking) {
    return (
      <ListGroup>
        <ListRow icon={<StravaLogo />} title="Strava" subtitle="Memeriksa status..." />
      </ListGroup>
    );
  }
  if (statusError) {
    return (
      <ListGroup>
        <ListRow
          icon={<StravaLogo />}
          title="Strava"
          subtitle={`Gagal memeriksa status: ${statusError}`}
          trailing={
            <Button variant="secondary" size="xs" onClick={recheck}>
              Coba lagi
            </Button>
          }
        />
      </ListGroup>
    );
  }
  if (!configured) {
    return (
      <ListGroup>
        <ListRow
          icon={<StravaLogo />}
          title="Strava"
          subtitle="Sambungan aktif setelah kredensial Strava disetel di server."
        />
      </ListGroup>
    );
  }
  if (connected) {
    return (
      <ListGroup>
        <ListRow
          icon={<StravaLogo />}
          title="Strava"
          subtitle={`Terhubung${athleteId ? ` · ID atlet ${athleteId}` : ""}`}
          trailing={
            <Button variant="secondary" size="sm" onClick={() => sync()} disabled={isSyncing}>
              {isSyncing ? "Menyinkronkan..." : "Sinkron"}
            </Button>
          }
        />
        <ListButtonRow
          destructive
          icon={<StravaLogo />}
          title={isDisconnecting ? "Memutuskan..." : "Putuskan Strava"}
          onClick={() => disconnect()}
        />
      </ListGroup>
    );
  }
  return (
    <ListGroup>
      <ListButtonRow
        icon={<StravaLogo />}
        title="Strava"
        subtitle="Aktivitas Strava otomatis masuk ke Burn."
        onClick={() => authorize()}
      />
    </ListGroup>
  );
}

/**
 * Meal/water/weigh-in reminders are scheduled on the phone (local
 * notifications) and are not stored on the server, so the web has nothing to
 * sync. Only the IF reminders above also reach the browser via Web Push.
 */
function AppRemindersNote() {
  return (
    <Card>
      <p className="px-1 text-sm leading-relaxed text-muted-foreground">
        Pengingat catat makan, minum air, dan timbang ada di aplikasi Android dan iOS: buka Profil
        di aplikasi, lalu atur jam tiap pengingat di bagian Pengingat. Pengingat itu tersimpan di
        ponselmu, bukan di akun, jadi tidak muncul di web. Notifikasi puasa intermiten di atas
        tetap bisa dinyalakan di browser.
      </p>
    </Card>
  );
}

function ThemeSection() {
  const { theme, setTheme } = useTheme();
  return (
    <Card>
      <Segmented
        label="Tema tampilan"
        value={theme}
        onChange={setTheme}
        options={[
          { value: "light", label: "Terang" },
          { value: "dark", label: "Gelap" },
          { value: "system", label: "Sistem" },
        ]}
      />
      <p className="mt-3 px-1 text-xs leading-relaxed text-muted-foreground">
        Mode gelap mengikuti setelan sistemmu bila memilih Sistem.
      </p>
    </Card>
  );
}

function RamadanSection({ mode }: { mode: "auto" | "on" | "off" }) {
  const queryClient = useQueryClient();
  const previous = useRef<"auto" | "on" | "off" | null>(null);
  const setMode = useOptimisticMutation<
    Parameters<AppRouterClient["profile"]["setRamadanMode"]>[0],
    unknown
  >({
    mutationFn: (input) => client.profile.setRamadanMode(input),
    patch: (input, cache) => {
      previous.current = mode;
      cache.value<MyProfileData>(profileOptions.queryKey, (data) =>
        data?.profile ? { ...data, profile: { ...data.profile, ramadanMode: input.mode } } : data,
      );
    },
    invalidate: () => [orpc.profile.key()],
    success: () => {
      const prev = previous.current;
      previous.current = null;
      if (prev === null) return undefined;
      return {
        message: "Mode Ramadan diubah",
        undo: () => void client.profile.setRamadanMode({ mode: prev }),
      };
    },
  });
  const hint: Record<"auto" | "on" | "off", string> = {
    auto: "Slot makan mengikuti kalender Hijriah.",
    on: "Slot makan jadi sahur & berbuka.",
    off: "Jadwal makan normal.",
  };
  return (
    <Card>
      <Segmented
        label="Mode Ramadan"
        value={mode}
        onChange={(value) => setMode.mutate({ mode: value })}
        options={[
          { value: "auto", label: "Otomatis" },
          { value: "on", label: "Aktif" },
          { value: "off", label: "Mati" },
        ]}
      />
      <p className="mt-3 px-1 text-xs leading-relaxed text-muted-foreground">{hint[mode]}</p>
    </Card>
  );
}

function KeepPhotosSection({ keep }: { keep: boolean }) {
  const queryClient = useQueryClient();
  const patchKeep = (cache: OptimisticCache, value: boolean) => {
    cache.value<MyProfileData>(profileOptions.queryKey, (data) =>
      data?.profile ? { ...data, profile: { ...data.profile, keepPhotos: value } } : data,
    );
  };
  // keep=true is a safe instant edit; keep=false destroys stored photos
  // server-side, so the destructive call is delayed behind the undo window.
  const previousKeep = useRef<boolean | null>(null);
  const setKeep = useOptimisticMutation<
    Parameters<AppRouterClient["profile"]["setKeepPhotos"]>[0],
    unknown
  >({
    mutationFn: (input) => client.profile.setKeepPhotos(input),
    patch: (input, cache) => {
      if (input.keep) {
        previousKeep.current = keep;
        patchKeep(cache, true);
      }
    },
    invalidate: () => [orpc.profile.key(), orpc.food.key()],
    success: (input) => {
      if (!input.keep) return undefined;
      const prev = previousKeep.current;
      previousKeep.current = null;
      if (prev === false) {
        return {
          message: "Foto asli akan disimpan mulai scan berikutnya.",
          undo: () => void client.profile.setKeepPhotos({ keep: false }),
        };
      }
      return { message: "Foto asli akan disimpan mulai scan berikutnya." };
    },
  });
  // Delayed commit for the destructive keep=false branch.
  const disableKeep = useDelayedDelete<{ id: string }>({
    remove: () => client.profile.setKeepPhotos({ keep: false }),
    patch: (_row, cache) => {
      patchKeep(cache, false);
    },
    label: () => "Foto asli",
    fallback: "Foto asli",
    invalidate: () => [orpc.profile.key(), orpc.food.key()],
  });
  const [confirmOff, setConfirmOff] = useState(false);
  return (
    <>
      <ListGroup className="mt-3">
        <ListRow
          icon={<ImageIcon className="size-5 text-makan-ink" aria-hidden />}
          title="Simpan foto asli"
          subtitle={
            keep
              ? "Bisa dilihat lagi di diari, hanya oleh kamu."
              : "Mati: hanya potongan tiap makanan yang disimpan."
          }
          trailing={
            <Switch
              label="Simpan foto asli"
              checked={keep}
              onCheckedChange={(next) =>
                next ? setKeep.mutate({ keep: true }) : setConfirmOff(true)
              }
            />
          }
        />
      </ListGroup>
      <Sheet
        open={confirmOff}
        onOpenChange={setConfirmOff}
        title="Matikan simpan foto asli?"
        description="Foto asli yang sudah tersimpan ikut dihapus permanen."
      >
        <div className="space-y-4">
          <p className="text-[0.9375rem] leading-relaxed">
            Catatan makan dan stiker tiap makanan tetap ada. Hanya foto aslinya yang dihapus.
          </p>
          <div className="flex flex-col gap-2">
            <Button
              variant="destructive"
              className="w-full"
              onClick={() => {
                setConfirmOff(false);
                disableKeep({ id: "keep-photos" });
              }}
            >
              Ya, matikan dan hapus foto asli
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              disabled={setKeep.isPending}
              onClick={() => setConfirmOff(false)}
            >
              Batal
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}

function ProfilSkeleton() {
  return (
    <Page className="max-w-xl" aria-busy="true" aria-label="Memuat profil">
      <div className="flex items-center gap-4 px-1 pt-2 pb-6">
        <Skeleton className="size-16 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-40 rounded-full" />
          <Skeleton className="h-4 w-52 rounded-full" />
        </div>
      </div>
      <Skeleton className="h-5 w-24 rounded-full" />
      <Skeleton className="mt-3 h-[13.5rem] rounded-3xl" />
      <div className="mt-3 grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="mt-7 h-5 w-28 rounded-full" />
      <Skeleton className="mt-3 h-64 rounded-3xl" />
    </Page>
  );
}
