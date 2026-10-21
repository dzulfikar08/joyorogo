import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";

import { AndroidMark } from "@/components/android-mark";
import { AppleMark } from "@/components/apple-mark";

import { TESTER_SECTION_HREF } from "@/lib/app-config";
import { openIosInstall } from "@/lib/ios-install";
import { usePlatform } from "@/lib/platform";
import { IOS_TESTFLIGHT_LIVE, JOYOROGO_TESTFLIGHT_URL } from "@/lib/testflight";

const ON_PRIMARY =
  "border-primary-foreground/35 text-primary-foreground hover:bg-primary-foreground/10 focus-visible:ring-primary-foreground/50";

/**
 * Get-the-app buttons for both phones. Both are always rendered, so the
 * prerendered HTML carries both; the visitor's platform only reorders them and
 * gives theirs the stronger style.
 *
 * - Android: the Google Play closed test (the landing's tester section).
 * - iPhone: the public TestFlight beta (the install sheet while the beta flag
 *   is off), with the web app on the Home Screen as a small secondary link.
 *
 * Renders a fragment so it drops into the caller's button row.
 */
export function AppDownload({
  location,
  iphoneLabel = "Coba di iPhone",
  androidLabel = "Gabung tester Android",
  webAppLabel = "iPhone tanpa TestFlight? Pasang web app ke Layar Utama",
  testerHref = TESTER_SECTION_HREF,
  onPrimary = false,
  align = "start",
}: {
  /** Revklik `location` and the sheet's `source`: hero, closing, harga, ... */
  location: string;
  iphoneLabel?: string;
  androidLabel?: string;
  /** Small link under the buttons that opens the iPhone Home Screen sheet. */
  webAppLabel?: string;
  /** Where the Android button goes; defaults to the Indonesian landing's tester section. */
  testerHref?: string;
  /** Rendered on the brand-green closing card. */
  onPrimary?: boolean;
  align?: "start" | "center";
}) {
  const { os, standalone } = usePlatform();
  const variantFor = (own: boolean) => (onPrimary ? "ghost" : own ? "secondary" : "outline");
  const buttonClass = onPrimary ? ON_PRIMARY : undefined;
  const smallLink = cn(
    "basis-full rounded-md text-sm font-semibold underline underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
    align === "center" && "text-center",
    onPrimary ? "text-primary-foreground/80" : "text-muted-foreground",
  );

  const android = (
    <Button
      size="lg"
      variant={variantFor(os === "android")}
      className={cn(buttonClass, os === "ios" && "order-last")}
      render={
        <a
          href={testerHref}
          data-revklik-goal="tester_cta_click"
          data-revklik-goal-location={location}
        />
      }
    >
      <AndroidMark />
      {androidLabel}
    </Button>
  );

  const iphone = IOS_TESTFLIGHT_LIVE ? (
    <Button
      size="lg"
      variant={variantFor(os === "ios")}
      className={cn(buttonClass, os === "android" && "order-last")}
      render={
        <a
          href={JOYOROGO_TESTFLIGHT_URL}
          target="_blank"
          rel="noopener"
          data-revklik-goal="ios_testflight_click"
          data-revklik-goal-location={location}
        />
      }
    >
      <AppleMark />
      {iphoneLabel}
    </Button>
  ) : (
    <Button
      size="lg"
      variant={variantFor(os === "ios")}
      className={cn(buttonClass, os === "android" && "order-last")}
      data-revklik-goal="ios_cta_click"
      data-revklik-goal-location={location}
      onClick={() => openIosInstall(location)}
    >
      <AppleMark />
      {iphoneLabel}
    </Button>
  );

  return (
    <>
      {android}
      {iphone}
      {IOS_TESTFLIGHT_LIVE && !standalone && (
        <button
          type="button"
          data-revklik-goal="ios_cta_click"
          data-revklik-goal-location={location}
          onClick={() => openIosInstall(location)}
          className={cn(smallLink, "order-last text-left", align === "center" && "text-center")}
        >
          {webAppLabel}
        </button>
      )}
    </>
  );
}
