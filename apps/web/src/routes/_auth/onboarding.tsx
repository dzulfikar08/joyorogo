import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, isRedirect, redirect, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CalendarDays, CircleAlert, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  ACTIVITY_LABELS,
  daysBetween,
  idealWeightRange,
  jakartaToday,
  KCAL_PER_KG_FAT,
} from "@joyorogo/api/lib/engine";
import type { ActivityLevel, Gender } from "@joyorogo/api/lib/engine";
import { Button } from "@joyorogo/ui/components/button";
import { Calendar } from "@joyorogo/ui/components/calendar";
import { Input } from "@joyorogo/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@joyorogo/ui/components/popover";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";
import { Mascot } from "@/components/mascot";
import { Page } from "@/components/kit/surface";
import { PlanNumbers, TargetNotesList } from "@/components/plan-numbers";
import { trackConversion } from "@/lib/analytics";
import { fmtDateIndo, fmtInt, fmtKg, jakartaDatePlusDays, parseNum } from "@/lib/format";
import { InviteFriendsStep } from "@/components/onboarding/invite-step";
import { useSession } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

const profileOptions = orpc.profile.myProfile.queryOptions();

export const Route = createFileRoute("/_auth/onboarding")({
  loader: async ({ context }) => {
    try {
      const existing = await context.queryClient.ensureQueryData(profileOptions);
      if (existing.profile) throw redirect({ to: "/" });
    } catch (error) {
      if (isRedirect(error)) throw error;
      // Server unreachable: still render the form; saving surfaces the error.
    }
  },
  pendingComponent: OnboardingSkeleton,
  component: OnboardingPage,
});

type FormState = {
  birthYear: string;
  gender: Gender | "";
  heightCm: string;
  weightKg: string;
  activityLevel: ActivityLevel;
  targetWeightKg: string;
  targetDate: string;
};

/** Seven questions, one per screen; the eighth view is the result. */
const STEP_COUNT = 7;

const QUESTION_TITLE: Record<number, string> = {
  1: "Kapan kamu lahir?",
  2: "Jenis kelaminmu?",
  3: "Berapa tinggimu?",
  4: "Berat badanmu sekarang?",
  5: "Seberapa aktif hari-harimu?",
  6: "Berat targetmu?",
  7: "Kapan mau mencapainya?",
};

const QUESTION_HINT: Record<number, string | null> = {
  1: "Dipakai menghitung kebutuhan kalorimu.",
  2: "Kebutuhan kalori pria dan wanita memang beda.",
  3: null,
  4: "Sekalian jadi timbangan awalmu. Bisa diperbarui tiap hari di halaman Berat.",
  5: "Aktivitas di luar olahraga.",
  6: null,
  7: "Turun berat yang aman itu sekitar 0,5 sampai 1 kg per minggu.",
};

/** Big tappable answer tile; selected state uses the brand tint. */
function ChoiceTile({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "pressable flex min-h-20 items-center justify-center rounded-2xl bg-card px-3 py-4 text-center text-[0.9375rem] leading-snug font-bold focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
        active && "bg-makan-soft ring-2 ring-makan",
      )}
    >
      {children}
    </button>
  );
}

/** Big centered numeric field with a unit suffix; spinners off, they fight the suffix. */
function BigNumberField({
  id,
  label,
  value,
  onValueChange,
  unit,
  step,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  unit: string;
  step?: string;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        aria-label={label}
        autoFocus
        type="number"
        inputMode="decimal"
        step={step}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className="h-16 pr-14 text-center text-3xl font-extrabold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span className="pointer-events-none absolute top-1/2 right-5 -translate-y-1/2 text-base font-semibold text-muted-foreground">
        {unit}
      </span>
    </div>
  );
}

function OnboardingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [done, setDone] = useState(false);
  const [inviting, setInviting] = useState(false);
  const session = useSession();
  const [form, setForm] = useState<FormState>({
    birthYear: "1995",
    gender: "",
    heightCm: "165",
    weightKg: "70",
    activityLevel: "low",
    targetWeightKg: "65",
    targetDate: jakartaDatePlusDays(90),
  });
  const [error, setError] = useState<string | null>(null);

  const save = useMutation(
    orpc.profile.upsert.mutationOptions({
      onSuccess: () => {
        // Everything (summary, weigh-in, plan) derives from the profile. The
        // cached "no profile yet" answers must go, not just turn stale: route
        // loaders (ensureQueryData) would serve them again and bounce
        // Beranda straight back here until a manual refresh.
        queryClient.removeQueries({ queryKey: orpc.profile.key() });
        queryClient.removeQueries({ queryKey: orpc.day.key() });
        queryClient.invalidateQueries();
        setDone(true);
        trackConversion("onboarding_complete");
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  const set = (patch: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...patch }));
    setError(null);
  };

  const height = parseNum(form.heightCm);
  const weight = parseNum(form.weightKg);
  const birthYear = parseNum(form.birthYear);
  const targetWeight = parseNum(form.targetWeightKg);
  const ideal = height !== null && height >= 100 && height <= 250 ? idealWeightRange(height) : null;

  // Same checks as before, now one step at a time so the error always sits
  // next to the question it belongs to. The final step re-validates the whole
  // form exactly like the old single submit did.
  const validateStep = (current: number): boolean => {
    switch (current) {
      case 1:
        if (
          birthYear === null ||
          !Number.isInteger(birthYear) ||
          birthYear < 1930 ||
          birthYear > 2020
        ) {
          setError("Tahun lahir harus di antara 1930-2020.");
          return false;
        }
        return true;
      case 2:
        if (form.gender === "") {
          setError("Pilih jenis kelamin dulu.");
          return false;
        }
        return true;
      case 3:
        if (height === null || height < 100 || height > 250) {
          setError("Tinggi badan harus 100-250 cm.");
          return false;
        }
        return true;
      case 4:
        if (weight === null || weight < 25 || weight > 400) {
          setError("Berat badan harus 25-400 kg.");
          return false;
        }
        return true;
      case 6:
        if (targetWeight === null || targetWeight < 25 || targetWeight > 400) {
          setError("Berat target harus 25-400 kg.");
          return false;
        }
        return true;
      default:
        return true;
    }
  };

  const next = () => {
    if (step === 7) {
      if (targetWeight === null || targetWeight < 25 || targetWeight > 400) {
        setError("Berat target harus 25-400 kg.");
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.targetDate) || form.targetDate < jakartaToday()) {
        setError("Tanggal target harus belum lewat.");
        return;
      }
      if (birthYear === null || form.gender === "" || height === null || weight === null) {
        setStep(1);
        return;
      }
      setError(null);
      save.mutate({
        birthYear,
        gender: form.gender,
        heightCm: height,
        weightKg: weight,
        targetWeightKg: targetWeight,
        targetDate: form.targetDate,
        activityLevel: form.activityLevel,
      });
      return;
    }
    if (!validateStep(step)) return;
    setError(null);
    setStep(step + 1);
  };

  const back = () => {
    setError(null);
    setStep(step - 1);
  };

  const openApp = () =>
    navigate({ to: "/founder", search: { from: "onboarding", next: "/beranda" } });

  if (done && save.data?.targets && inviting) {
    const firstName = session.data?.user.name?.trim().split(/\s+/)[0];
    return (
      <InviteFriendsStep
        defaultName={firstName ? `Diet bareng ${firstName}`.slice(0, 40) : "Diet bareng"}
        onSkip={openApp}
        onOpenGroup={(groupId) => navigate({ to: "/grup/$groupId", params: { groupId } })}
      />
    );
  }

  if (done && save.data?.targets) {
    return (
      <Page className="max-w-xl">
        <header className="px-1 pt-2 pb-6">
          <Mascot pose="cheer" size="md" eager className="mx-0 mb-3" />
          <h1 className="text-[1.75rem] leading-tight font-extrabold tracking-tight">
            Rencana harianmu siap
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Timbangan awalmu juga sudah tercatat hari ini.
          </p>
        </header>
        <PlanNumbers targets={save.data.targets} />
        {save.data.targets.notes.length > 0 && (
          <div className="mt-3">
            <TargetNotesList notes={save.data.targets.notes} />
          </div>
        )}
        <Button className="mt-6 w-full" onClick={openApp}>
          Buka Beranda
        </Button>
        <Button variant="secondary" className="mt-2 w-full" onClick={() => setInviting(true)}>
          <Users aria-hidden />
          Ajak teman
        </Button>
      </Page>
    );
  }

  const tooFast = (() => {
    if (weight === null || targetWeight === null || targetWeight >= weight) return null;
    const days = daysBetween(jakartaToday(), form.targetDate);
    if (days < 1) return null;
    const lossKg = weight - targetWeight;
    const rawDeficit = Math.round((lossKg * KCAL_PER_KG_FAT) / days);
    if (rawDeficit <= 1000) return null;
    const feasibleDays = Math.ceil((lossKg * KCAL_PER_KG_FAT) / 1000);
    return { days, lossKg, rawDeficit, feasibleDays };
  })();

  return (
    <Page className="max-w-xl">
      <header className="pt-2">
        <div className="flex items-center justify-between px-1">
          <img src="/brand/logo-mark.svg" alt="" className="h-7 w-auto" />
          <p className="text-xs font-semibold text-muted-foreground tabular-nums">
            {step}/{STEP_COUNT}
          </p>
        </div>
        <div
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={STEP_COUNT}
          aria-valuenow={step}
          aria-label={`Langkah ${step} dari ${STEP_COUNT}`}
          className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
            style={{ width: `${(step / STEP_COUNT) * 100}%` }}
          />
        </div>
      </header>

      <div className="mt-10">
        <h1 className="text-[1.75rem] leading-tight font-extrabold tracking-tight">
          {QUESTION_TITLE[step]}
        </h1>
        {QUESTION_HINT[step] && (
          <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {QUESTION_HINT[step]}
          </p>
        )}

        <div className="mt-8">
          {step === 1 && (
            <div className="relative">
              <Input
                id="birth-year"
                aria-label="Tahun lahir"
                autoFocus
                type="number"
                inputMode="numeric"
                min="1930"
                max="2020"
                value={form.birthYear}
                onChange={(event) => set({ birthYear: event.target.value })}
                className="h-16 pr-14 text-center text-3xl font-extrabold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="pointer-events-none absolute top-1/2 right-5 -translate-y-1/2 text-base font-semibold text-muted-foreground">
                tahun
              </span>
            </div>
          )}

          {step === 2 && (
            <div className="grid grid-cols-2 gap-3">
              <ChoiceTile active={form.gender === "male"} onClick={() => set({ gender: "male" })}>
                Pria
              </ChoiceTile>
              <ChoiceTile
                active={form.gender === "female"}
                onClick={() => set({ gender: "female" })}
              >
                Wanita
              </ChoiceTile>
            </div>
          )}

          {step === 3 && (
            <BigNumberField
              id="height"
              label="Tinggi (cm)"
              value={form.heightCm}
              onValueChange={(value) => set({ heightCm: value })}
              unit="cm"
            />
          )}

          {step === 4 && (
            <BigNumberField
              id="weight-now"
              label="Berat saat ini (kg)"
              value={form.weightKg}
              onValueChange={(value) => set({ weightKg: value })}
              unit="kg"
              step="0.1"
            />
          )}

          {step === 5 && (
            <div className="grid grid-cols-3 gap-3">
              {(Object.entries(ACTIVITY_LABELS) as Array<[ActivityLevel, string]>).map(
                ([key, label]) => (
                  <ChoiceTile
                    key={key}
                    active={form.activityLevel === key}
                    onClick={() => set({ activityLevel: key })}
                  >
                    {label}
                  </ChoiceTile>
                ),
              )}
            </div>
          )}

          {step === 6 && (
            <div className="space-y-3">
              <BigNumberField
                id="target-weight"
                label="Berat target (kg)"
                value={form.targetWeightKg}
                onValueChange={(value) => set({ targetWeightKg: value })}
                unit="kg"
                step="0.1"
              />
              {ideal && (
                <p className="text-sm text-muted-foreground tabular-nums">
                  Berat sehat untuk tinggimu: {fmtKg(ideal.minKg)}–{fmtKg(ideal.maxKg)} kg
                </p>
              )}
              {ideal && targetWeight !== null && targetWeight < ideal.minKg && (
                <p className="text-sm leading-relaxed text-destructive">
                  Target di bawah rentang berat sehat. Boleh dilanjutkan, tapi perhatikan
                  kesehatanmu.
                </p>
              )}
            </div>
          )}

          {step === 7 && (
            <div className="space-y-3">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    id="target-date"
                    variant="secondary"
                    className="h-16 w-full justify-center rounded-xl text-lg font-extrabold tracking-tight"
                  >
                    <CalendarDays className="size-5 text-muted-foreground" aria-hidden />
                    {fmtDateIndo(form.targetDate).replace(/^\w+, /, "")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={new Date(`${form.targetDate}T00:00:00`)}
                    defaultMonth={new Date(`${form.targetDate}T00:00:00`)}
                    disabled={{ before: new Date() }}
                    onSelect={(day) => {
                      if (day) {
                        set({
                          targetDate: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`,
                        });
                      }
                    }}
                  />
                </PopoverContent>
              </Popover>

              {tooFast && (
                <div className="rounded-2xl bg-bakar-soft p-4">
                  <p className="flex items-start gap-1.5 text-sm leading-snug font-bold text-bakar-ink">
                    <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    Target ini menuntut defisit ~{fmtInt(tooFast.rawDeficit)} kkal/hari, di atas
                    batas aman.
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    JoyoRogo membatasi defisit pada ~1.000 kkal/hari. Turun {fmtKg(tooFast.lossKg)}{" "}
                    kg dengan ritme itu butuh sekitar {tooFast.feasibleDays} hari (±{" "}
                    {fmtKg(Math.round(((1000 * tooFast.days) / KCAL_PER_KG_FAT) * 10) / 10)} kg saja
                    sampai {form.targetDate}).
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="mt-3"
                    onClick={() => set({ targetDate: jakartaDatePlusDays(tooFast.feasibleDays) })}
                  >
                    Pakai tanggal realistis (+{tooFast.feasibleDays} hari)
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-4 text-sm font-semibold text-destructive">
            {error}
          </p>
        )}
      </div>

      <div className="mt-10 flex items-center gap-3">
        {step > 1 && (
          <Button variant="secondary" onClick={back} disabled={save.isPending}>
            <ArrowLeft className="size-[1.125rem]" aria-hidden />
            Kembali
          </Button>
        )}
        <Button className="flex-1" onClick={next} disabled={save.isPending}>
          {step === 7 ? (save.isPending ? "Menyimpan..." : "Simpan & lihat hasil") : "Lanjut"}
        </Button>
      </div>
    </Page>
  );
}

function OnboardingSkeleton() {
  return (
    <Page className="max-w-xl" aria-busy="true" aria-label="Memeriksa profil">
      <div className="flex items-center justify-between px-1 pt-2">
        <Skeleton className="h-7 w-28 rounded-full" />
        <Skeleton className="h-4 w-10 rounded-full" />
      </div>
      <Skeleton className="mt-4 h-1.5 rounded-full" />
      <div className="mt-10 px-1">
        <Skeleton className="h-8 w-64 rounded-full" />
        <Skeleton className="mt-2 h-4 w-52 rounded-full" />
      </div>
      <Skeleton className="mt-8 h-16 rounded-xl" />
      <div className="mt-10 flex gap-3">
        <Skeleton className="h-12 flex-1 rounded-full" />
      </div>
    </Page>
  );
}
