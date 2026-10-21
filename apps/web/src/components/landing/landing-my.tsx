import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { CameraOff, ChevronDown, MegaphoneOff, Trash2 } from "lucide-react";

import { Button } from "@joyorogo/ui/components/button";
import { AppDownload } from "@/components/app-download";
import { AppLink } from "@/components/app-link";
import { Ring } from "@/components/kit/ring";
import { FooterMy, HeaderMy } from "@/components/landing/my-chrome";
import { ContohImbasan, JadualSumber } from "@/components/landing/my-dishes";
import { PasangMy } from "@/components/landing/my-pasang";
import { HargaMy, ringgitFaq } from "@/components/landing/my-pricing";
import { GITHUB_URL, GithubMark } from "@/components/public-header";
import { useAppConfig } from "@/lib/app-config";
import { CARA_KIRA, CERITA_CONTOH, FAQ_MS, JANJI, TIGA_ANGKA } from "@/lib/landing-ms";

const JANJI_IKON = { foto: CameraOff, iklan: MegaphoneOff, padam: Trash2 } as const;

const FOCUS = "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none";
const TEXT_LINK = `rounded-sm font-semibold text-primary underline underline-offset-4 ${FOCUS}`;

const HPB_LICENCE_URL = "https://pphtpc.hpb.gov.sg/web/sgfoodid";
const HPB_TERMS_URL = "https://file.go.gov.sg/termsofuse-hpbsgfoodid.pdf";

/**
 * /my: the landing for Malaysian visitors, in Bahasa Melayu as written in Malaysia. Same brand, tokens and mascot as
 * the Indonesian landing; the content is rebuilt around what a Malaysian plate needs (kedai mamak units, cited kcal
 * rows, ringgit pricing from /api/config). Availability wording follows the Indonesian landing: closed test and beta,
 * never a store listing.
 */
