import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";
import { Download, Smartphone } from "lucide-react";

import { APK_URL } from "@/lib/app-config";
import { openIosInstall } from "@/lib/ios-install";
import { usePlatform } from "@/lib/platform";

const ON_PRIMARY =
  "border-primary-foreground/35 text-primary-foreground hover:bg-primary-foreground/10 focus-visible:ring-primary-foreground/50";

/**
 * Get-the-app buttons that follow the visitor's platform.
 *
 * - Before the platform is known (prerender, first paint) and on desktop:
 *   both options, iPhone web app and Android APK.
 * - iOS: "Pakai di iPhone" opens the install sheet; the APK stays as a small
 *   secondary text link.
 * - Android: the APK only.
 *
 * Renders a fragment so it drops into the caller's button row.
 */
export function AppDownload({
  location,
  iphoneLabel = "Pakai di iPhone",
  apkLabel = "Unduh APK",
  onPrimary = false,
  align = "start",
}: {
  /** Revklik `location` and the sheet's `source`: hero, closing, harga, ... */
  location: string;
  iphoneLabel?: string;
  apkLabel?: string;
  /** Rendered on the brand-green closing card. */
  onPrimary?: boolean;
  align?: "start" | "center";
}) {
  const { os, standalone } = usePlatform();
  const buttonClass = onPrimary ? ON_PRIMARY : undefined;
  const variant = onPrimary ? "ghost" : "secondary";

  const apk = (
    <Button
      size="lg"
      variant={variant}
      className={buttonClass}
      render={
        <a href={APK_URL} data-revklik-goal="apk_download" data-revklik-goal-location={location} />
      }
    >
      <Download aria-hidden />
      {apkLabel}
    </Button>
  );

  if (os === "android") return apk;

  if (os === "ios") {
    return (
      <>
        {!standalone && (
          <Button
            size="lg"
            variant={variant}
            className={buttonClass}
            data-revklik-goal="ios_cta_click"
            data-revklik-goal-location={location}
            onClick={() => openIosInstall(location)}
          >
            <Smartphone aria-hidden />
            {iphoneLabel}
          </Button>
        )}
        <a
          href={APK_URL}
          data-revklik-goal="apk_download"
          data-revklik-goal-location={location}
          className={cn(
            "basis-full rounded-md text-sm font-semibold underline underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
            align === "center" && "text-center",
            onPrimary ? "text-primary-foreground/80" : "text-muted-foreground",
          )}
        >
          Punya HP Android? Unduh APK
        </a>
      </>
    );
  }

  return (
    <>
      <Button
        size="lg"
        variant={variant}
        className={buttonClass}
        data-revklik-goal="ios_cta_click"
        data-revklik-goal-location={location}
        onClick={() => openIosInstall(location)}
      >
        <Smartphone aria-hidden />
        {iphoneLabel}
      </Button>
      {apk}
    </>
  );
}
