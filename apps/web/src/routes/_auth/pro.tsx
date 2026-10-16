import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { Check, CircleHelp } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@joyorogo/ui/components/button";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useCheckoutPicker } from "@/components/checkout-picker";
import { Mascot } from "@/components/mascot";
import { FounderPromo } from "@/components/founder-promo";
import { Page, Segmented } from "@/components/kit/surface";
import { ScreenError } from "@/components/screen-state";
import { fmtRupiah, founderScans, useAppConfig } from "@/lib/app-config";
import { validatePaywallSearch } from "@/lib/billing";
import type { CheckoutPlan, PaywallFrom } from "@/lib/billing";
import { orpc } from "@/utils/orpc";

const profileOptions = orpc.profile.myProfile.queryOptions();

/** Skippable Pro offer; `next` is where "Nanti saja" and redirects land. */
export const Route = createFileRoute("/_auth/pro")({
  validateSearch: validatePaywallSearch,
  loader: ({ context }) => context.queryClient.ensureQueryData(profileOptions),
  pendingComponent: FounderSkeleton,
  component: FounderPage,
});

const SUBHEAD: Record<PaywallFrom, string> = {
  onboarding: "Rencana harianmu sudah siap. Pro dapat scan AI jauh lebih banyak setiap hari.",
  quota: "Jatah scan AI gratis hari ini sudah habis. Jadi Pro untuk lanjut scan sekarang.",
  banner: "Scan AI gratis terbatas setiap hari. Pro dapat jatah yang jauh lebih besar.",
  profile: "Dukung pengembangan JoyoRogo dan dapatkan jatah scan AI yang jauh lebih besar.",
  fitness: "Dapat saran porsi dan menu harian dari skor JoyoFit, targetmu, dan makanan yang kamu catat.",
  challenge: "Pro yang membuat tantangan grup. Kamu tetap bisa ikut tantangan temanmu gratis.",
  joyofit: "Cadangan cloud JoyoFit termasuk di Pro, satu paket dengan JoyoRogo.",
};

/** "Cara bayar" — users keep asking how payment actually works. */
const PAY_STEPS = [
  'Ketuk "Jadi Pro" di bawah.',
  "Pilih QRIS atau Transfer Bank, lalu bayar.",
  "Pro aktif otomatis setelah pembayaran.",
] as const;

function FounderPage() {
  const navigate = useNavigate();
  const { next, from } = Route.useSearch();
  const config = useAppConfig();
  const profile = useQuery(profileOptions);
  const [plan, setPlan] = useState<CheckoutPlan>("yearly");
  const checkout = useCheckoutPicker(plan);

  if (config.isError) {
    return <ScreenError message="Harga belum bisa dimuat." onRetry={() => void config.refetch()} />;
  }
  if (!config.data) return <FounderSkeleton />;

  const destination = next ?? "/beranda";
  // Nothing to sell here (billing off) or nothing left to buy (sudah Pro):
  // continue straight away, no flash of the offer.
  if (!config.data.billing || profile.data?.tier === "founder") {
    return <Navigate to={destination} replace />;
  }

  const standardMonthly = config.data.promo?.nextPriceIdr ?? config.data.founderPriceIdr;
  const yearlySaving = standardMonthly * 12 - config.data.founderYearlyPriceIdr;

  return (
    <Page className="max-w-md">
      <FounderPromo className="mb-3" />
      <section aria-labelledby="founder-title" className="rounded-3xl bg-card p-6">
        <Mascot
          pose={from === "quota" ? "sleepy" : "happy"}
          size="md"
          eager
          className="mx-0 mb-4"
        />
        <h1 id="founder-title" className="text-2xl font-extrabold tracking-tight">
          Jadi Pro
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {SUBHEAD[from ?? "banner"]}
        </p>
        <p className="mt-2 text-sm font-semibold leading-relaxed">
          Pro mencakup JoyoRogo + JoyoFit.
        </p>
        <Segmented
          label="Pilih masa Pro"
          className="mt-5"
          value={plan}
          onChange={setPlan}
          options={[
            {
              value: "yearly",
              label: (
                <>
                  Tahunan{" "}
                  {yearlySaving > 0 && (
                    <span className="text-xs font-bold text-primary">
                      hemat {fmtRupiah(yearlySaving)}
                    </span>
                  )}
                </>
              ),
            },
            { value: "monthly", label: "Bulanan" },
          ]}
        />
        <p className="mt-4 text-3xl font-extrabold tracking-tight tabular-nums">
          {fmtRupiah(
            plan === "monthly" ? config.data.founderPriceIdr : config.data.founderYearlyPriceIdr,
          )}
          <span className="text-sm font-semibold text-muted-foreground">
            {" "}
            {plan === "monthly" ? "/bulan" : "/tahun"}
          </span>
        </p>
        {plan === "yearly" && (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Setara {fmtRupiah(Math.round(config.data.founderYearlyPriceIdr / 12))}/bulan, aktif 12
            bulan. Menumpuk di sisa masa Pro-mu.
          </p>
        )}
        <ul className="mt-5 space-y-2.5">
          {[
            founderScans(config.data),
            "Saran makan dari skor JoyoFit",
            "Cadangan cloud JoyoFit: langkah, detak jantung, tidur, dan latihan dari jam",
            "Badge Pro di profilmu",
            "Dukung pengembangan JoyoRogo",
          ].map((feature) => (
            <li key={feature} className="flex gap-2.5 text-sm leading-relaxed">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 rounded-2xl bg-muted px-4 py-3 text-sm leading-relaxed text-muted-foreground">
          Gratis tetap ada: {config.data.freeDailyScans} scan AI per hari, selamanya.
        </p>

        <Button
          className="mt-5 w-full"
          disabled={checkout.isPending}
          onClick={() => checkout.start((error) => toast.error(error.message))}
        >
          {checkout.isPending ? "Membuka pembayaran..." : "Jadi Pro"}
        </Button>
        {checkout.sheet}
        <Button
          variant="secondary"
          className="mt-2 w-full"
          onClick={() => navigate({ to: destination, replace: true })}
        >
          Nanti saja
        </Button>
        <p className="mt-3 flex items-start gap-1.5 px-1 text-xs leading-relaxed text-muted-foreground">
          <CircleHelp className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>Kamu bisa jadi Pro kapan saja dari Profil.</span>
        </p>

        <div className="mt-5 rounded-2xl bg-muted px-4 py-4">
          <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
            Cara bayar
          </p>
          <ol className="mt-2 space-y-2">
            {PAY_STEPS.map((step, index) => (
              <li key={step} className="flex gap-2.5 text-sm leading-relaxed">
                <span
                  aria-hidden
                  className="flex size-5 shrink-0 items-center justify-center rounded-full bg-card text-xs font-bold tabular-nums"
                >
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
        <p className="mt-3 px-1 text-xs text-muted-foreground">Tidak diperpanjang otomatis.</p>
      </section>
    </Page>
  );
}

function FounderSkeleton() {
  return (
    <Page className="max-w-md">
      <div
        className="rounded-3xl bg-card p-6"
        aria-busy="true"
        aria-label="Memuat penawaran Pro"
      >
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="mt-4 h-8 w-44" />
        <Skeleton className="mt-2 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-3/4" />
        <Skeleton className="mt-6 h-9 w-36" />
        <div className="mt-5 space-y-2.5">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-3/4" />
        </div>
        <Skeleton className="mt-5 h-12 w-full rounded-full" />
        <Skeleton className="mt-2 h-12 w-full rounded-full" />
      </div>
    </Page>
  );
}
