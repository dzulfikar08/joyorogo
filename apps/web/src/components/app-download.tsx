import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";
import { Smartphone, Users } from "lucide-react";

import { APK_URL, TESTER_SECTION_HREF } from "@/lib/app-config";
import { openIosInstall } from "@/lib/ios-install";
import { usePlatform } from "@/lib/platform";

const ON_PRIMARY =
  "border-primary-foreground/35 text-primary-foreground hover:bg-primary-foreground/10 focus-visible:ring-primary-foreground/50";

/**
 * Get-the-app buttons that follow the visitor's platform.
 *
 * Android goes to the Google Play closed test (the landing's tester section);
 * the APK stays as a small text link for people who can't use Play.
 *
 * - Before the platform is known (prerender, first paint) and on desktop:
 *   iPhone web app and Android tester.
 * - iOS: "Pakai di iPhone" opens the install sheet; Android tester is a small
 *   secondary text link.
 * - Android: the tester button plus the APK link.
 *
 * Renders a fragment so it drops into the caller's button row.
 */
export function AppDownload({
  location,
  iphoneLabel = "Pakai di iPhone",
  androidLabel = "Gabung tester Android",
  onPrimary = false,
  align = "start",
}: {
  /** Revklik `location` and the sheet's `source`: hero, closing, harga, ... */
  location: string;
  iphoneLabel?: string;
  androidLabel?: string;
  /** Rendered on the brand-green closing card. */
  onPrimary?: boolean;
  align?: "start" | "center";
}) {
  const { os, standalone } = usePlatform();
  const buttonClass = onPrimary ? ON_PRIMARY : undefined;
  const variant = onPrimary ? "ghost" : "secondary";
  const smallLink = cn(
    "basis-full rounded-md text-sm font-semibold underline underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
    align === "center" && "text-center",
    onPrimary ? "text-primary-foreground/80" : "text-muted-foreground",
  );

  const tester = (
    <Button
      size="lg"
      variant={variant}
      className={buttonClass}
      render={
        <a
          href={TESTER_SECTION_HREF}
          data-revklik-goal="tester_cta_click"
          data-revklik-goal-location={location}
        />
      }
    >
      <Users aria-hidden />
      {androidLabel}
    </Button>
  );

  const iphone = !standalone && (
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
  );

  if (os === "android") {
    return (
      <>
        {tester}
        <a
          href={APK_URL}
          data-revklik-goal="apk_download"
          data-revklik-goal-location={location}
          className={smallLink}
        >
          Tidak bisa lewat Play? Unduh APK
        </a>
      </>
    );
  }

  if (os === "ios") {
    return (
      <>
        {iphone}
        <a
          href={TESTER_SECTION_HREF}
          data-revklik-goal="tester_cta_click"
          data-revklik-goal-location={location}
          className={smallLink}
        >
          Punya HP Android? Gabung tester di Google Play
        </a>
      </>
    );
  }

  return (
    <>
      {iphone}
      {tester}
    </>
  );
}
