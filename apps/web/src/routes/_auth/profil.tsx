import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppRouterClient } from "@joyorogo/api/routers/index";

import { OptimisticCache, useDelayedDelete, useOptimisticMutation } from "@/lib/optimistic";
import { Link, Navigate, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Calculator,
  CalendarDays,
  Camera,
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
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  ACTIVITY_LABELS,
  idealWeightRange,
} from "@joyorogo/api/lib/engine";
import type { ActivityLevel, Targets } from "@joyorogo/api/lib/engine";
import { i18n, LOCALES, LOCALE_NAMES } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";
import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
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
import { MaternalSettings } from "@/components/maternal/settings-section";
import { Switch } from "@/components/kit/switch";
import { PlanNumbers, TargetNotesList } from "@/components/plan-numbers";
import { NeedsSheet } from "@/components/needs-sheet";
import { TargetDateForm } from "@/components/target-date-form";
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
import { fmtDateLong, fmtInt, fmtKg, parseNum } from "@/lib/format";
import { client, getServerUrl, orpc } from "@/utils/orpc";
import { openIosInstall } from "@/lib/ios-install";
import { setLocale } from "@/lib/i18n";
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
    throw new Error(i18n.t("settings:profile.photo.error.noCanvas"));
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
  validateSearch: (search: Record<string, unknown>): { needs?: true; maternal?: true } => ({
    needs: search.needs === true || search.needs === 1 || search.needs === "1" ? true : undefined,
    maternal:
      search.maternal === true || search.maternal === 1 || search.maternal === "1" ? true : undefined,
  }),
  pendingComponent: ProfilSkeleton,
  component: ProfilPage,
});

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
  const { t } = useTranslation(["settings", "common", "maternal"]);
  const platform = usePlatform();
  const navigate = useNavigate();
  const { needs, maternal: openMaternalParam } = Route.useSearch();
  const openMaternal = openMaternalParam === true;
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
        message: t("profile.photo.updated"),
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
    label: () => t("profile.photo.label"),
  });
  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5_000_000) {
      toast.error(t("profile.photo.error.tooLarge"));
      return;
    }
    try {
      const imageBase64 = await fileToAvatarBase64(file);
      uploadAvatar.mutate({ imageBase64, mimeType: "image/jpeg" });
    } catch {
      toast.error(t("profile.photo.error.unreadable"));
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
      if (!orderId) throw new Error(t("pro.pending.none"));
      return checkOrder(orderId);
    },
    onSuccess: (order) => {
      if (order.status !== "paid") {
        toast.error(t("pro.pending.notPaid"));
        return;
      }
      toast.success(t("pro.pending.paid"));
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
      if (!prev) return { message: t("plan.toast.updated") };
      return {
        message: t("plan.toast.updated"),
        undo: () =>
          void client.profile.updateTargets({
            targetWeightKg: prev.targetWeightKg,
            targetDate: prev.targetDate,
          }),
      };
    },
  });

  const [sheet, setSheet] = useState<null | "weight" | "date" | "needs">(needs ? "needs" : null);
  const [dateError, setDateError] = useState<string | null>(null);
  const closeSheet = () => {
    setSheet(null);
    setDateError(null);
    if (needs) navigate({ to: "/profil", search: {}, replace: true });
  };
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
        throw new Error(body?.error ?? t("privacy.wipe.failed"));
      }
      toast.success(t("privacy.wipe.done"));
      setConfirmWipe(false);
      queryClient.clear();
      navigate({ to: "/onboarding" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("privacy.wipe.failed"));
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
              {name ?? t("common:more.fallbackNameWeb")}
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
                {tier === "founder" ? "Pro" : t("profile.badge.free")}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {email ?? t("profile.emailFallback")}
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
              {t("profile.photo.change")}
            </Button>
            {image && (
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                onClick={() => removeAvatar({ id: "avatar" })}
                disabled={uploadAvatar.isPending}
              >
                {t("profile.photo.remove")}
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
                {t("pro.free.scansPerDay", { count: config.data?.freeDailyScans ?? 0 })}
              </p>
              <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
                {config.data?.founderDailyCap == null
                  ? t("pro.free.proUnlimited")
                  : t("pro.free.proCapped", { count: config.data.founderDailyCap })}
              </p>
            </div>
            <Button
              size="sm"
              className="shrink-0"
              onClick={() =>
                navigate({ to: "/pro", search: { from: "profile", next: "/profil" } })
              }
            >
              {t("pro.free.upgrade")}
            </Button>
          </div>
          {pendingOrder.data && (
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="min-w-0 text-sm leading-snug text-muted-foreground">
                {t("pro.pending.note")}
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="shrink-0"
                disabled={checkPending.isPending}
                onClick={() => checkPending.mutate()}
              >
                {checkPending.isPending ? t("pro.pending.checking") : t("pro.pending.check")}
              </Button>
            </div>
          )}
        </div>
      )}

      {tier === "founder" && founderUntil && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-3xl bg-card p-5">
          <div className="min-w-0">
            <p className="text-[0.9375rem] font-bold">{t("pro.active.title")}</p>
            <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
              {t("pro.active.until", { date: fmtFounderDate(founderUntil) })}
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
              {checkout.isPending ? t("pro.active.opening") : t("pro.active.renew")}
            </Button>
          )}
          {billing && checkout.sheet}
        </div>
      )}

      <SectionTitle>{t("section.plan")}</SectionTitle>
      <ListGroup>
        {(row.gender === "female" || targets.maternal) && (
          <MaternalSettings
            row={row}
            info={targets.maternal}
            defaultOpen={openMaternal}
            onClosed={() => {
              if (openMaternal) navigate({ to: "/profil", search: {}, replace: true });
            }}
          />
        )}
        {!targets.maternal && (
          <>
            <ListButtonRow
              icon={<Flag className="size-5 text-makan" aria-hidden />}
              title={t("plan.targetWeight.title")}
              value={`${fmtKg(row.targetWeightKg)} kg`}
              onClick={() => setSheet("weight")}
            />
            <ListButtonRow
              icon={<CalendarDays className="size-5 text-bakar" aria-hidden />}
              title={t("plan.targetDate.title")}
              value={fmtDateLong(row.targetDate).replace(/^\w+, /, "")}
              onClick={() => setSheet("date")}
            />
          </>
        )}
        <ListRow
          icon={<Footprints className="size-5 text-tidur" aria-hidden />}
          title={t("plan.activity.title")}
          value={ACTIVITY_LABELS[row.activityLevel as ActivityLevel] ?? row.activityLevel}
        />
      </ListGroup>
      <div className="mt-3">
        <PlanNumbers targets={targets} />
      </div>
      <ListGroup className="mt-3">
        <ListButtonRow
          icon={<Calculator className="size-5 text-makan" aria-hidden />}
          title={t("plan.needs.row")}
          value={t("plan.needs.rowValue", { kcal: fmtInt(targets.tdee) })}
          onClick={() => setSheet("needs")}
        />
      </ListGroup>
      {targets.notes.some((note) => note !== "MATERNAL") && (
        <div className="mt-3">
          <TargetNotesList notes={targets.notes} />
        </div>
      )}
      {!targets.maternal && (
        <p className="mt-3 px-1 text-xs leading-relaxed text-muted-foreground">
          {t("plan.recalcNote")}
        </p>
      )}

      <Sheet
        open={sheet === "weight"}
        onOpenChange={(open) => {
          if (!open) closeSheet();
        }}
        title={t("plan.targetWeight.title")}
        description={t("plan.targetWeight.hint")}
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
          if (!open) closeSheet();
        }}
        title={t("plan.targetDate.title")}
        description={t("plan.targetDate.hint")}
      >
        <TargetDateForm
          targetDate={row.targetDate}
          weightNowKg={latestWeightKg ?? row.startWeightKg}
          targetWeightKg={row.targetWeightKg}
          pending={edit.isPending}
          serverError={dateError}
          onSave={(date) => {
            setDateError(null);
            edit.mutate(
              { targetWeightKg: row.targetWeightKg, targetDate: date },
              {
                onSuccess: () => setSheet(null),
                onError: (error) => setDateError(error.message),
              },
            );
          }}
        />
      </Sheet>

      <NeedsSheet
        open={sheet === "needs"}
        onOpenChange={(open) => {
          if (!open) closeSheet();
        }}
        targets={targets}
        activityLabel={String(ACTIVITY_LABELS[row.activityLevel as ActivityLevel] ?? row.activityLevel)}
      />

      <SectionTitle className="mt-7">{t("section.personal")}</SectionTitle>
      <ListGroup>
        <ListRow
          title={t("profile.personal.gender")}
          value={
            row.gender === "male" || row.gender === "female"
              ? t(`profile.gender.${row.gender}`)
              : row.gender
          }
        />
        <ListRow title={t("profile.personal.birthYear")} value={String(row.birthYear)} />
        <ListRow title={t("profile.personal.height")} value={`${fmtInt(row.heightCm)} cm`} />
        <ListRow
          title={t("profile.personal.startWeight")}
          value={`${fmtKg(row.startWeightKg)} kg`}
        />
        <ListRow
          title={t("profile.personal.currentWeight")}
          value={
            latestWeightKg !== null
              ? `${fmtKg(latestWeightKg)} kg`
              : t("profile.personal.currentWeightNone")
          }
        />
      </ListGroup>
      <p className="mt-3 px-1 text-xs leading-relaxed text-muted-foreground">
        {t("profile.personal.note")}
      </p>

      <SectionTitle className="mt-7">{t("section.feed")}</SectionTitle>
      <FeedSettingsSection />

      <SectionTitle className="mt-7">{t("section.integrations")}</SectionTitle>
      <StravaSection />

      <SectionTitle className="mt-7">{t("section.appearance")}</SectionTitle>
      <ThemeSection />

      <SectionTitle className="mt-7">{t("language.title")}</SectionTitle>
      <LanguageSection />

      <SectionTitle className="mt-7">{t("section.ramadan")}</SectionTitle>
      <RamadanSection mode={row.ramadanMode} />
      {targets.maternal && (
        <p className="mt-3 px-1 text-xs leading-relaxed text-muted-foreground">
          {t("maternal:settings.ramadanNote")}
        </p>
      )}

      {!targets.maternal && (
        <>
          <SectionTitle className="mt-7">{t("section.fasting")}</SectionTitle>
          <FastingSettingsSection />
        </>
      )}

      <SectionTitle className="mt-7">{t("section.reminders")}</SectionTitle>
      <AppRemindersNote />

      <SectionTitle className="mt-7">{t("section.shopping")}</SectionTitle>
      <BudgetSetting />

      {platform.os === "ios" ? (
        !platform.standalone && (
          <>
            <SectionTitle className="mt-7">{t("section.appIphone")}</SectionTitle>
            <ListGroup>
              <ListButtonRow
                icon={<Smartphone className="size-5 text-makan" aria-hidden />}
                title={t("app.install.title")}
                subtitle={t("app.install.subtitle")}
                onClick={() => openIosInstall("profil")}
              />
            </ListGroup>
          </>
        )
      ) : (
        <>
          <SectionTitle className="mt-7">{t("section.appAndroid")}</SectionTitle>
          <ListGroup>
            <ListAnchorRow
              href={PLAY_STORE_URL}
              icon={<Download className="size-5 text-makan" aria-hidden />}
              title={t("app.googlePlay.title")}
              subtitle={t("app.googlePlay.subtitle")}
            />
            <ListAnchorRow
              href={APP_STORE_URL}
              icon={<Smartphone className="size-5 text-makan" aria-hidden />}
              title={t("app.appStore.title")}
              subtitle={t("app.appStore.subtitle")}
            />
          </ListGroup>
        </>
      )}

      <SectionTitle className="mt-7">{t("section.privacy")}</SectionTitle>
      {!targets.maternal && <ShareSection enabled={row.shareEnabled} code={row.shareCode} />}
      <KeepPhotosSection keep={row.keepPhotos} />
      <ListGroup className="mt-3">
        <ListLinkRow
          to="/privasi"
          icon={<ShieldCheck className="size-5 text-makan" aria-hidden />}
          title={t("privacy.policy")}
        />
        <ListButtonRow
          destructive
          icon={<Trash2 className="size-5" aria-hidden />}
          title={t("privacy.wipe.title")}
          subtitle={t("privacy.wipe.subtitleWeb")}
          onClick={() => setConfirmWipe(true)}
        />
      </ListGroup>

      <Sheet
        open={confirmWipe}
        onOpenChange={setConfirmWipe}
        title={t("privacy.wipe.confirmTitle")}
        description={t("privacy.wipe.confirmDescription")}
      >
        <div className="space-y-4">
          <p className="text-[0.9375rem] leading-relaxed">{t("privacy.wipe.confirmBodyWeb")}</p>
          <div className="flex flex-col gap-2">
            <Button
              variant="destructive"
              className="w-full"
              disabled={wiping}
              onClick={() => void wipeData()}
            >
              {wiping ? t("privacy.wipe.deleting") : t("privacy.wipe.confirmAction")}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              disabled={wiping}
              onClick={() => setConfirmWipe(false)}
            >
              {t("common:actions.cancel")}
            </Button>
          </div>
        </div>
      </Sheet>

      <ListGroup className="mt-7">
        <ListButtonRow
          destructive
          icon={<LogOut className="size-5" aria-hidden />}
          title={signingOut ? t("account.signingOut") : t("account.signOut")}
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
  const { t } = useTranslation(["settings", "common"]);
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
          setError(t("plan.targetWeight.error"));
          return;
        }
        setError(null);
        onSave(kg);
      }}
    >
      <div className="relative">
        <Input
          aria-label={t("plan.targetWeight.inputLabel")}
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
        {t("plan.targetWeight.healthyRange", { min: fmtKg(ideal.minKg), max: fmtKg(ideal.maxKg) })}
      </p>
      {belowRange && (
        <p className="text-sm leading-relaxed text-destructive">
          {t("plan.targetWeight.belowRange")}
        </p>
      )}
      {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t("state.saving") : t("common:actions.save")}
      </Button>
    </form>
  );
}

