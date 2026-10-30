import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";

import { AndroidMark } from "@/components/android-mark";
import { AppleMark } from "@/components/apple-mark";

import { APP_STORE_URL, PLAY_STORE_URL } from "@/lib/store-urls";
import { openIosInstall } from "@/lib/ios-install";
import { usePlatform } from "@/lib/platform";

const ON_PRIMARY =
  "border-primary-foreground/35 text-primary-foreground hover:bg-primary-foreground/10 focus-visible:ring-primary-foreground/50";

/**
 * Get-the-app buttons for both phones. Both are always rendered, so the
 * prerendered HTML carries both; the visitor's platform only reorders them and
 * gives theirs the stronger style.
 *
 * - Android: the public Google Play listing.
 * - iPhone: the App Store, with the web app on the Home Screen as a small
 *   secondary link.
 *
 * Renders a fragment so it drops into the caller's button row.
 */
export function AppDownload({
  location,
  iphoneLabel = "Unduh di App Store",
  androidLabel = "Unduh di Google Play",
  webAppLabel = "Atau pasang web app ke Layar Utama iPhone",
  onPrimary = false,
  align = "start",
}: {
  /** Revklik `location` and the sheet's `source`: hero, closing, harga, ... */
  location: string;
  iphoneLabel?: string;
  androidLabel?: string;
  /** Small link under the buttons that opens the iPhone Home Screen sheet. */
  webAppLabel?: string;
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
          href={PLAY_STORE_URL}
          target="_blank"
          rel="noopener"
          data-revklik-goal="android_cta_click"
          data-revklik-goal-location={location}
        />
      }
    >
      <AndroidMark />
      {androidLabel}
    </Button>
  );

  const iphone = (
    <Button
      size="lg"
      variant={variantFor(os === "ios")}
      className={cn(buttonClass, os === "android" && "order-last")}
      render={
        <a
          href={APP_STORE_URL}
          target="_blank"
          rel="noopener"
          data-revklik-goal="ios_app_store_click"
          data-revklik-goal-location={location}
        />
      }
    >
      <AppleMark />
      {iphoneLabel}
    </Button>
  );

  return (
    <>
      {android}
      {iphone}
      {!standalone && (
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
