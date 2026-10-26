import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";

import { AndroidMark } from "@/components/android-mark";
import { AppLink } from "@/components/app-link";
import { AppleMark } from "@/components/apple-mark";
import { TESTER_GROUP_URL, TESTER_OPTIN_URL } from "@/lib/app-config";
import { APP_STORE_URL } from "@/lib/store-urls";
import { ANDROID_STEPS, IOS_STEPS } from "@/lib/landing-sg";
import { openIosInstall } from "@/lib/ios-install";
import { usePlatform } from "@/lib/platform";

function Steps({ steps, tone }: { steps: readonly string[]; tone: "soft" | "card" }) {
  return (
    <ol className="space-y-4">
      {steps.map((step, i) => (
        <li key={step} className="flex gap-3.5">
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold tabular-nums",
              tone === "soft" ? "bg-card text-makan-ink" : "bg-muted",
            )}
          >
            {i + 1}
          </span>
          <p
            className={cn(
              "pt-0.5 text-[0.9375rem] leading-relaxed",
              tone === "soft" ? "text-makan-ink/90" : "text-muted-foreground",
            )}
          >
            {step}
          </p>
        </li>
      ))}
    </ol>
  );
}

/**
 * Install steps for both phones, in the state the other landings describe: Android is a Google Play closed test (join
 * the group, then opt in), iPhone is the App Store listing, with the web app on the Home Screen as the
 * alternative. The visitor's own phone is listed first.
 */
export function InstallSg() {
  const { os } = usePlatform();
  return (
    <section
      id="install"
      data-section="install"
      className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 pb-16 md:px-6"
    >
      <h2 className="max-w-xl text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
        Install JoyoRogo on your phone
      </h2>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
        Both versions are still in testing, so JoyoRogo is not yet available to everyone on Google Play or the App
        Store. The web app at joyorogo.com already works in a phone or computer browser.
      </p>
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <div
          id="tester"
          data-section="tester"
          className={cn("scroll-mt-20 rounded-[1.75rem] bg-makan-soft p-6 md:p-8", os === "ios" && "md:order-last")}
        >
          <h3 className="text-2xl font-extrabold tracking-tight text-makan-ink">Android: join as a tester</h3>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-makan-ink/85">
            The Android version on the Play Store is still a closed test. Google only allows a release to everyone
            after 12 testers have used it for 14 days, so every tester helps. Free, needs Android 8 or newer.
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
                  data-revklik-goal-location="sg-tester"
                />
              }
            >
              <AndroidMark />
              1. Join the Google group
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
                  data-revklik-goal-location="sg-tester"
                />
              }
            >
              2. Become a tester on Play
            </Button>
          </div>
          <div className="mt-8">
            <Steps steps={ANDROID_STEPS} tone="soft" />
          </div>
        </div>

        <div
          id="iphone-beta"
          data-section="iphone-beta"
          className={cn("scroll-mt-20 rounded-[1.75rem] bg-card p-6 md:p-8", os === "ios" && "md:order-first")}
        >
          <h3 className="text-2xl font-extrabold tracking-tight">iPhone: App Store</h3>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
            JoyoRogo is on the App Store. Free to download, needs iOS 16.4 or newer.
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
                  data-revklik-goal-location="sg-tester"
                />
              }
            >
              <AppleMark />
              Download on the App Store
            </Button>
            <Button
              size="lg"
              variant="outline"
              data-revklik-goal="ios_cta_click"
              data-revklik-goal-location="sg-tester"
              onClick={() => openIosInstall("sg-tester")}
            >
              Add the web app to your Home Screen
            </Button>
          </div>
          <div className="mt-8">
            <Steps steps={IOS_STEPS} tone="card" />
          </div>
        </div>
      </div>
      <p className="mt-6 text-[0.9375rem] text-muted-foreground">
        Prefer not to install anything?{" "}
        <AppLink
          to="/login"
          data-revklik-goal="signup_click"
          data-revklik-goal-location="sg-install"
          className="inline-flex min-h-11 items-center rounded-sm font-semibold text-primary underline underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          Open the web app and sign in with Google
        </AppLink>
        .
      </p>
    </section>
  );
}
