import { useQuery } from "@tanstack/react-query";
import { createFileRoute, isRedirect, Link, Navigate, redirect } from "@tanstack/react-router";
import {
  Activity,
  Check,
  ChevronDown,
  Download,
  Footprints,
  PencilLine,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@joyorogo/ui/components/button";
import { Ring, type Metric } from "@/components/kit/ring";
import { ScanDemo } from "@/components/landing/scan-demo";
import { HeroPhone, WeightTrendDemo } from "@/components/landing/visuals";
import { PublicHeader } from "@/components/public-header";
import { fmtRupiah, useAppConfig } from "@/lib/app-config";
import type { AppConfig } from "@/lib/app-config";
import { sessionQuery } from "@/lib/auth-client";
import { CACHE_OWNER_KEY, getServerUrl } from "@/utils/orpc";
import { env } from "../env.public";

export const Route = createFileRoute("/")({
  component: Landing,
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

const APK_URL = `${getServerUrl(env.VITE_SERVER_URL)}/downloads/latest-apk`;

/** Facts the product can back up; no user counts or ratings we don't have. */
const FACTS = [
  { value: "3-9 detik", label: "untuk menghitung satu foto" },
  { value: "Rp0", label: "diary lengkap, selamanya" },
  { value: "0 foto", label: "yang kami simpan" },
  { value: "Web + Android", label: "satu akun Google" },
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

const FAQ = [
  {
    q: "Seberapa akurat kalori dari foto?",
    a: "AI mengenali tiap makanan di piring lalu memperkirakan porsi dan kalorinya. Hasilnya perkiraan, jadi sebelum disimpan kamu bisa mengubah porsi, menghapus, atau menambah item.",
  },
  {
    q: "Apakah fotoku disimpan?",
    a: "Tidak. Foto hanya dipakai untuk analisis lalu dibuang. Yang tersimpan cuma nama makanan dan angka yang kamu konfirmasi, dan semuanya bisa kamu hapus dari halaman Profil.",
  },
  {
    q: "Bagaimana target kalori dihitung?",
    a: "Dari usia, jenis kelamin, tinggi, berat, dan tingkat aktivitasmu (rumus Mifflin-St Jeor), lalu dikurangi defisit sesuai target berat dan tanggal yang kamu pilih. Kalau catatan makan dan timbanganmu cukup, target menyesuaikan pembakaran nyatamu, dibatasi 15% dari rumus.",
  },
  {
    q: "Bisa dipakai di iPhone?",
    a: "Bisa lewat browser. JoyoRogo jalan di web untuk HP dan laptop. Aplikasi Android tersedia sebagai APK dan bisa membaca langkah, olahraga, dan tidur dari Health Connect.",
  },
  {
    q: "Apakah JoyoRogo open source?",
    a: "Ya. Kodenya terbuka di GitHub dengan lisensi AGPL-3.0. Mau server sendiri untuk keluarga, klinik, atau gym? Deploy lewat CloudAgni, atau jalankan di akun Cloudflare-mu.",
  },
] as const;

const SOURCE_URL = "https://github.com/dzulfikar08/joyorogo";

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
      a: `Diary makan, olahraga, berat, dan tidur gratis selamanya, dengan ${config.freeDailyScans} foto AI per hari. Founder ${fmtRupiah(config.founderPriceIdr)} per bulan membuka foto AI tanpa batas.`,
    },
  ];
}

function Landing() {
  const config = useAppConfig();
  // Background check for visitors the beforeLoad gate let through.
  const { data: session } = useQuery(sessionQuery);
  if (session) return <Navigate to="/beranda" replace />;
  const paywall = config.data?.paywall === true;

  return (
    <div className="min-h-svh">
      <PublicHeader />

      <main>
        {/* Hero */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pt-8 pb-14 md:grid-cols-[1.05fr_1fr] md:gap-8 md:px-6 md:pt-14 md:pb-20">
          <div>
            <h1 className="max-w-xl text-[2.625rem] leading-[1.04] font-extrabold tracking-tight text-balance md:text-[4rem]">
              Diet yang paham porsi warteg
            </h1>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted-foreground md:text-xl">
              Foto piringmu, kalorinya terhitung dalam beberapa detik. JoyoRogo lalu bilang berapa
              lagi yang boleh kamu makan hari ini, berapa yang perlu dibakar, dan butuh tidur berapa
              jam.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button size="lg" render={<a href="#coba" />}>
                Coba foto gratis
              </Button>
              <Button size="lg" variant="secondary" render={<Link to="/login" />}>
                Daftar dengan Google
              </Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              {config.data?.anonScans ? `${config.data.anonScans} foto pertama tanpa daftar. ` : ""}
              Tanpa kartu kredit.
            </p>
          </div>
          <HeroPhone />
        </section>

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
                  <h3 className="text-xl font-extrabold tracking-tight md:mt-6">{n.title}</h3>
                  <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
                    {n.body}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Scan: copy + the live demo */}
        <section id="coba" className="scroll-mt-16 bg-card py-20 md:py-28">
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
              <p className="mt-8 rounded-2xl bg-muted p-4 text-[0.9375rem] leading-relaxed text-muted-foreground">
                <span className="font-bold text-foreground">Lupa foto?</span> Ceritakan saja. Ketik
                atau ucapkan "kemarin pagi nasi kuning pakai telur dadar, siang nasi padang", AI
                yang menghitung dan menaruhnya di waktu makan dan hari yang tepat.
              </p>
            </div>
            <div>
              <p className="mb-3 text-sm font-bold text-primary">Coba sekarang, tanpa daftar</p>
              <ScanDemo />
            </div>
          </div>
        </section>

        {/* Weight trend */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-20 md:grid-cols-[1.05fr_1fr] md:gap-16 md:px-6 md:py-28">
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
        <section className="mx-auto grid w-full max-w-6xl gap-4 px-4 pb-20 md:grid-cols-[1.4fr_1fr] md:px-6 md:pb-28">
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

        {/* Pricing, short; the full page has checkout. Hidden without a paywall. */}
        {config.data?.paywall && (
          <section className="border-t border-border/70 py-20 md:py-24">
            <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 md:grid-cols-[1fr_1.3fr] md:gap-16 md:px-6">
              <div>
                <h2 className="text-3xl font-extrabold tracking-tight md:text-[2.75rem] md:leading-[1.1]">
                  Gratis untuk dipakai setiap hari
                </h2>
                <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
                  Tanpa iklan. Founder membantu JoyoRogo tetap independen.
                </p>
                <Link
                  to="/harga"
                  className="mt-6 inline-flex min-h-11 items-center text-[0.9375rem] font-bold text-primary hover:underline"
                >
                  Lihat detail harga
                </Link>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-[1.75rem] bg-card p-6">
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
                </div>
                <div className="rounded-[1.75rem] bg-card p-6">
                  <p className="font-bold">Founder</p>
                  <p className="mt-2 text-4xl font-extrabold tracking-tight">
                    {fmtRupiah(config.data.founderPriceIdr)}
                  </p>
                  <p className="text-sm text-muted-foreground">per bulan</p>
                  <ul className="mt-5 space-y-2 text-sm">
                    <li className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                      Foto AI tanpa batas
                    </li>
                    <li className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                      Badge founder di profilmu
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* FAQ */}
        <section className="mx-auto w-full max-w-3xl px-4 pt-4 pb-20 md:px-6 md:pb-28">
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
        <section className="mx-auto w-full max-w-6xl px-4 pb-16 md:px-6">
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
                render={<Link to="/login" />}
              >
                Daftar dengan Google
              </Button>
              <Button
                size="lg"
                variant="ghost"
                className="border-primary-foreground/35 text-primary-foreground hover:bg-primary-foreground/10 focus-visible:ring-primary-foreground/50"
                render={<a href={APK_URL} />}
              >
                <Download aria-hidden />
                Unduh untuk Android
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/70">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:flex-row md:items-center md:justify-between md:px-6">
          <div>
            <p className="flex items-center gap-2 text-base font-extrabold tracking-tight">
              <img src="/brand/logo-mark.svg" alt="" className="h-6 w-auto" />
              JoyoRogo
            </p>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
              <ShieldCheck className="size-4" aria-hidden />
              Dibuat di Malang oleh Dzulfikar. Foto makanan tidak pernah disimpan.
            </p>
          </div>
          <nav aria-label="Tautan" className="flex flex-wrap gap-x-6 gap-y-1 text-sm font-semibold">
            {paywall && (
              <Link to="/harga" className="inline-flex min-h-11 items-center hover:text-primary">
                Harga
              </Link>
            )}
            <Link to="/privasi" className="inline-flex min-h-11 items-center hover:text-primary">
              Privasi
            </Link>
            <a href={APK_URL} className="inline-flex min-h-11 items-center hover:text-primary">
              Unduh Android
            </a>
            <a href={SOURCE_URL} className="inline-flex min-h-11 items-center hover:text-primary">
              Kode sumber
            </a>
            <Link to="/login" className="inline-flex min-h-11 items-center hover:text-primary">
              Masuk
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
