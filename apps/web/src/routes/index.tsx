import { useQuery } from "@tanstack/react-query";
import { createFileRoute, isRedirect, Link, Navigate, redirect } from "@tanstack/react-router";
import {
  Activity,
  CameraOff,
  Check,
  ChevronDown,
  Download,
  Footprints,
  Hand,
  ListChecks,
  MegaphoneOff,
  NotebookPen,
  PencilLine,
  Radar,
  Trash2,
} from "lucide-react";

import { Button } from "@joyorogo/ui/components/button";
import { Ring, type Metric } from "@/components/kit/ring";
import { ScanDemo } from "@/components/landing/scan-demo";
import { GroupPeek, HeroPhone, ScanExample, WeightTrendDemo } from "@/components/landing/visuals";
import { PublicHeader } from "@/components/public-header";
import { PublicFooter } from "@/components/public-footer";
import { FounderPromo } from "@/components/founder-promo";
import { APK_URL, fmtRupiah, founderScans, useAppConfig } from "@/lib/app-config";
import type { AppConfig } from "@/lib/app-config";
import { sessionQuery } from "@/lib/auth-client";
import { FAQ, pageHead } from "@/lib/seo";
import { CACHE_OWNER_KEY } from "@/utils/orpc";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => pageHead("/"),
  beforeLoad: async ({ context }) => {
    // Someone signed in on this device before: confirm the session (usually
    // straight from the persisted cache) and skip the landing. New visitors
    // must not wait on an API round trip, or retries when it is down, to see
    // the page; the component redirects later if a session turns up anyway.
    if (!localStorage.getItem(CACHE_OWNER_KEY)) return;
    try {
      const session = await context.queryClient.ensureQueryData(sessionQuery);
      if (session) throw redirect({ to: "/beranda" });
    } catch (error) {
      if (isRedirect(error)) throw error;
    }
  },
});

/** Facts the product can back up; no user counts or ratings we don't have. */
const FACTS = [
  { value: "3-9 detik", label: "untuk menghitung satu foto" },
  { value: "Rp0", label: "diary lengkap, selamanya" },
  { value: "0 foto", label: "disimpan tanpa seizinmu" },
  { value: "TKPI 2019", label: "data kalori dari Kemenkes" },
] as const;

const NUMBERS: Array<{
  metric: Metric;
  value: number;
  max: number;
  center: string;
  unit: string;
  title: string;
  body: string;
}> = [
  {
    metric: "makan",
    value: 1240,
    max: 1650,
    center: "1.650",
    unit: "kcal",
    title: "Boleh makan",
    body: "Kebutuhan harianmu dikurangi defisit yang pas untuk target berat dan tanggalmu. Setelah 4 minggu mencatat, angkanya menyesuaikan pembakaran nyata tubuhmu.",
  },
  {
    metric: "bakar",
    value: 120,
    max: 300,
    center: "300",
    unit: "kcal",
    title: "Harus bakar",
    body: "Dari langkah dan olahraga. Di Android terbaca otomatis dari Health Connect, atau sambungkan Strava. Mau catat manual juga bisa.",
  },
  {
    metric: "tidur",
    value: 7.5,
    max: 8,
    center: "8",
    unit: "jam",
    title: "Butuh tidur",
    body: "Target jam tidur setiap malam. Di Android, durasi tidurmu ikut terbaca dari Health Connect.",
  },
];

/** Grup features in the order the app's Grup screen lists them. */
const GROUP_FEATURES = [
  {
    icon: Hand,
    title: "Colek",
    body: "Ada yang dua hari nggak catat? Sekali ketuk, dia dapat pemberitahuan di aplikasinya. Berfungsi dua arah, jadi siap-siap dicolek balik.",
  },
  {
    icon: NotebookPen,
    title: "Catatan",
    body: "Tinggalkan pesan di grup: jangan lupa sarapan, atau gym nanti sore jangan batal.",
  },
  {
    icon: Radar,
    title: "VAR perut",
    body: "Arahkan kamera ke temanmu, dan makanan yang ia catat hari ini muncul melayang di layar, kayak hasil USG.",
  },
] as const;

