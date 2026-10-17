import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { cn } from "@joyorogo/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  Copy,
  ExternalLink,
  FlaskConical,
  Share,
  SquarePlus,
  Smartphone,
  SquareStack,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { trackConversion } from "@/lib/analytics";
import {
  closeIosInstall,
  dismissIosInstallBanner,
  openIosInstall,
  useIosInstallBannerVisible,
  useIosInstallOpen,
} from "@/lib/ios-install";
import { usePlatform } from "@/lib/platform";
import { IOS_TESTFLIGHT_LIVE, JOYOROGO_TESTFLIGHT_URL } from "@/lib/testflight";
import { sessionQuery } from "@/lib/auth-client";

/** Copies through the async clipboard API, falling back for webviews that block it. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    const ok = document.execCommand("copy");
    field.remove();
    return ok;
  }
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <div className="mt-3 flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate rounded-full bg-card px-4 py-2.5 text-sm font-semibold">
        {url.replace(/^https?:\/\//, "")}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        onClick={() => void copyText(url).then((ok) => ok && setCopied(true))}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? "Tersalin" : "Salin link"}
      </Button>
      <span role="status" className="sr-only">
        {copied ? "Link tersalin" : ""}
      </span>
    </div>
  );
}

/** Highlight ring for the control the step tells you to tap. */
const TAP = "bg-primary/15 text-primary ring-2 ring-primary";

/** Safari's bottom toolbar (iPhone), share button marked. */
function SafariToolbar() {
  return (
    <div
      aria-hidden
      className="flex items-center justify-between rounded-2xl bg-muted px-4 py-2.5 text-muted-foreground"
    >
      <ChevronLeft className="size-5" />
      <ChevronRight className="size-5" />
      <span className={cn("flex size-10 items-center justify-center rounded-xl", TAP)}>
        <Share className="size-5" />
      </span>
      <BookOpen className="size-5" />
      <SquareStack className="size-5" />
    </div>
  );
}

/** The "Tambah ke Layar Utama" row of the share sheet, marked. */
function ShareSheetRow() {
  return (
    <div
      aria-hidden
      className={cn(
        "flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-semibold",
        TAP,
      )}
    >
      Tambah ke Layar Utama
      <SquarePlus className="size-5" />
    </div>
  );
}

function SafariMark() {
  return (
    <div
      aria-hidden
      className="flex items-center gap-3 rounded-2xl bg-muted px-4 py-3 text-sm font-semibold"
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-sky-500/15 text-sky-600 dark:text-sky-400">
        <Compass className="size-6" />
      </span>
      Safari
    </div>
  );
}

function Step({
  n,
  title,
  children,
  illustration,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  illustration: React.ReactNode;
}) {
  return (
    <li className="rounded-3xl bg-background p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-extrabold text-primary-foreground">
          {n}
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-bold tracking-tight">{title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{children}</p>
        </div>
      </div>
      <div className="mt-3">{illustration}</div>
    </li>
  );
}