function ShareSection({ enabled, code }: { enabled: boolean; code: string | null }) {
  const { t } = useTranslation(["settings", "common"]);
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
        message: input.enabled ? t("privacy.share.toastOn") : t("privacy.share.toastOff"),
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
        title={t("privacy.share.titleWeb")}
        subtitle={t("privacy.share.hintWeb")}
        trailing={
          <Switch
            label={t("privacy.share.titleWeb")}
            checked={enabled}
            disabled={toggle.isPending}
            onCheckedChange={(next) => toggle.mutate({ enabled: next })}
          />
        }
      />
      {enabled && link && (
        <ListButtonRow
          icon={<Link2 className="size-5 text-muted-foreground" aria-hidden />}
          title={t("privacy.share.copyLink")}
          value={`/u/${code}`}
          onClick={() => {
            void navigator.clipboard.writeText(link);
            toast.success(t("privacy.share.copied"));
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
  const { t } = useTranslation(["settings", "common"]);
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
        <ListRow icon={<StravaLogo />} title="Strava" subtitle={t("strava.status.checking")} />
      </ListGroup>
    );
  }
  if (statusError) {
    return (
      <ListGroup>
        <ListRow
          icon={<StravaLogo />}
          title="Strava"
          subtitle={t("strava.status.error", { error: statusError })}
          trailing={
            <Button variant="secondary" size="xs" onClick={recheck}>
              {t("common:actions.retry")}
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
          subtitle={t("strava.status.notConfiguredServer")}
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
          subtitle={
            athleteId
              ? t("strava.status.sectionConnectedAthlete", { id: athleteId })
              : t("strava.status.sectionConnected")
          }
          trailing={
            <Button variant="secondary" size="sm" onClick={() => sync()} disabled={isSyncing}>
              {isSyncing ? t("strava.action.syncing") : t("strava.action.sync")}
            </Button>
          }
        />
        <ListButtonRow
          destructive
          icon={<StravaLogo />}
          title={
            isDisconnecting
              ? t("strava.action.disconnecting")
              : t("strava.action.disconnectStrava")
          }
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
        subtitle={t("strava.status.idle")}
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
  const { t } = useTranslation(["settings", "common"]);
  return (
    <Card>
      <p className="px-1 text-sm leading-relaxed text-muted-foreground">{t("reminders.webNote")}</p>
    </Card>
  );
}

function ThemeSection() {
  const { t } = useTranslation(["settings", "common"]);
  const { theme, setTheme } = useTheme();
  return (
    <Card>
      <Segmented
        label={t("theme.label")}
        value={theme}
        onChange={setTheme}
        options={[
          { value: "light", label: t("theme.light") },
          { value: "dark", label: t("theme.dark") },
          { value: "system", label: t("theme.system") },
        ]}
      />
      <p className="mt-3 px-1 text-xs leading-relaxed text-muted-foreground">{t("theme.hint")}</p>
    </Card>
  );
}

/** App language: applies at once on this device, then saves on the account. */
function LanguageSection() {
  const { t, i18n: instance } = useTranslation(["settings", "common"]);
  const queryClient = useQueryClient();
  const save = useMutation(
    orpc.profile.setLocale.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: profileOptions.queryKey }),
      onError: () => toast.error(i18n.t("settings:language.saveError")),
    }),
  );
  const pick = (locale: Locale) => {
    if (locale === instance.language) return;
    // Patch the cached profile first so LocaleSync keeps the new choice instead
    // of re-applying the old saved one while the request is in flight.
    queryClient.setQueryData<MyProfileData>(profileOptions.queryKey, (data) =>
      data?.profile ? { ...data, profile: { ...data.profile, locale } } : data,
    );
    void setLocale(locale);
    save.mutate({ locale });
  };
  return (
    <Card>
      <Segmented
        label={t("language.groupLabel")}
        value={instance.language as Locale}
        onChange={pick}
        options={LOCALES.map((locale) => ({ value: locale, label: LOCALE_NAMES[locale] }))}
      />
      <p className="mt-3 px-1 text-xs leading-relaxed text-muted-foreground">
        {t("language.caption")}
      </p>
    </Card>
  );
}

function RamadanSection({ mode }: { mode: "auto" | "on" | "off" }) {
  const { t } = useTranslation(["settings", "common"]);
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
        message: t("ramadan.toast"),
        undo: () => void client.profile.setRamadanMode({ mode: prev }),
      };
    },
  });
  const hint: Record<"auto" | "on" | "off", string> = {
    auto: t("ramadan.hint.auto"),
    on: t("ramadan.hint.on"),
    off: t("ramadan.hint.off"),
  };
  return (
    <Card>
      <Segmented
        label={t("section.ramadan")}
        value={mode}
        onChange={(value) => setMode.mutate({ mode: value })}
        options={[
          { value: "auto", label: t("ramadan.option.auto") },
          { value: "on", label: t("ramadan.option.on") },
          { value: "off", label: t("ramadan.option.off") },
        ]}
      />
      <p className="mt-3 px-1 text-xs leading-relaxed text-muted-foreground">{hint[mode]}</p>
    </Card>
  );
}

