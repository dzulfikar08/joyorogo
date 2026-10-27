import { createFileRoute } from "@tanstack/react-router";

import { AppLink } from "@/components/app-link";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CalendarX,
  Check,
  ChevronDown,
  Landmark,
  QrCode,
  X,
} from "lucide-react";

import { PRIORITY_SUPPORT, PRO_BENEFIT_GROUPS } from "@joyorogo/i18n";

import { AppDownload } from "@/components/app-download";
import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";

import { useCheckoutPicker } from "@/components/checkout-picker";
import { PublicFooter } from "@/components/public-footer";
import { PublicHeader } from "@/components/public-header";
import { UsdPlans } from "@/components/usd-plans";
import { useProBenefits } from "@/components/pro-benefits";
import type { ProBenefitsText } from "@/components/pro-benefits";
import { FounderPromo } from "@/components/founder-promo";
import { ProgressBar } from "@/components/progress-bar";
import { fmtRupiah, fmtUsd, useAppConfig } from "@/lib/app-config";
import type { AppConfig } from "@/lib/app-config";
import { CONTACT_EMAIL } from "@/lib/contact";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/harga")({
  component: HargaPage,
  head: () => pageHead("/harga"),
});

/**
 * What every package gets, because no server gate checks it. The Pro side is `PRO_BENEFIT_GROUPS`
 * (packages/i18n/src/pro-benefits.ts), where each item names the gate in packages/api that enforces it; docs/pricing.md
 * ("What Pro unlocks") lists the same gates. Keep both lists in step with the code, not with the marketing.
 */
function sharedFeatures(): string[] {
  return [
    "Diary makan, olahraga, berat, dan tidur",
    "Tren berat + perkiraan tanggal sampai target",
    "Lingkar perut + rasio perut terhadap tinggi",
    "Grup: colek, catatan, VAR perut",
    "Ikut tantangan grup temanmu",
    "Latihan beban",
    "Tanpa iklan",
  ];
}