/** Only promises the code actually keeps (see apps/server/src/anon.ts,
 * db keepPhotos default, Profil delete-all, and the absence of any ad SDK). */
const PROMISES = [
  {
    icon: CameraOff,
    title: "Foto tidak disimpan",
    body: "Foto dianalisis lalu dibuang. Tersimpan hanya kalau kamu yang memilihnya.",
  },
  {
    icon: MegaphoneOff,
    title: "Tanpa iklan",
    body: "Tidak ada iklan dan tidak ada feed tanpa akhir. Catat, tutup, hidupmu lanjut.",
  },
  {
    icon: Trash2,
    title: "Hapus kapan saja",
    body: "Satu tombol di halaman Profil menghapus semua datamu, permanen.",
  },
] as const;

/** Pricing answer follows the server's paywall; omitted until config loads. */
function pricingFaq(config: AppConfig | undefined): Array<{ q: string; a: string }> {
  if (!config) return [];
  if (!config.paywall) {
    return [
      {
        q: "Gratisnya sampai kapan?",
        a: "Di server ini semua fitur gratis, termasuk foto AI tanpa batas harian.",
      },
    ];
  }
  return [
    {
      q: "Gratisnya sampai kapan?",
      a: `Diary makan, olahraga, berat, dan tidur gratis selamanya, dengan ${config.freeDailyScans} foto AI per hari. Founder ${fmtRupiah(config.founderPriceIdr)} per bulan: ${founderScans(config).toLowerCase()}. Paket tahunan ${fmtRupiah(config.founderYearlyPriceIdr)} — setara 10 bulan, hemat 2 bulan.`,
    },
  ];
}

