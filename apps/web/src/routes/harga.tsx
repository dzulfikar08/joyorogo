import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CalendarX,
  Check,
  ChevronDown,
  Landmark,
  QrCode,
  X,
} from "lucide-react";

import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";

import { PublicFooter } from "@/components/public-footer";
import { PublicHeader } from "@/components/public-header";
import { FounderPromo } from "@/components/founder-promo";
import { ProgressBar } from "@/components/progress-bar";
import { fmtRupiah, founderScans, useAppConfig } from "@/lib/app-config";
import type { AppConfig } from "@/lib/app-config";
import { useFounderCheckout } from "@/lib/billing";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/harga")({
  component: HargaPage,
  head: () => pageHead("/harga"),
});

/**
 * Features that are NOT gated (verified: the only paywall in the API is the
 * daily AI scan quota in packages/api ai.ts). Every package gets these.
 */
function sharedFeatures(config: AppConfig): string[] {
  return [
    "Diary makan, olahraga, berat, dan tidur",
    "Tren berat + perkiraan tanggal sampai target",
    "Lingkar perut + rasio perut terhadap tinggi",
    "Grup: colek, catatan, VAR perut",
    "Latihan beban",
    "Tanpa iklan",
  ];
}

/** Founder-only extras besides the scan quota. */
function founderFeatures(config: AppConfig): string[] {
  return [founderScans(config), "Badge founder di profilmu", "Harga terkunci saat perpanjang"];
}

