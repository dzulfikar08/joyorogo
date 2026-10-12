import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";

import { Button } from "@joyorogo/ui/components/button";

import { PublicHeader } from "@/components/public-header";
import { fmtRupiah, useAppConfig } from "@/lib/app-config";
import type { AppConfig } from "@/lib/app-config";
import { useFounderCheckout } from "@/lib/billing";

export const Route = createFileRoute("/harga")({
  component: HargaPage,
});

const FOUNDER_FEATURES = [
  "Scan AI tanpa batas",
  "Badge founder di profilmu",
  "Dukung pengembangan JoyoRogo",
] as const;

function freeFeatures(config: AppConfig): string[] {
  return [
    `${config.freeDailyScans} scan AI per hari`,
    "Diary penuh gratis selamanya: makan, olahraga, berat, tidur",
  ];
}

function TierCard({
  name,
  price,
  per,
  badge,
  features,
  cta,
}: {
  name: string;
  price: string;
  per: string;
  badge?: string;
  features: readonly string[];
  cta: React.ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-3xl bg-card p-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold tracking-tight">{name}</h2>
        {badge && (
          <span className="inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-xs font-bold text-muted-foreground">
            {badge}
          </span>
        )}
      </div>
      <p className="mt-3 text-4xl font-extrabold tracking-tight tabular-nums">{price}</p>
      <p className="mt-1 text-sm text-muted-foreground">{per}</p>
      <ul className="mt-5 space-y-2.5">
        {features.map((feature) => (
          <li key={feature} className="flex gap-2.5 text-sm leading-relaxed">
            <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <div className="mt-6">{cta}</div>
    </section>
  );
}

function HargaPage() {
  const config = useAppConfig();
  const checkout = useFounderCheckout();

  return (
    <div className="min-h-svh">
      <PublicHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-10 md:px-6 md:py-14">
        <header className="mx-auto max-w-md text-center">
          <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">Harga</h1>
          {config.data?.paywall && (
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
              Mulai gratis. Naik ke Founder kalau kamu butuh scan AI lebih dari{" "}
              {config.data.freeDailyScans} kali sehari.
            </p>
          )}
        </header>

        {config.isPending && (
          <div
            className="mt-10 grid gap-4 sm:grid-cols-2"
            aria-busy="true"
            aria-label="Memuat harga"
          >
            <div className="h-72 animate-pulse rounded-3xl bg-card motion-reduce:animate-none" />
            <div className="h-72 animate-pulse rounded-3xl bg-card motion-reduce:animate-none" />
          </div>
        )}

        {config.isError && (
          <div role="alert" className="mt-10 rounded-3xl bg-card p-6 text-center">
            <p className="font-bold">Harga belum bisa dimuat.</p>
            <Button className="mt-4" variant="secondary" onClick={() => config.refetch()}>
              Coba lagi
            </Button>
          </div>
        )}

        {config.data && !config.data.paywall && (
          <section className="mt-10 rounded-3xl bg-card p-6 text-center">
            <p className="text-lg font-extrabold tracking-tight">
              Semua fitur gratis di server ini
            </p>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Scan AI tanpa batas harian, plus diary, grafik berat, dan rencana harianmu.
            </p>
            <Button className="mt-5" render={<Link to="/login" />}>
              Mulai
            </Button>
          </section>
        )}

        {config.data?.paywall && (
          <div className="mt-10 grid items-start gap-4 sm:grid-cols-2">
            <TierCard
              name="Gratis"
              price="Rp0"
              per="selalu gratis"
              features={freeFeatures(config.data)}
              cta={
                <Button variant="secondary" render={<Link to="/login" />}>
                  Mulai gratis
                </Button>
              }
            />
            <TierCard
              name="Founder"
              price={fmtRupiah(config.data.founderPriceIdr)}
              per="per bulan"
              badge="Terbatas"
              features={FOUNDER_FEATURES}
              cta={
                config.data.billing ? (
                  <Button disabled={checkout.isPending} onClick={() => checkout.mutate()}>
                    {checkout.isPending ? "Membuka pembayaran..." : "Jadi Founder"}
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Pembayaran belum dibuka di server ini.
                  </p>
                )
              }
            />
          </div>
        )}

        {checkout.isError && (
          <p
            role="alert"
            className="mt-4 rounded-2xl bg-card p-4 text-center text-sm text-muted-foreground"
          >
            {checkout.error.message}
          </p>
        )}

        {config.data?.billing && (
          <p className="mt-10 text-center text-xs leading-relaxed text-muted-foreground">
            Bayar lewat QRIS, transfer bank, atau e-wallet di halaman DOKU. Tidak diperpanjang
            otomatis: perpanjang sendiri kapan saja dari profil.
          </p>
        )}
      </main>
    </div>
  );
}