export function LandingMy() {
  const config = useAppConfig();

  // The app's own i18n sets <html lang> from the browser's language; this page is Malay whatever that is.
  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = "ms";
    return () => {
      document.documentElement.lang = previous;
    };
  }, []);

  return (
    <div lang="ms" className="marketing min-h-svh">
      <HeaderMy />

      <main>
        {/* Hero: the promise on the left, a scan result built from real dataset rows on the right. */}
        <section
          data-section="hero"
          className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pt-8 pb-16 md:grid-cols-[1.05fr_1fr] md:gap-10 md:px-6 md:pt-14 md:pb-24"
        >
          <div className="stagger-enter">
            <h1 className="max-w-xl text-[2.5rem] leading-[1.06] font-extrabold tracking-tight text-balance md:text-[3.5rem]">
              Foto pinggan mamak anda. Kalorinya dianggar dalam beberapa saat.
            </h1>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted-foreground md:text-xl">
              Dari nasi lemak bungkus sampai teh tarik, JoyoRogo menganggar kalori setiap item di atas pinggan anda.
              Sunting hasilnya sebelum menyimpan. Setiap pagi ada tiga angka: berapa lagi boleh dimakan, berapa
              perlu dibakar, dan berapa jam perlu tidur.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <AppDownload
                location="my-hero"
                androidLabel="Sertai penguji Android"
                iphoneLabel="Cuba di iPhone"
                webAppLabel="iPhone tanpa TestFlight? Pasang web app ke Skrin Utama"
                testerHref="#tester"
              />
            </div>
            <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
              <span>Foto tidak disimpan.</span>
              <AppLink
                to="/login"
                data-revklik-goal="signup_click"
                data-revklik-goal-location="my-hero"
                className={`${TEXT_LINK} inline-flex min-h-11 items-center`}
              >
                Atau terus guna web app dengan akaun Google
              </AppLink>
            </p>
          </div>
          <ContohImbasan />
        </section>

        {/* The three numbers: the eat budget gets the large slot, burn and sleep share the second column. */}
        <section
          id="tiga-angka"
          data-section="tiga-angka"
          className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 pb-20 md:px-6 md:pb-28"
        >
          <div className="max-w-2xl">
            <h2 className="text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
              Tiga angka setiap pagi
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              Anda tidak perlu menghafal kalori nasi atau mengira makro. Skrin utama aplikasi menjawab tiga soalan,
              dan angkanya bergerak setiap kali anda mencatat.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-[1.35fr_1fr] md:grid-rows-2">
            {TIGA_ANGKA.map((n, i) => {
              const utama = i === 0;
              return (
                <article
                  key={n.title}
                  className={
                    utama
                      ? "flex flex-col gap-6 rounded-[1.75rem] bg-makan-soft p-6 sm:flex-row sm:items-center md:row-span-2 md:flex-col md:items-start md:justify-between md:p-8"
                      : "flex items-start gap-5 rounded-[1.75rem] bg-card p-5 md:p-6"
                  }
                >
                  <Ring
                    metric={n.metric}
                    value={n.value}
                    max={n.max}
                    size={utama ? 168 : 96}
                    stroke={utama ? 14 : 9}
                    whenVisible
                    className={utama ? "rounded-full bg-card" : undefined}
                    label={`Contoh sasaran ${n.title.toLowerCase()}: ${n.center} ${n.unit}`}
                  >
                    <div>
                      <p
                        className={`leading-none font-extrabold tracking-tight tabular-nums ${utama ? "text-4xl" : "text-[1.375rem]"}`}
                      >
                        {n.center}
                      </p>
                      <p className="text-[0.6875rem] font-semibold text-muted-foreground">{n.unit}</p>
                    </div>
                  </Ring>
                  <div>
                    <h3
                      className={`flex flex-wrap items-center gap-2 font-extrabold tracking-tight ${utama ? "text-2xl text-makan-ink" : "text-xl"}`}
                    >
                      {n.title}
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                        Contoh
                      </span>
                    </h3>
                    <p
                      className={`mt-2 text-[0.9375rem] leading-relaxed ${utama ? "text-makan-ink/90" : "text-muted-foreground"}`}
                    >
                      {n.body}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Angka dalam gelang ialah contoh untuk menunjukkan bentuknya, bukan data pengguna.
          </p>
        </section>

        {/* How a Malaysian plate is counted: a plain list, not cards, because the content is a lookup. */}
        <section id="imbas" data-section="imbas" className="scroll-mt-16 bg-card py-20 md:py-28">
          <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 md:grid-cols-[1fr_1.2fr] md:gap-16 md:px-6">
            <div className="md:sticky md:top-24 md:self-start">
              <h2 className="text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
                Pinggan mamak dikira satu per satu
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
                Sebungkus nasi lemak bukan lima item, dan roti canai dikira per keping. Inilah yang JoyoRogo
                beritahu AI apabila aplikasi dalam Bahasa Melayu atau anda berada di Malaysia.
              </p>
              <div className="mt-8 rounded-2xl bg-makan-soft p-5">
                <p className="font-bold text-makan-ink">Lupa ambil foto? Ceritakan sahaja.</p>
                <p className="mt-2 text-[0.9375rem] leading-relaxed text-makan-ink/90">
                  Taip "{CERITA_CONTOH}". AI mengira dan meletakkannya pada waktu makan yang betul. Tanpa jumlah,
                  nasi lemak dikira 1 bungkus, roti canai 1 keping, satay 5 cucuk, kuih 1 biji, dan teh tarik atau
                  Milo 1 gelas kedai mamak.
                </p>
              </div>
            </div>
            <dl className="divide-y divide-border/70 border-y border-border/70">
              {CARA_KIRA.map((row) => (
                <div key={row.dish} className="grid gap-1 py-5 sm:grid-cols-[11rem_1fr] sm:gap-6">
                  <dt className="text-lg font-extrabold tracking-tight">{row.dish}</dt>
                  <dd className="text-[0.9375rem] leading-relaxed text-muted-foreground">{row.rule}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Data honesty: the cited rows, then the licence notice HPB requires. */}
        <section
          id="sumber"
          data-section="sumber"
          className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-20 md:px-6 md:py-28"
        >
          <div className="grid gap-10 md:grid-cols-[1fr_1.25fr] md:gap-14">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
                Angka kcal ada sumbernya
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
                Hidangan yang ada dalam jadual rujukan dirujuk pada nilainya: saiz hidangan biasa dan kcal setiap
                100 g. Yang tiada dalam jadual dianggar oleh AI.
              </p>
              <ul className="mt-6 space-y-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
                <li>
                  Hasil imbasan sentiasa anggaran. Sebelum menyimpan, tukar saiz hidangan, padam item yang salah atau
                  tambah yang tertinggal.
                </li>
                <li>
                  Jadual ini daripada Health Promotion Board (HPB) Singapura, bukan data rasmi Malaysia. Banyak
                  hidangan Malaysia diukur HPB seperti dijual di Singapura, jadi saiz dan resipi di kedai anda boleh
                  berbeza.
                </li>
                <li>
                  Hidangan di luar jadual dirujuk pada TKPI 2019, jadual komposisi pangan Indonesia daripada
                  Kementerian Kesihatan RI.
                </li>
              </ul>
            </div>
            <JadualSumber />
          </div>
          <div className="mt-10 rounded-2xl border border-border/70 bg-card p-5 text-sm leading-relaxed text-muted-foreground md:p-6">
            <p lang="en">
              Contains information from Singapore Food Insights Database (SG FoodID) accessed on 2026-10-21
              from Health Promotion Board which is made available under the terms found at{" "}
              <a href={HPB_LICENCE_URL} target="_blank" rel="noopener" className={TEXT_LINK}>
                pphtpc.hpb.gov.sg/web/sgfoodid
              </a>
              . The information contained within this dataset is provided on an "as-is" basis. The data, including
              but not limited to nutritional information, is subject to inherent limitations. No warranty or
              representation is made as to the accuracy or completeness of the data contained herein.
            </p>
            <p className="mt-3">
              HPB tidak menyokong JoyoRogo dan tidak terlibat dalam hasil imbasan.{" "}
              <a href={HPB_TERMS_URL} target="_blank" rel="noopener" className={TEXT_LINK}>
                Terma penggunaan data SG FoodID
              </a>
              .
            </p>
          </div>
        </section>

        {/* Privacy promises: the Indonesian landing's three, in Malay. */}
        <section aria-label="Janji privasi" className="border-y border-border/70 bg-card">
          <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-10 sm:grid-cols-3 md:px-6 md:py-12">
            {JANJI.map((janji) => {
              const Ikon = JANJI_IKON[janji.key];
              return (
                <div key={janji.key} className="flex items-start gap-3.5">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-makan-soft text-makan-ink">
                    <Ikon className="size-5" aria-hidden />
                  </span>
                  <div>
                    <p className="font-bold">{janji.title}</p>
                    <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{janji.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mx-auto -mt-2 w-full max-w-6xl px-4 pb-8 text-sm text-muted-foreground md:px-6">
            Notis privasi dalam Bahasa Melayu sedang disediakan. Sehingga siap, butirannya ada di halaman{" "}
            <Link
              to="/privasi"
              lang="id"
              hrefLang="id"
              className={TEXT_LINK}
              data-revklik-goal="privacy_click"
              data-revklik-goal-location="my"
            >
              Privasi (Bahasa Indonesia)
            </Link>
            .
          </p>
        </section>

        {/* Pricing */}
        <section
          id="harga"
          data-section="harga"
          className="mx-auto grid w-full max-w-6xl scroll-mt-20 gap-10 px-4 py-20 md:grid-cols-[1fr_1.3fr] md:gap-16 md:px-6 md:py-28"
        >
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
              Percuma setiap hari. Pro jika anda mahu lebih.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              Tiada iklan. Pro membantu JoyoRogo kekal bebas. Harga dan had harian di sebelah dibaca terus dari
              pelayan JoyoRogo.
            </p>
          </div>
          <HargaMy />
        </section>

        <PasangMy />

        {/* FAQ: real questions for this market; the ringgit answer follows /api/config. */}
        <section
          id="soalan"
          data-section="soalan"
          className="mx-auto w-full max-w-3xl scroll-mt-20 px-4 pt-4 pb-20 md:px-6 md:pb-28"
        >
          <h2 className="text-3xl font-extrabold tracking-tight md:text-[2.75rem] md:leading-[1.1]">
            Soalan lazim
          </h2>
          <div className="mt-8 divide-y divide-border/70 rounded-[1.75rem] bg-card">
            {[...FAQ_MS.slice(0, 5), ...ringgitFaq(config.data), ...FAQ_MS.slice(5)].map((item) => (
              <details key={item.q} className="group px-5 md:px-6">
                <summary
                  className={`-mx-2 flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-2 py-4 text-[1.0625rem] font-bold ${FOCUS} [&::-webkit-details-marker]:hidden`}
                >
                  {item.q}
                  <ChevronDown
                    className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
                    aria-hidden
                  />
                </summary>
                <p className="pb-5 text-[0.9375rem] leading-relaxed text-muted-foreground">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Open source and who made it. */}
        <section data-section="sumber-terbuka" className="mx-auto w-full max-w-6xl px-4 pb-16 md:px-6">
          <div className="flex flex-col gap-5 rounded-[1.75rem] bg-card p-6 md:flex-row md:items-center md:justify-between md:p-8">
            <div className="flex gap-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-muted text-foreground">
                <GithubMark className="size-6" />
              </span>
              <div>
                <h2 className="text-xl font-extrabold tracking-tight md:text-2xl">
                  Kodnya terbuka, boleh anda semak sendiri
                </h2>
                <p className="mt-1 max-w-xl text-[0.9375rem] leading-relaxed text-muted-foreground">
                  Seluruh kod JoyoRogo ada di GitHub dengan lesen AGPL-3.0: cara kalori dikira, data yang digunakan,
                  sampai apa yang disimpan daripada foto anda. Dibuat oleh Joyo Digitama di Malang, Indonesia. Ada
                  yang salah? Buka isu atau hantar pembetulan.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              className="shrink-0"
              render={
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener"
                  data-revklik-goal="github_click"
                  data-revklik-goal-location="my-sumber-terbuka"
                />
              }
            >
              <GithubMark className="size-4" />
              Lihat di GitHub
            </Button>
          </div>
        </section>

        {/* Closing: the mascot on the soft green stage, the one place it appears on this page. */}
        <section data-section="penutup" className="mx-auto w-full max-w-6xl px-4 pb-16 md:px-6">
          <div className="grid items-center gap-6 overflow-hidden rounded-[2rem] bg-makan-soft px-6 pt-10 md:grid-cols-[1.4fr_1fr] md:gap-10 md:px-14 md:py-0">
            <div className="md:py-16">
              <h2 className="max-w-xl text-3xl font-extrabold tracking-tight text-balance text-makan-ink md:text-[2.75rem] md:leading-[1.1]">
                Imbas hidangan pertama anda hari ini
              </h2>
              <p className="mt-4 max-w-lg text-lg leading-relaxed text-makan-ink/90">
                Log masuk dengan Google, isi tinggi, berat dan sasaran. Angka pertama anda muncul hari ini juga.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button
                  size="lg"
                  render={
                    <AppLink
                      to="/login"
                      data-revklik-goal="signup_click"
                      data-revklik-goal-location="my-penutup"
                    />
                  }
                >
                  Daftar dengan Google
                </Button>
                <AppDownload
                  location="my-penutup"
                  androidLabel="Sertai penguji Android"
                  iphoneLabel="Cuba di iPhone"
                  webAppLabel="iPhone tanpa TestFlight? Pasang web app ke Skrin Utama"
                  testerHref="#tester"
                />
              </div>
            </div>
            <img
              src="/mascot/hero.webp"
              alt="Joyo, maskot JoyoRogo: kucing hijau berperisai tradisional Jawa"
              width={560}
              height={875}
              loading="lazy"
              decoding="async"
              className="mx-auto h-60 w-auto self-end object-contain md:h-96"
            />
          </div>
        </section>
      </main>

      <FooterMy />
    </div>
  );
}