function TierCard({
  name,
  price,
  per,
  sub,
  badge,
  highlight,
  features,
  cta,
}: {
  name: string;
  price: string;
  per: string;
  /** Small line under the price, e.g. the yearly per-month equivalent. */
  sub?: string;
  badge?: string;
  highlight?: boolean;
  features: string[];
  cta: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex flex-col rounded-3xl p-6",
        highlight ? "bg-makan-soft" : "bg-card",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          className={cn(
            "text-base font-bold tracking-tight",
            highlight && "text-makan-ink",
          )}
        >
          {name}
        </h2>
        {badge && (
          <span
            className={cn(
              "inline-flex h-6 items-center rounded-full px-2.5 text-xs font-bold",
              highlight ? "bg-card text-makan-ink" : "bg-muted text-muted-foreground",
            )}
          >
            {badge}
          </span>
        )}
      </div>
      <p className="mt-3 text-4xl font-extrabold tracking-tight tabular-nums">{price}</p>
      <p className="mt-1 text-sm text-muted-foreground">{per}</p>
      {sub && <p className="mt-0.5 text-xs font-semibold text-makan-ink">{sub}</p>}
      <ul className="mt-5 space-y-2.5">
        {features.map((feature) => (
          <li key={feature} className="flex gap-2.5 text-sm leading-relaxed">
            <Check
              className={cn("mt-0.5 size-4 shrink-0", highlight ? "text-makan-ink" : "text-primary")}
              aria-hidden
            />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-6">{cta}</div>
    </section>
  );
}

/** One comparison row: feature, free value, founder value. String = quota text. */
function CompareRow({
  feature,
  free,
  founder,
}: {
  feature: string;
  free: string | boolean;
  founder: string | boolean;
}) {
  return (
    <tr className="border-t border-border/70">
      <th scope="row" className="px-4 py-3 text-left text-sm font-medium md:px-6">
        {feature}
      </th>
      <td className="px-2 py-3 text-center">
        {typeof free === "string" ? (
          <span className="text-sm font-bold tabular-nums">
            {free}
            <span className="sr-only"> per hari</span>
          </span>
        ) : free ? (
          <>
            <Check className="mx-auto size-4 text-primary" aria-hidden />
            <span className="sr-only">Termasuk</span>
          </>
        ) : (
          <>
            <X className="mx-auto size-4 text-muted-foreground/50" aria-hidden />
            <span className="sr-only">Tidak termasuk</span>
          </>
        )}
      </td>
      <td className="px-2 py-3 text-center">
        {typeof founder === "string" ? (
          <span className="text-sm font-bold tabular-nums">
            {founder}
            <span className="sr-only"> per hari</span>
          </span>
        ) : founder ? (
          <>
            <Check className="mx-auto size-4 text-primary" aria-hidden />
            <span className="sr-only">Termasuk</span>
          </>
        ) : (
          <>
            <X className="mx-auto size-4 text-muted-foreground/50" aria-hidden />
            <span className="sr-only">Tidak termasuk</span>
          </>
        )}
      </td>
    </tr>
  );
}

/** Pricing FAQ; numbers follow the live config. */
function pricingFaq(config: AppConfig): Array<{ q: string; a: string }> {
  const perMonthYearly = Math.round(config.founderYearlyPriceIdr / 12);
  const paidMonths = Math.round(config.founderYearlyPriceIdr / config.founderPriceIdr);
  return [
    {
      q: "Gratisnya sampai kapan?",
      a: `Selamanya. Diary, tren berat, lingkar perut, grup, dan latihan bebas dipakai tanpa bayar. Yang dibatasi cuma scan AI: ${config.freeDailyScans} foto atau cerita per hari.`,
    },
    {
      q: "Apakah ini langganan otomatis?",
      a: "Tidak. Satu pembayaran aktif selama periode yang kamu beli. Tidak ada kartu yang disimpan dan tidak ada tagihan mengikuti; perpanjang manual dari Profil kalau masih mau.",
    },
    {
      q: "Hargaku ikut naik kalau daftar harga naik?",
      a: `Tidak. Harga terkunci di harga terendah yang pernah kamu bayar. Mulai ${fmtRupiah(config.founderPriceIdr)}/bulan sekarang, dan perpanjangan tetap bayar harga itu walaupun harga penuh sudah naik.`,
    },
    {
      q: "Kalau beli lagi sebelum masa aktif habis?",
      a: "Bulannya menumpuk: pembelian baru dihitung dari hari masa aktifmu berakhir, bukan dari hari beli. Sisa hari tidak hangus.",
    },
    {
      q: "Bedanya paket bulanan dan tahunan?",
      a: `Isinya sama. Tahunan ${fmtRupiah(config.founderYearlyPriceIdr)} setara ${fmtRupiah(perMonthYearly)}/bulan — bayar ${paidMonths} bulan untuk 12 bulan penuh. Cocok kalau memang mau jalan panjang.`,
    },
  ];
}

function HargaPage() {
  const config = useAppConfig();
  const checkout = useFounderCheckout("monthly");
  const checkoutYearly = useFounderCheckout("yearly");

  // Sticky mobile CTA only when checkout actually exists on this server.
  const stickyCta = config.data?.paywall === true && config.data.billing === true;

  // Yearly pitch, computed from the live config so an override can't make
  // "hemat 2 bulan" a lie.
  const paidMonths = config.data
    ? Math.round(config.data.founderYearlyPriceIdr / config.data.founderPriceIdr)
    : 12;
  const perMonthYearly = config.data ? Math.round(config.data.founderYearlyPriceIdr / 12) : 0;
  const freeMonths = 12 - paidMonths;
  const yearlyBadge = freeMonths > 0 ? `Hemat ${freeMonths} bulan` : undefined;

  const promo = config.data?.promo ?? null;
  const promoLeft = promo ? promo.slots - promo.taken : 0;

  return (
    <div className="min-h-svh">
      <PublicHeader />
      <main
        className={cn(
          "mx-auto w-full max-w-5xl px-4 pt-10 md:px-6 md:pt-14",
          stickyCta ? "pb-32 sm:pb-16" : "pb-16",
        )}
      >
        <div className="relative">
          {/* Decorative accents from real scans; content stays centered. */}
          <img
            src="/food/nasi.webp"
            alt=""
            width={320}
            height={308}
            loading="lazy"
            decoding="async"
            className="pointer-events-none absolute -left-28 top-4 hidden w-20 rotate-6 lg:block"
          />
          <img
            src="/food/bakso.webp"
            alt=""
            width={320}
            height={275}
            loading="lazy"
            decoding="async"
            className="pointer-events-none absolute -right-32 top-10 hidden w-28 -rotate-6 lg:block"
          />
          <header className="mx-auto max-w-md text-center">
            <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">Harga</h1>
            {config.data?.paywall && (
              <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
                Mulai gratis, selamanya. Founder cuma menambah jatah scan AI untuk hari-hari yang
                butuh lebih dari {config.data.freeDailyScans} kali.
              </p>
            )}
          </header>
        </div>

        {config.data?.paywall && <FounderPromo className="mx-auto mt-8 max-w-xl" />}

        {config.isPending && (
          <div
            className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            aria-busy="true"
            aria-label="Memuat harga"
          >
            <div className="h-72 animate-pulse rounded-3xl bg-card motion-reduce:animate-none" />
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
          <>
            <div className="mt-10 grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.12fr]">
              <TierCard
                name="Gratis"
                price="Rp0"
                per="selalu gratis"
                features={[
                  `${config.data.freeDailyScans} scan AI per hari`,
                  ...sharedFeatures(config.data).slice(0, 2),
                ]}
                cta={
                  <Button variant="secondary" render={<Link to="/login" />}>
                    Mulai gratis
                  </Button>
                }
              />
              <TierCard
                name="Founder Bulanan"
                price={fmtRupiah(config.data.founderPriceIdr)}
                per="per bulan"
                badge={promo ? "Terbatas" : undefined}
                features={founderFeatures(config.data)}
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
              <TierCard
                name="Founder Tahunan"
                price={fmtRupiah(config.data.founderYearlyPriceIdr)}
                per="per tahun"
                sub={perMonthYearly > 0 ? `setara ${fmtRupiah(perMonthYearly)}/bulan` : undefined}
                badge={yearlyBadge}
                highlight
                features={[
                  ...founderFeatures(config.data),
                  paidMonths < 12
                    ? `Bayar ${paidMonths} bulan, aktif 12 bulan`
                    : "12 bulan sekaligus",
                ]}
                cta={
                  config.data.billing ? (
                    <Button
                      disabled={checkoutYearly.isPending}
                      onClick={() => checkoutYearly.mutate()}
                    >
                      {checkoutYearly.isPending ? "Membuka pembayaran..." : "Ambil paket tahunan"}
                    </Button>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Pembayaran belum dibuka di server ini.
                    </p>
                  )
                }
              />
            </div>

            {/* The honest core of this page: the quota is the only difference. */}
            <p className="mx-auto mt-6 max-w-xl text-center text-sm leading-relaxed text-muted-foreground">
              Yang dibedakan cuma jatah scan AI per hari. Diary, tren berat, lingkar perut, grup,
              dan latihan bebas dipakai di semua paket.
            </p>
          </>
        )}

        {(checkout.isError || checkoutYearly.isError) && (
          <p
            role="alert"
            className="mt-4 rounded-2xl bg-card p-4 text-center text-sm text-muted-foreground"
          >
            {checkout.error?.message ?? checkoutYearly.error?.message}
          </p>
        )}

        {config.data?.paywall && promo && promo.nextPriceIdr != null && (
          <section aria-label="Daftar harga perkenalan" className="mt-14 md:mt-16">
            <div className="max-w-xl">
              <h2 className="text-2xl font-extrabold tracking-tight text-balance md:text-3xl">
                Harga perkenalan naik tiap beberapa pembeli
              </h2>
              <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
                Makin awal ikut, makin murah. Dan harga yang kamu bayar pertama kali itu terkunci:
                perpanjangan tetap seharga itu walaupun daftarnya sudah jauh naik.
              </p>
            </div>
            <ol className="mt-8 grid gap-4 md:grid-cols-2">
              <li className="rounded-3xl bg-makan-soft p-6">
                <p className="flex items-center gap-2">
                  <span className="inline-flex h-6 items-center rounded-full bg-card px-2.5 text-xs font-bold text-makan-ink">
                    Sekarang
                  </span>
                  <span className="text-xs font-semibold text-makan-ink">
                    untuk {promo.slots} pembeli pertama
                  </span>
                </p>
                <p className="mt-3 text-3xl font-extrabold tracking-tight tabular-nums text-makan-ink">
                  {fmtRupiah(config.data.founderPriceIdr)}
                  <span className="ml-1 text-base font-semibold text-muted-foreground">/bulan</span>
                </p>
                <ProgressBar
                  value={promo.taken}
                  max={promo.slots}
                  ariaLabel={`${promoLeft} dari ${promo.slots} slot harga ini tersisa`}
                  className="mt-4 h-1.5"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Sisa <span className="font-bold tabular-nums text-foreground">{promoLeft}</span>{" "}
                  slot di harga ini.
                </p>
              </li>
              <li className="rounded-3xl bg-card p-6">
                <p>
                  <span className="inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-xs font-bold text-muted-foreground">
                    Berikutnya
                  </span>
                </p>
                <p className="mt-3 text-3xl font-extrabold tracking-tight tabular-nums text-muted-foreground">
                  {fmtRupiah(promo.nextPriceIdr)}
                  <span className="ml-1 text-base font-semibold text-muted-foreground">/bulan</span>
                </p>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  Berlaku untuk pembeli setelah slot sekarang penuh. Yang sudah ikut tetap di harga
                  lamanya.
                </p>
              </li>
            </ol>
          </section>
        )}

        {config.data?.paywall && (
          <section aria-label="Perbandingan paket" className="mt-14 md:mt-16">
            <h2 className="text-2xl font-extrabold tracking-tight md:text-3xl">
              Isi tiap paket
            </h2>
            <div className="mt-6 overflow-hidden rounded-3xl bg-card">
              <table className="w-full border-separate border-spacing-0">
                <caption className="sr-only">
                  Perbandingan fitur paket Gratis dan Founder
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="px-4 pb-2 pt-4 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground md:px-6">
                      Fitur
                    </th>
                    <th scope="col" className="px-2 pb-2 pt-4 text-center text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Gratis
                    </th>
                    <th scope="col" className="px-2 pb-2 pt-4 text-center text-xs font-bold uppercase tracking-wide text-makan-ink">
                      Founder
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <CompareRow
                    feature="Scan AI dari foto & cerita"
                    free={`${config.data.freeDailyScans}/hari`}
                    founder={
                      config.data.founderDailyCap === null
                        ? "Tanpa batas"
                        : `${config.data.founderDailyCap}/hari`
                    }
                  />
                  {sharedFeatures(config.data).map((feature) => (
                    <CompareRow key={feature} feature={feature} free founder />
                  ))}
                  <CompareRow feature="Badge founder di profil" free={false} founder />
                </tbody>
              </table>
            </div>
          </section>
        )}

        {config.data?.billing && config.data.paywall && (
          <section aria-label="Cara bayar" className="mt-14 md:mt-16">
            <div className="max-w-xl">
              <h2 className="text-2xl font-extrabold tracking-tight md:text-3xl">Cara bayar</h2>
              <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
                Sekali bayar per periode di halaman pembayaran. Tidak ada langganan otomatis, jadi
                tidak ada tagihan yang muncul sendiri.
              </p>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {[
                {
                  icon: QrCode,
                  title: "QRIS",
                  body: "Scan dari aplikasi bank atau e-wallet mana pun.",
                },
                {
                  icon: Landmark,
                  title: "Transfer bank",
                  body: "Nomor virtual account muncul di halaman pembayaran.",
                },
                {
                  icon: CalendarX,
                  title: "Tanpa perpanjang otomatis",
                  body: "Aktif sampai periode habis; lanjutkan manual dari Profil.",
                },
              ].map((item) => (
                <div key={item.title} className="rounded-3xl bg-card p-6">
                  <span className="flex size-10 items-center justify-center rounded-full bg-makan-soft text-makan-ink">
                    <item.icon className="size-5" aria-hidden />
                  </span>
                  <p className="mt-4 font-bold">{item.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
                </div>
              ))}
            </div>
            <ul className="mt-6 space-y-2 text-sm leading-relaxed text-muted-foreground">
              <li className="flex gap-2.5">
                <span aria-hidden className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
                Beli lagi sebelum masa aktif habis? Bulannya menumpuk di atas sisa periode — sisa
                hari tidak hangus.
              </li>
              <li className="flex gap-2.5">
                <span aria-hidden className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
                Harga Founder terkunci di harga pertama kali kamu bayar, termasuk saat perpanjang.
              </li>
            </ul>
          </section>
        )}

        {config.data?.paywall && (
          <section aria-label="Pertanyaan soal harga" className="mx-auto mt-14 max-w-3xl md:mt-16">
            <h2 className="text-2xl font-extrabold tracking-tight md:text-3xl">
              Pertanyaan soal harga
            </h2>
            <div className="mt-6 divide-y divide-border/70 rounded-3xl bg-card">
              {pricingFaq(config.data).map((item) => (
                <details key={item.q} className="group px-5 md:px-6">
                  <summary className="-mx-2 flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-2 py-4 text-[1.0625rem] font-bold focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <ChevronDown
                      className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
                      aria-hidden
                    />
                  </summary>
                  <p className="pb-5 text-[0.9375rem] leading-relaxed text-muted-foreground">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </section>
        )}
      </main>

      {stickyCta && config.data && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-muted-foreground">Founder bulanan</p>
              <p className="text-sm font-extrabold tabular-nums">
                {fmtRupiah(config.data.founderPriceIdr)}
                <span className="font-semibold text-muted-foreground">/bulan</span>
              </p>
            </div>
            <Button
              className="ml-auto shrink-0"
              disabled={checkout.isPending}
              onClick={() => checkout.mutate()}
            >
              {checkout.isPending ? "Membuka..." : "Jadi Founder"}
            </Button>
          </div>
        </div>
      )}

      <PublicFooter />
    </div>
  );
}