/** The short Pro list on the plan cards; the full grouped list is the comparison table below them. */
function founderFeatures(
  config: AppConfig,
  benefits: ProBenefitsText,
): string[] {
  return [
    benefits.text("scans", config.founderDailyCap),
    benefits.t("pro.cardSummary"),
    benefits.text("support", config.founderDailyCap),
    "Harga terkunci saat perpanjang (pembayaran web)",
  ];
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
        "card-lift flex flex-col rounded-3xl p-6",
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

/** A group heading inside the comparison table. */
function GroupRow({ title }: { title: string }) {
  return (
    <tr className="border-t border-border/70">
      <th
        scope="colgroup"
        colSpan={3}
        className="bg-muted/40 px-4 py-2 text-left text-xs font-bold tracking-wide text-muted-foreground uppercase md:px-6"
      >
        {title}
      </th>
    </tr>
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
  const standardMonthly = config.promo?.nextPriceIdr ?? config.founderPriceIdr;
  const saving = standardMonthly * 12 - config.founderYearlyPriceIdr;
  return [
    {
      q: "Gratisnya sampai kapan?",
      a: `Selamanya. Diary, tren berat, lingkar perut, grup, ikut tantangan teman, dan latihan bebas dipakai tanpa bayar, dengan ${config.freeDailyScans} scan AI (foto atau cerita) per hari. Pro menambah jatah scan, fitur AI, rencana makan, cadangan cloud JoyoFit, tantangan grup buatanmu sendiri, dan dukungan prioritas; daftar lengkapnya ada di tabel "Isi tiap paket". JoyoFit sendiri tetap gratis dipakai di HP, tanpa akun.`,
    },
    {
      q: "Seperti apa dukungan prioritas?",
      a: `Untuk Pro: kirim DM ke ${PRIORITY_SUPPORT.handle} di Threads dan sebutkan email akun JoyoRogo-mu, supaya akunnya bisa dicek. Dibalas paling lambat ${PRIORITY_SUPPORT.replyWorkdays} hari kerja. Pengguna gratis tetap bisa menulis ke ${CONTACT_EMAIL}, tanpa janji waktu balas.`,
    },
    {
      q: "Apakah ini langganan otomatis?",
      a: "Tergantung tempat dan cara kamu membayar. Di web, QRIS atau transfer bank berlaku sekali untuk periode yang kamu beli: tidak ada kartu yang disimpan dan tidak ada tagihan susulan, perpanjang manual dari Profil kalau masih mau. Pembayaran dolar AS dengan kartu (lewat Polar) adalah langganan otomatis: diperpanjang tiap bulan atau tahun sampai kamu membatalkan, dan bisa dibatalkan kapan saja dari Profil atau portal pelanggan Polar. Di aplikasi iPhone, Pro berupa langganan otomatis lewat App Store, dan di aplikasi Android lewat Google Play, dikelola dan dibatalkan di pengaturan Apple atau Google.",
    },
    {
      q: "Bisa bayar dengan dolar?",
      a: "Bisa, kalau pembayaran dolar dibuka di server ini. Pembayaran dalam dolar AS dengan kartu diproses oleh Polar (polar.sh), merchant of record yang menjadi penjual untuk transaksi itu, jadi pajak seperti PPN atau GST bisa ditambahkan di halaman pembayaran. Ini langganan otomatis yang bisa dibatalkan kapan saja. Detailnya ada di Syarat dan Kebijakan pengembalian dana.",
    },
    {
      q: "Hargaku ikut naik kalau daftar harga naik?",
      a: `Tidak. Di pembayaran web, harga terkunci di harga terendah yang pernah kamu bayar. Mulai ${fmtRupiah(config.founderPriceIdr)}/bulan sekarang, dan perpanjangan tetap bayar harga itu walaupun harga penuh sudah naik.`,
    },
    {
      q: "Kalau beli lagi sebelum masa aktif habis?",
      a: "Bulannya menumpuk: pembelian baru dihitung dari hari masa aktifmu berakhir, bukan dari hari beli. Sisa hari tidak hangus.",
    },
    {
      q: "Bedanya paket bulanan dan tahunan?",
      a: `Isinya sama. Tahunan ${fmtRupiah(config.founderYearlyPriceIdr)} setara ${fmtRupiah(perMonthYearly)}/bulan, aktif 12 bulan penuh${saving > 0 ? `, hemat ${fmtRupiah(saving)} dibanding bayar bulanan ${fmtRupiah(standardMonthly)}` : ""}. Cocok kalau memang mau jalan panjang.`,
    },
  ];
}

function HargaPage() {
  const { t } = useTranslation("billing");
  const config = useAppConfig();
  const checkout = useCheckoutPicker("monthly");
  const checkoutYearly = useCheckoutPicker("yearly");
  const [showUsd, setShowUsd] = useState(false);
  const usd = config.data?.usd ?? null;
  // The page is Indonesian whatever the UI language is, so the shared Pro list is pinned to it.
  const benefits = useProBenefits("id");

  // Sticky mobile CTA only when checkout actually exists on this server.
  const stickyCta = config.data?.paywall === true && config.data.billing === true;

  // Yearly pitch from the live config. Savings are measured against the
  // standard monthly price (after the promo), not the limited promo price.
  const standardMonthly = config.data
    ? (config.data.promo?.nextPriceIdr ?? config.data.founderPriceIdr)
    : 0;
  const perMonthYearly = config.data ? Math.round(config.data.founderYearlyPriceIdr / 12) : 0;
  const yearlySaving = config.data ? standardMonthly * 12 - config.data.founderYearlyPriceIdr : 0;
  const yearlyBadge = yearlySaving > 0 ? `Hemat ${fmtRupiah(yearlySaving)}` : undefined;

  const promo = config.data?.promo ?? null;
  const promoLeft = promo ? promo.slots - promo.taken : 0;

  return (
    <div className="marketing min-h-svh">
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
            <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">JoyoRogo Pro</h1>
            {config.data?.paywall && (
              <>
                <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
                  Mulai gratis, selamanya. Pro menambah jatah scan AI di atas {config.data.freeDailyScans}{" "}
                  kali sehari, plus fitur AI, rencana makan, cadangan cloud JoyoFit, tantangan grup, dan
                  dukungan prioritas.
                </p>
                <p className="mt-2 text-[0.9375rem] font-semibold leading-relaxed">
                  Pro mencakup JoyoRogo + JoyoFit.
                </p>
              </>
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
            <Button className="mt-5" render={<AppLink to="/login" />}>
              Mulai
            </Button>
          </section>
        )}

        {config.data?.paywall && (
          <>
            {usd && usd.preferred && (
              <UsdPlans
                usd={usd}
                config={config.data}
                yearly={{ start: () => checkoutYearly.startUsd(), pending: checkoutYearly.isPending }}
                monthly={{ start: () => checkout.startUsd(), pending: checkout.isPending }}
                className="mb-12"
              />
            )}
            {usd && !usd.preferred && (
              <div className="mb-8">
                {showUsd ? (
                  <>
                    <UsdPlans
                      usd={usd}
                      config={config.data}
                      yearly={{
                        start: () => checkoutYearly.startUsd(),
                        pending: checkoutYearly.isPending,
                      }}
                      monthly={{ start: () => checkout.startUsd(), pending: checkout.isPending }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowUsd(false)}
                      lang="en"
                      className="mt-3 inline-flex min-h-11 items-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                    >
                      {t("usd.section.hide", { lng: "en" })}
                    </button>
                  </>
                ) : (
                  <p className="text-center text-sm text-muted-foreground" lang="en">
                    <button
                      type="button"
                      onClick={() => setShowUsd(true)}
                      className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-foreground"
                    >
                      {t("usd.section.outsideLink", { lng: "en" })}
                    </button>
                  </p>
                )}
              </div>
            )}
            <div className="mt-10 grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1.12fr_1fr]">
              <TierCard
                name="Gratis"
                price="Rp0"
                per="selalu gratis"
                features={[
                  `${config.data.freeDailyScans} scan AI per hari`,
                  ...sharedFeatures().slice(0, 2),
                ]}
                cta={
                  <Button variant="secondary" render={<AppLink to="/login" />}>
                    Mulai gratis
                  </Button>
                }
              />
              <TierCard
                name="Pro Tahunan"
                price={fmtRupiah(config.data.founderYearlyPriceIdr)}
                per="per tahun"
                sub={perMonthYearly > 0 ? `setara ${fmtRupiah(perMonthYearly)}/bulan` : undefined}
                badge={yearlyBadge}
                highlight
                features={[
                  ...founderFeatures(config.data, benefits),
                  "Aktif 12 bulan sekaligus",
                ]}
                cta={
                  config.data.billing ? (
                    <Button
                      disabled={checkoutYearly.isPending}
                      onClick={() => checkoutYearly.start()}
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
              <TierCard
                name="Pro Bulanan"
                price={fmtRupiah(config.data.founderPriceIdr)}
                per="per bulan"
                badge={promo ? "Harga perkenalan" : undefined}
                features={founderFeatures(config.data, benefits)}
                cta={
                  config.data.billing ? (
                    <Button disabled={checkout.isPending} onClick={() => checkout.start()}>
                      {checkout.isPending ? "Membuka pembayaran..." : "Jadi Pro"}
                    </Button>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Pembayaran belum dibuka di server ini.
                    </p>
                  )
                }
              />
            </div>

            {/* What differs, said plainly: the grouped list is the comparison table below. */}
            <p className="mx-auto mt-6 max-w-xl text-center text-sm leading-relaxed text-muted-foreground">
              Diary, tren berat, lingkar perut, grup, ikut tantangan teman, dan latihan bebas dipakai
              di semua paket. Pro menambah jatah scan, fitur AI, rencana makan, cadangan cloud
              JoyoFit, tantangan grup buatanmu sendiri, dan dukungan prioritas. Daftar lengkapnya ada
              di tabel di bawah.
            </p>
          </>
        )}

        {(checkout.error ?? checkoutYearly.error) && (
          <p
            role="alert"
            className="mt-4 rounded-2xl bg-card p-4 text-center text-sm text-muted-foreground"
          >
            {(checkout.error ?? checkoutYearly.error)?.message}
          </p>
        )}
        {checkout.sheet}
        {checkoutYearly.sheet}

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
                  Perbandingan fitur paket Gratis dan Pro
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
                      Pro
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sharedFeatures().map((feature) => (
                    <CompareRow key={feature} feature={feature} free founder />
                  ))}
                  {PRO_BENEFIT_GROUPS.map((group) => (
                    <Fragment key={group.id}>
                      <GroupRow title={benefits.groupTitle(group.id)} />
                      {group.items.map((item) =>
                        item === "scans" ? (
                          <CompareRow
                            key={item}
                            feature="Scan AI dari foto & cerita"
                            free={`${config.data.freeDailyScans}/hari`}
                            founder={
                              config.data.founderDailyCap === null
                                ? "Tanpa batas"
                                : `${config.data.founderDailyCap}/hari`
                            }
                          />
                        ) : (
                          <CompareRow
                            key={item}
                            feature={benefits.text(item, config.data.founderDailyCap)}
                            free={false}
                            founder
                          />
                        ),
                      )}
                    </Fragment>
                  ))}
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
                Pembayaran rupiah di web (QRIS atau transfer bank) berlaku sekali per periode:
                tidak ada perpanjangan otomatis, jadi tidak ada tagihan yang muncul sendiri.
                Langganan otomatis hanya ada di pembayaran kartu dolar AS (Polar) dan di aplikasi.
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
                  title: "Rupiah di web: tanpa perpanjang otomatis",
                  body: "Aktif sampai periode habis; lanjutkan manual dari Profil. Kartu dolar AS (Polar) dan aplikasi (App Store, Google Play) berupa langganan otomatis yang bisa dibatalkan kapan saja.",
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
                Harga Pro terkunci di harga pertama kali kamu bayar lewat web, termasuk saat perpanjang.
              </li>
            </ul>
          </section>
        )}

        <section
          aria-label="Pakai di HP"
          className="mx-auto mt-14 flex max-w-3xl flex-col items-start gap-4 rounded-3xl bg-card p-6 md:mt-16 md:p-8"
        >
          <div>
            <h2 className="text-xl font-extrabold tracking-tight md:text-2xl">Pakai di HP-mu</h2>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
              Android: Google Play (tes tertutup, gabung sebagai tester). iPhone: aplikasi
              di App Store, atau web app yang dipasang ke Layar Utama. Akun dan datanya sama di semua perangkat.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <AppDownload location="harga" />
          </div>
        </section>

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
              <p className="text-xs font-semibold text-muted-foreground">Pro bulanan</p>
              <p className="text-sm font-extrabold tabular-nums">
                {usd?.preferred ? fmtUsd(usd.monthlyCents) : fmtRupiah(config.data.founderPriceIdr)}
                <span className="font-semibold text-muted-foreground">
                  {usd?.preferred ? "/month" : "/bulan"}
                </span>
              </p>
            </div>
            <Button
              className="ml-auto shrink-0"
              disabled={checkout.isPending}
              onClick={() => checkout.start()}
            >
              {checkout.isPending ? "Membuka..." : "Jadi Pro"}
            </Button>
          </div>
        </div>
      )}

      <PublicFooter />
    </div>
  );
}
