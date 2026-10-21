import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";

import { AndroidMark } from "@/components/android-mark";
import { AppLink } from "@/components/app-link";
import { AppleMark } from "@/components/apple-mark";
import { TESTER_GROUP_URL, TESTER_OPTIN_URL } from "@/lib/app-config";
import { ANDROID_LANGKAH, IOS_LANGKAH } from "@/lib/landing-ms";
import { openIosInstall } from "@/lib/ios-install";
import { usePlatform } from "@/lib/platform";
import { IOS_TESTFLIGHT_LIVE, JOYOROGO_TESTFLIGHT_URL } from "@/lib/testflight";

function Langkah({ steps }: { steps: readonly string[] }) {
  return (
    <ol className="space-y-4">
      {steps.map((step, i) => (
        <li key={step} className="flex gap-3.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-card text-sm font-extrabold text-makan-ink tabular-nums">
            {i + 1}
          </span>
          <p className="pt-0.5 text-[0.9375rem] leading-relaxed text-makan-ink/90">{step}</p>
        </li>
      ))}
    </ol>
  );
}

/**
 * Install steps for both phones, in the state the Indonesian landing describes: Android is a Google Play closed test
 * (join the group, then opt in), iPhone is the public TestFlight beta with the App Store version in review. Neither is
 * a store listing yet and the copy says so. The visitor's own phone is listed first.
 */
export function PasangMy() {
  const { os } = usePlatform();
  return (
    <section
      id="muat-turun"
      data-section="muat-turun"
      className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 pb-16 md:px-6"
    >
      <h2 className="max-w-xl text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
        Pasang JoyoRogo di telefon anda
      </h2>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
        Kedua-dua versi masih dalam ujian, jadi JoyoRogo belum tersedia untuk semua orang di Google Play atau App
        Store. Web app di joyorogo.com sudah boleh digunakan di pelayar telefon atau komputer.
      </p>
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <div
          id="tester"
          data-section="tester"
          className={cn("scroll-mt-20 rounded-[1.75rem] bg-makan-soft p-6 md:p-8", os === "ios" && "md:order-last")}
        >
          <h3 className="text-2xl font-extrabold tracking-tight text-makan-ink">
            Android: sertai penguji
          </h3>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-makan-ink/85">
            Versi Android di Play Store masih ujian tertutup. Google hanya membenarkan keluaran kepada semua orang
            selepas 12 penguji menggunakannya selama 14 hari, jadi setiap penguji amat membantu. Percuma, perlukan
            Android 8 ke atas.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              size="lg"
              render={
                <a
                  href={TESTER_GROUP_URL}
                  target="_blank"
                  rel="noopener"
                  data-revklik-goal="tester_group_click"
                  data-revklik-goal-location="my-tester"
                />
              }
            >
              <AndroidMark />
              1. Sertai kumpulan Google
            </Button>
            <Button
              size="lg"
              variant="outline"
              render={
                <a
                  href={TESTER_OPTIN_URL}
                  target="_blank"
                  rel="noopener"
                  data-revklik-goal="tester_optin_click"
                  data-revklik-goal-location="my-tester"
                />
              }
            >
              2. Become a tester di Play
            </Button>
          </div>
          <div className="mt-8">
            <Langkah steps={ANDROID_LANGKAH} />
          </div>
        </div>

        <div
          id="iphone-beta"
          data-section="iphone-beta"
          className={cn("scroll-mt-20 rounded-[1.75rem] bg-card p-6 md:p-8", os === "ios" && "md:order-first")}
        >
          <h3 className="text-2xl font-extrabold tracking-tight">iPhone: beta awam</h3>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
            Aplikasi iPhone boleh dicuba melalui TestFlight, dan versi App Store 1.0 sedang menunggu semakan Apple.
            Percuma, perlukan iOS 16.4 ke atas.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {IOS_TESTFLIGHT_LIVE && (
              <Button
                size="lg"
                render={
                  <a
                    href={JOYOROGO_TESTFLIGHT_URL}
                    target="_blank"
                    rel="noopener"
                    data-revklik-goal="ios_testflight_click"
                    data-revklik-goal-location="my-tester"
                  />
                }
              >
                <AppleMark />
                Buka TestFlight
              </Button>
            )}
            <Button
              size="lg"
              variant="outline"
              data-revklik-goal="ios_cta_click"
              data-revklik-goal-location="my-tester"
              onClick={() => openIosInstall("my-tester")}
            >
              Pasang web app ke Skrin Utama
            </Button>
          </div>
          <div className="mt-8">
            <ol className="space-y-4">
              {IOS_LANGKAH.map((step, i) => (
                <li key={step} className="flex gap-3.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-extrabold tabular-nums">
                    {i + 1}
                  </span>
                  <p className="pt-0.5 text-[0.9375rem] leading-relaxed text-muted-foreground">{step}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
      <p className="mt-6 text-[0.9375rem] text-muted-foreground">
        Tidak mahu memasang apa-apa?{" "}
        <AppLink
          to="/login"
          data-revklik-goal="signup_click"
          data-revklik-goal-location="my-pasang"
          className="inline-flex min-h-11 items-center rounded-sm font-semibold text-primary underline underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          Buka web app dan log masuk dengan Google
        </AppLink>
        .
      </p>
    </section>
  );
}