/** The one install sheet; mounted once in the root route. */
function IosInstallSheet() {
  const open = useIosInstallOpen();
  const platform = usePlatform();
  const session = useQuery({ ...sessionQuery, enabled: open });
  const signedIn = Boolean(session.data);
  const url = `${window.location.origin}/`;
  const notIphone = platform.os !== "ios";
  const wrongBrowser = platform.os === "ios" && !platform.isIosSafari;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && closeIosInstall()}
      title="Pasang di iPhone"
      description="Coba aplikasi iPhone lewat TestFlight, atau pasang web app ke Layar Utama supaya terbuka layar penuh seperti aplikasi. Akun dan datanya sama."
    >
      {(wrongBrowser || notIphone) && (
        <div className="mb-4 rounded-3xl bg-makan-soft p-4 text-makan-ink">
          <p className="flex items-center gap-2 text-sm font-bold">
            {wrongBrowser ? (
              <TriangleAlert className="size-4 shrink-0" aria-hidden />
            ) : (
              <Smartphone className="size-4 shrink-0" aria-hidden />
            )}
            {wrongBrowser ? "Buka dulu di Safari" : "Panduan ini untuk iPhone"}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed">
            {wrongBrowser
              ? "Kamu sedang di browser lain atau di dalam aplikasi (Instagram, TikTok, dan sejenisnya). Menu pasang ke Layar Utama paling lengkap di Safari. Salin link ini, buka Safari, tempel di kolom alamat."
              : "Buka link ini dari iPhone-mu, di Safari. Kirim ke dirimu sendiri lewat WhatsApp atau salin dulu."}
          </p>
          <CopyLink url={url} />
        </div>
      )}

      {IOS_TESTFLIGHT_LIVE && (
        <div className="mb-5 rounded-3xl bg-primary/10 p-4">
          <p className="flex items-center gap-2 text-sm font-bold">
            <FlaskConical className="size-4 shrink-0 text-primary" aria-hidden />
            Coba aplikasi iPhone (beta publik, TestFlight)
          </p>
          <ol className="mt-3 space-y-2 text-sm leading-relaxed">
            <li className="flex gap-2.5">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-extrabold text-primary-foreground">
                1
              </span>
              <span className="pt-0.5">Pasang TestFlight dari App Store, kalau belum ada.</span>
            </li>
            <li className="flex gap-2.5">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-extrabold text-primary-foreground">
                2
              </span>
              <span className="pt-0.5">
                Buka link undangan di iPhone, ketuk Terima, lalu Pasang JoyoRogo.
              </span>
            </li>
          </ol>
          <Button
            className="mt-4 w-full"
            render={
              <a
                href={JOYOROGO_TESTFLIGHT_URL}
                target="_blank"
                rel="noopener"
                data-revklik-goal="ios_testflight_click"
                data-revklik-goal-location="ios_sheet"
              />
            }
          >
            <ExternalLink aria-hidden />
            Buka TestFlight
          </Button>
          <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
            Masih beta, jadi mungkin ada yang belum rapi. Versi App Store 1.0 sedang menunggu review Apple. Akunnya sama dengan versi web.
          </p>
        </div>
      )}

      {IOS_TESTFLIGHT_LIVE && <p className="mb-3 text-sm font-bold">Atau pakai versi web</p>}

      <ol className="space-y-3">
        <Step n={1} title="Buka di Safari" illustration={<SafariMark />}>
          Buka joyorogo.com di Safari. Browser di dalam aplikasi seperti Instagram atau TikTok tidak
          punya menu pasang.
        </Step>
        <Step n={2} title="Tap Bagikan" illustration={<SafariToolbar />}>
          Tap ikon Bagikan, kotak dengan panah ke atas, di bar bawah Safari. Di iPad ada di bar
          atas. Tidak kelihatan? Tap tombol titik tiga dulu.
        </Step>
        <Step n={3} title="Tambah ke Layar Utama" illustration={<ShareSheetRow />}>
          Geser menu ke bawah sampai ketemu Tambah ke Layar Utama, tap, lalu tap Tambah di pojok
          kanan atas.
        </Step>
      </ol>

      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        Selesai. Buka JoyoRogo dari ikonnya di Layar Utama; kalau diminta masuk, pakai akun Google
        yang sama. Pengingat lewat notifikasi di iPhone butuh iOS 16.4 ke atas dan JoyoRogo dibuka
        dari Layar Utama.
      </p>

      {signedIn ? (
        <Button className="mt-5 w-full" variant="secondary" onClick={closeIosInstall}>
          Mengerti
        </Button>
      ) : (
        <Button
          className="mt-5 w-full"
          render={
            <Link
              to="/login"
              onClick={closeIosInstall}
              data-revklik-goal="signup_click"
              data-revklik-goal-location="ios_sheet"
            />
          }
        >
          Daftar dengan Google
        </Button>
      )}
    </Sheet>
  );
}

/**
 * Root-level owner of the sheet. Links from static pages (the blog) arrive as
 * `/?pasang=iphone`: open the sheet once, then drop the parameter.
 */
export function IosInstallHost() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("pasang") !== "iphone") return;
    url.searchParams.delete("pasang");
    window.history.replaceState(window.history.state, "", url);
    openIosInstall("link");
  }, []);
  return <IosInstallSheet />;
}

/** One-time prompt inside the signed-in app: iOS, in a browser tab, not yet on the Home Screen. */
export function IosInstallBanner() {
  const platform = usePlatform();
  const visible = useIosInstallBannerVisible();
  if (platform.os !== "ios" || platform.standalone || !visible) return null;
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-3">
      <div className="flex items-center gap-1 rounded-3xl bg-makan-soft py-1.5 pr-1.5 pl-4 text-makan-ink">
        <button
          type="button"
          // In-app paths are filtered out of Revklik events (blog/revklik.ts); conversions pass.
          onClick={() => {
            trackConversion("ios_cta_click", undefined, { location: "banner" });
            dismissIosInstallBanner();
            openIosInstall("banner");
          }}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-full text-left focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <Smartphone className="size-5 shrink-0" aria-hidden />
          <span className="min-w-0 text-sm leading-snug font-bold">
            Pasang JoyoRogo di layar utama
            <span className="block text-xs font-medium opacity-80">Terbuka layar penuh, tanpa bar Safari.</span>
          </span>
        </button>
        <button
          type="button"
          aria-label="Tutup"
          onClick={dismissIosInstallBanner}
          className="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-black/5 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none dark:hover:bg-white/10"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