function KeepPhotosSection({ keep }: { keep: boolean }) {
  const { t } = useTranslation(["settings", "common"]);
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
          message: t("privacy.keepPhotos.toast"),
          undo: () => void client.profile.setKeepPhotos({ keep: false }),
        };
      }
      return { message: t("privacy.keepPhotos.toast") };
    },
  });
  // Delayed commit for the destructive keep=false branch.
  const disableKeep = useDelayedDelete<{ id: string }>({
    remove: () => client.profile.setKeepPhotos({ keep: false }),
    patch: (_row, cache) => {
      patchKeep(cache, false);
    },
    label: () => t("privacy.keepPhotos.label"),
    fallback: t("privacy.keepPhotos.label"),
    invalidate: () => [orpc.profile.key(), orpc.food.key()],
  });
  const [confirmOff, setConfirmOff] = useState(false);
  return (
    <>
      <ListGroup className="mt-3">
        <ListRow
          icon={<ImageIcon className="size-5 text-makan-ink" aria-hidden />}
          title={t("privacy.keepPhotos.title")}
          subtitle={keep ? t("privacy.keepPhotos.onWeb") : t("privacy.keepPhotos.offWeb")}
          trailing={
            <Switch
              label={t("privacy.keepPhotos.title")}
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
        title={t("privacy.keepPhotos.confirm.title")}
        description={t("privacy.keepPhotos.confirm.descriptionWeb")}
      >
        <div className="space-y-4">
          <p className="text-[0.9375rem] leading-relaxed">
            {t("privacy.keepPhotos.confirm.bodyWeb")}
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
              {t("privacy.keepPhotos.confirm.actionWeb")}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              disabled={setKeep.isPending}
              onClick={() => setConfirmOff(false)}
            >
              {t("common:actions.cancel")}
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}

function ProfilSkeleton() {
  const { t } = useTranslation(["settings", "common"]);
  return (
    <Page className="max-w-xl" aria-busy="true" aria-label={t("profile.loading")}>
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
