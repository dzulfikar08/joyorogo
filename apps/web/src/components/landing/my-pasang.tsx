import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";

import { AndroidMark } from "@/components/android-mark";
import { AppLink } from "@/components/app-link";
import { AppleMark } from "@/components/apple-mark";
import { APP_STORE_URL, PLAY_STORE_URL } from "@/lib/store-urls";
import { ANDROID_LANGKAH, IOS_LANGKAH } from "@/lib/landing-ms";
import { openIosInstall } from "@/lib/ios-install";
import { usePlatform } from "@/lib/platform";

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
 * Install steps for both phones: Android is the Google Play listing, iPhone is the App Store listing, with the web
 * app on the Home Screen as the alternative. The visitor's own phone is listed first.
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
        JoyoRogo ada di Google Play dan App Store. Web app di joyorogo.com juga boleh digunakan di pelayar telefon atau
        komputer.
      </p>
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <div
          id="android"
          data-section="android"
          className={cn("scroll-mt-20 rounded-[1.75rem] bg-makan-soft p-6 md:p-8", os === "ios" && "md:order-last")}
        >
          <h3 className="text-2xl font-extrabold tracking-tight text-makan-ink">
            Android: Google Play
          </h3>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-makan-ink/85">
            JoyoRogo ada di Google Play. Percuma dimuat turun, perlukan Android 8 ke atas.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              size="lg"
              render={
                <a
                  href={PLAY_STORE_URL}
                  target="_blank"
                  rel="noopener"
                  data-revklik-goal="android_play_click"
                  data-revklik-goal-location="my-pasang"
                />
              }
            >
              <AndroidMark />
              Muat turun di Google Play
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
          <h3 className="text-2xl font-extrabold tracking-tight">iPhone: App Store</h3>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
            JoyoRogo kini ada di App Store. Percuma dimuat turun, perlukan iOS 16.4 ke atas.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              size="lg"
              render={
                <a
                  href={APP_STORE_URL}
                  target="_blank"
                  rel="noopener"
                  data-revklik-goal="ios_app_store_click"
                  data-revklik-goal-location="my-pasang"
                />
              }
            >
              <AppleMark />
              Muat turun di App Store
            </Button>
            <Button
              size="lg"
              variant="outline"
              data-revklik-goal="ios_cta_click"
              data-revklik-goal-location="my-pasang"
              onClick={() => openIosInstall("my-pasang")}
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