function Landing() {
  const config = useAppConfig();
  // Background check for visitors the beforeLoad gate let through.
  const { data: session } = useQuery(sessionQuery);
  if (session) return <Navigate to="/beranda" replace />;

  return (
    <div className="min-h-svh">
      <PublicHeader />

      <main>
        {/* Hero */}
        <section
          data-section="hero"
          className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pt-8 pb-14 md:grid-cols-[1.05fr_1fr] md:gap-8 md:px-6 md:pt-14 md:pb-20"
        >
          <div>
            <h1 className="max-w-xl text-[2.625rem] leading-[1.04] font-extrabold tracking-tight text-balance md:text-[4rem]">
              Diet yang paham porsi warteg
            </h1>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted-foreground md:text-xl">
              Foto piringmu, kalorinya terhitung dalam beberapa detik. Tiap pagi JoyoRogo kasih
              tiga angka: berapa lagi yang boleh kamu makan, berapa yang perlu dibakar, dan butuh
              tidur berapa jam.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                render={
                  <a
                    href="#coba"
                    data-revklik-goal="try_scan_click"
                    data-revklik-goal-location="hero"
                  />
                }
              >
                Coba gratis
              </Button>
              <Button
                size="lg"
                variant="secondary"
                render={
                  <a
                    href={APK_URL}
                    data-revklik-goal="apk_download"
                    data-revklik-goal-location="hero"
                  />
                }
              >
                <Download aria-hidden />
                Unduh APK
              </Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              {config.data?.anonScans ? `${config.data.anonScans} foto pertama tanpa daftar. ` : ""}
              Foto tidak disimpan.
            </p>
          </div>
          <HeroPhone />
        </section>

        {/* Founder intro price, while slots last — after the hero so the
            promise leads and the price tag follows. */}
        <FounderPromo className="mx-auto w-full max-w-6xl px-4 pb-8 md:px-6 md:pb-10" />

        {/* Facts strip */}
        <section aria-label="Fakta singkat" className="border-y border-border/70 bg-card">
          <dl className="mx-auto grid w-full max-w-6xl grid-cols-2 px-4 md:grid-cols-4 md:px-6">
            {FACTS.map((fact, i) => (
              <div
                key={fact.value}
                className={`py-6 md:py-8 ${i % 2 === 1 ? "pl-5 md:pl-8" : i > 0 ? "md:pl-8" : ""} ${i > 0 ? "md:border-l md:border-border/70" : ""} ${i % 2 === 1 ? "border-l border-border/70" : ""} ${i > 1 ? "border-t border-border/70 md:border-t-0" : ""}`}
              >
                <dt className="sr-only">{fact.label}</dt>
                <dd>
                  <span className="block text-2xl font-extrabold tracking-tight tabular-nums md:text-3xl">
                    {fact.value}
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">{fact.label}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* The three numbers */}
        <section
          id="fitur"
          data-section="numbers"
          className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-20 md:px-6 md:py-28"
        >
          <div className="max-w-2xl">
            <h2 className="text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
              Tiga angka setiap pagi. Ikuti saja.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              Tidak perlu menghafal kalori nasi atau menghitung makro. Beranda menjawab tiga
              pertanyaan, dan angkanya bergerak setiap kali kamu mencatat.
            </p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {NUMBERS.map((n) => (
              <article
                key={n.title}
                className="flex items-start gap-5 rounded-[1.75rem] bg-card p-5 md:block md:p-7"
              >
                <Ring
                  metric={n.metric}
                  value={n.value}
                  max={n.max}
                  size={96}
                  stroke={9}
                  className="shrink-0"
                  label={`Contoh target ${n.title.toLowerCase()}: ${n.center} ${n.unit}`}
                >
                  <div>
                    <p className="text-[1.375rem] leading-none font-extrabold tracking-tight tabular-nums">
                      {n.center}
                    </p>
                    <p className="text-[0.6875rem] font-semibold text-muted-foreground">{n.unit}</p>
                  </div>
                </Ring>
                <div>
                  <h3 className="flex flex-wrap items-center gap-2 text-xl font-extrabold tracking-tight md:mt-6">
                    {n.title}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                      Contoh
                    </span>
                  </h3>
                  <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
                    {n.body}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Scan: copy + the live demo */}
        <section id="coba" data-section="scan" className="scroll-mt-16 bg-card py-20 md:py-28">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 md:grid-cols-[1fr_1.05fr] md:gap-16 md:px-6">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
                Foto, bukan ketik
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
                AI mengenali masakan rumahan dan warung, lalu memperkirakan porsi tiap item di
                piring. Geprek, soto, gado-gado, nasi uduk: satu foto, satu ketukan simpan.
              </p>
              <ol className="mt-8 space-y-5">
                {[
                  [
                    "Foto piringmu",
                    "Dari kamera atau galeri. Fotonya dikecilkan di HP-mu dulu supaya cepat terkirim.",
                  ],
                  ["Cek hasilnya", "Ubah porsi, hapus yang salah, tambah yang terlewat."],
                  [
                    "Simpan",
                    "Angka di Beranda langsung bergerak, dan ide makan berikutnya menyesuaikan sisa kalorimu.",
                  ],
                ].map(([title, body], i) => (
                  <li key={title} className="flex gap-4">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-extrabold text-primary-foreground tabular-nums">
                      {i + 1}
                    </span>
                    <div>
                      <p className="font-bold">{title}</p>
                      <p className="mt-0.5 text-[0.9375rem] leading-relaxed text-muted-foreground">
                        {body}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="mt-8 rounded-2xl border border-border/70 bg-background p-5">
                <p className="flex items-center gap-2 font-bold">
                  <ListChecks className="size-5 text-primary" aria-hidden />
                  Angka yang jujur, bukan angka ajaib
                </p>
                <ul className="mt-3 space-y-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
                  <li className="flex gap-2.5">
                    <span aria-hidden className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
                    Hasil foto selalu perkiraan. Sebelum disimpan, ubah porsinya, hapus yang salah,
                    atau tambah yang terlewat.
                  </li>
                  <li className="flex gap-2.5">
                    <span aria-hidden className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
                    Kalorinya dikalibrasi dengan TKPI 2019, tabel komposisi pangan Indonesia dari
                    Kementerian Kesehatan.
                  </li>
                  <li className="flex gap-2.5">
                    <span aria-hidden className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
                    Foto demo di samping dibuang begitu analisisnya selesai.
                  </li>
                </ul>
              </div>
              <p className="mt-4 rounded-2xl bg-muted p-4 text-[0.9375rem] leading-relaxed text-muted-foreground">
                <span className="font-bold text-foreground">Lupa foto?</span> Ceritakan saja. Ketik
                atau ucapkan "kemarin pagi nasi kuning pakai telur dadar, siang nasi padang", AI
                yang menghitung dan menaruhnya di waktu makan dan hari yang tepat.
              </p>
            </div>
            <div>
              <p className="mb-3 text-sm font-bold text-primary">Coba sekarang, tanpa daftar</p>
              <ScanDemo />
              <ScanExample />
            </div>
          </div>
        </section>

        {/* Weight trend */}
        <section
          data-section="trend"
          className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-20 md:grid-cols-[1.05fr_1fr] md:gap-16 md:px-6 md:py-28"
        >
          <div className="md:order-2">
            <h2 className="text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
              Timbangan naik? Lihat trennya dulu.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              Berat di timbangan bisa naik turun dari hari ke hari karena air dan garam. JoyoRogo
              merata-ratakan timbanganmu jadi satu garis tren, jadi kamu tahu arah sebenarnya dan
              kira-kira kapan target tercapai.
            </p>
            <ul className="mt-6 space-y-2.5">
              {[
                "Timbang setiap pagi, cukup satu ketukan",
                "Kecepatan turun per minggu, bukan per hari",
                "Perkiraan tanggal sampai di target",
              ].map((line) => (
                <li key={line} className="flex gap-2.5 text-[0.9375rem]">
                  <Check className="mt-0.5 size-[1.125rem] shrink-0 text-primary" aria-hidden />
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <div className="md:order-1">
            <WeightTrendDemo />
          </div>
        </section>

        {/* Two supporting features, sized by weight */}
        <section
          data-section="features"
          className="mx-auto grid w-full max-w-6xl gap-4 px-4 pb-20 md:grid-cols-[1.4fr_1fr] md:px-6 md:pb-28"
        >
          <article className="rounded-[1.75rem] bg-makan-soft p-6 md:p-8">
            <h3 className="text-2xl font-extrabold tracking-tight text-makan-ink">
              Sisa 430 kcal. Makan apa?
            </h3>
            <p className="mt-2 max-w-md text-[0.9375rem] leading-relaxed text-makan-ink/80">
              Beranda menawarkan menu yang masih muat di sisa kalorimu, yang proteinnya paling
              banyak duluan. Semua porsi rumahan dan warung.
            </p>
            <ul className="mt-6 grid gap-2 sm:grid-cols-3">
              {[
                ["Ayam bakar + nasi ½ + lalapan", 430, 34],
                ["Pepes ikan + nasi ½ + lalapan", 360, 28],
                ["Sate ayam 10 tusuk, bumbu sedikit", 380, 32],
              ].map(([name, kcal, protein]) => (
                <li key={name} className="rounded-2xl bg-card px-4 py-3.5">
                  <p className="text-sm leading-snug font-semibold">{name}</p>
                  <p className="mt-1.5 text-xs font-semibold text-makan-ink tabular-nums">
                    {kcal} kcal · {protein} g protein
                  </p>
                </li>
              ))}
            </ul>
          </article>

          <article className="rounded-[1.75rem] bg-card p-6 md:p-8">
            <h3 className="text-2xl font-extrabold tracking-tight">Olahraga tercatat sendiri</h3>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
              Sambungkan sekali, lalu aktivitasmu masuk ke angka bakar tanpa diketik ulang.
            </p>
            <ul className="mt-6 space-y-3">
              <li className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-full bg-bakar-soft text-bakar-ink">
                  <Footprints className="size-5" aria-hidden />
                </span>
                <span>
                  <span className="block text-[0.9375rem] font-bold">Health Connect</span>
                  <span className="block text-sm text-muted-foreground">
                    Langkah, olahraga, tidur. Android.
                  </span>
                </span>
              </li>
              <li className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-full bg-bakar-soft text-bakar-ink">
                  <Activity className="size-5" aria-hidden />
                </span>
                <span>
                  <span className="block text-[0.9375rem] font-bold">Strava</span>
                  <span className="block text-sm text-muted-foreground">
                    Lari, sepeda, dan aktivitas lain.
                  </span>
                </span>
              </li>
              <li className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-full bg-muted text-foreground">
                  <PencilLine className="size-5" aria-hidden />
                </span>
                <span>
                  <span className="block text-[0.9375rem] font-bold">Catat manual</span>
                  <span className="block text-sm text-muted-foreground">
                    Pilih jenis olahraga dan durasi.
                  </span>
                </span>
              </li>
            </ul>
          </article>
        </section>

        {/* Together: groups, colek, VAR perut. The playful section. */}
        <section data-section="grup" className="scroll-mt-16 bg-tidur-soft py-20 md:py-28">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 md:grid-cols-[1.05fr_1fr] md:gap-16 md:px-6">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
                Yang malas catat, colek saja.
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-tidur-ink/90">
                Bikin grup bareng teman, pasangan, atau keluarga. Semangatnya jadi urusan bersama,
                bukan cuma niat di minggu pertama.
              </p>
              <ul className="mt-8 space-y-5">
                {GROUP_FEATURES.map((feature) => (
                  <li key={feature.title} className="flex gap-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-card text-tidur-ink">
                      <feature.icon className="size-5" aria-hidden />
                    </span>
                    <div>
                      <p className="font-bold">{feature.title}</p>
                      <p className="mt-0.5 text-[0.9375rem] leading-relaxed text-tidur-ink/80">
                        {feature.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-8 text-sm text-tidur-ink/70">
                Grup dibuat dari dalam aplikasi; undangannya lewat tautan.
              </p>
            </div>
            <GroupPeek />
          </div>
        </section>

        {/* Privacy promises: only what the code actually does. */}
        <section aria-label="Janji privasi" className="border-y border-border/70 bg-card">
          <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-10 sm:grid-cols-3 md:px-6 md:py-12">
            {PROMISES.map((promise) => (
              <div key={promise.title} className="flex items-start gap-3.5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-makan-soft text-makan-ink">
                  <promise.icon className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="font-bold">{promise.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                    {promise.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <p className="mx-auto -mt-2 w-full max-w-6xl px-4 pb-8 text-sm text-muted-foreground md:px-6">
            Rinciannya di halaman{" "}
            <Link
              to="/privasi"
              className="font-semibold text-primary hover:underline"
              data-revklik-goal="privacy_click"
              data-revklik-goal-location="landing"
            >
              Privasi
            </Link>
            .
          </p>
        </section>

        {/* Pricing, short; the full page has checkout. Hidden without a paywall. */}
        {config.data?.paywall && (
          <section data-section="pricing" className="border-t border-border/70 py-20 md:py-24">
            <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 md:grid-cols-[1fr_1.3fr] md:gap-16 md:px-6">
              <div>
                <h2 className="text-3xl font-extrabold tracking-tight md:text-[2.75rem] md:leading-[1.1]">
                  Gratis untuk dipakai setiap hari
                </h2>
                <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
                  Tanpa iklan. Founder membantu JoyoRogo tetap independen.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col rounded-[1.75rem] bg-card p-6">
                  <p className="font-bold">Gratis</p>
                  <p className="mt-2 text-4xl font-extrabold tracking-tight">Rp0</p>
                  <p className="text-sm text-muted-foreground">selamanya</p>
                  <ul className="mt-5 space-y-2 text-sm">
                    <li className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                      {config.data.freeDailyScans} foto AI per hari
                    </li>
                    <li className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                      Diary makan, olahraga, berat, tidur
                    </li>
                  </ul>
                  <Button
                    variant="secondary"
                    className="mt-6 w-full"
                    render={
                      <Link
                        to="/login"
                        data-revklik-goal="signup_click"
                        data-revklik-goal-location="pricing"
                      />
                    }
                  >
                    Mulai gratis
                  </Button>
                </div>
                <div className="flex flex-col rounded-[1.75rem] bg-makan-soft p-6">
                  <p className="font-bold text-makan-ink">Founder</p>
                  <p className="mt-2 text-4xl font-extrabold tracking-tight">
                    {fmtRupiah(config.data.founderPriceIdr)}
                  </p>
                  <p className="text-sm text-muted-foreground">per bulan</p>
                  <ul className="mt-5 space-y-2 text-sm">
                    <li className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-makan-ink" aria-hidden />
                      {founderScans(config.data)}
                    </li>
                    <li className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-makan-ink" aria-hidden />
                      Badge founder di profilmu
                    </li>
                    <li className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-makan-ink" aria-hidden />
                      Paket tahunan {fmtRupiah(config.data.founderYearlyPriceIdr)}/tahun — hemat 2
                      bulan
                    </li>
                  </ul>
                  <Button
                    className="mt-6 w-full"
                    render={
                      <Link
                        to="/harga"
                        data-revklik-goal="pricing_click"
                        data-revklik-goal-location="pricing"
                      />
                    }
                  >
                    Pilih Founder
                  </Button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* FAQ */}
        <section
          data-section="faq"
          className="mx-auto w-full max-w-3xl px-4 pt-4 pb-20 md:px-6 md:pb-28"
        >
          <h2 className="text-3xl font-extrabold tracking-tight md:text-[2.75rem] md:leading-[1.1]">
            Pertanyaan yang sering muncul
          </h2>
          <div className="mt-8 divide-y divide-border/70 rounded-[1.75rem] bg-card">
            {[...FAQ, ...pricingFaq(config.data)].map((item) => (
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

        {/* Closing CTA */}
        <section data-section="signup" className="mx-auto w-full max-w-6xl px-4 pb-16 md:px-6">
          <div className="rounded-[2rem] bg-primary px-6 py-12 text-center text-primary-foreground md:px-14 md:py-16">
            <h2 className="mx-auto max-w-xl text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
              Rencana harianmu siap dalam satu menit
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-lg leading-relaxed text-primary-foreground/80">
              Masuk dengan Google, isi tinggi, berat, dan target. Angka pertamamu muncul hari ini
              juga.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button
                size="lg"
                className="bg-primary-foreground text-primary hover:bg-primary-foreground/90 focus-visible:ring-primary-foreground/50"
                render={
                  <Link
                    to="/login"
                    data-revklik-goal="signup_click"
                    data-revklik-goal-location="closing"
                  />
                }
              >
                Daftar dengan Google
              </Button>
              <Button
                size="lg"
                variant="ghost"
                className="border-primary-foreground/35 text-primary-foreground hover:bg-primary-foreground/10 focus-visible:ring-primary-foreground/50"
                render={
                  <a
                    href={APK_URL}
                    data-revklik-goal="apk_download"
                    data-revklik-goal-location="closing"
                  />
                }
              >
                <Download aria-hidden />
                Unduh untuk Android
              </Button>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
