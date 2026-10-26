import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { cn } from "@joyorogo/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  Copy,
  ExternalLink,
  Share,
  SquarePlus,
  Smartphone,
  SquareStack,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { AppLink } from "@/components/app-link";
import { AppleMark } from "@/components/apple-mark";
import { APP_STORE_URL } from "@/lib/store-urls";
import { HOSTS } from "@/lib/app-host";
import { trackConversion } from "@/lib/analytics";
import {
  closeIosInstall,
  dismissIosInstallBanner,
  openIosInstall,
  useIosInstallBannerVisible,
  useIosInstallOpen,
} from "@/lib/ios-install";
import { usePlatform } from "@/lib/platform";
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
  const { t } = useTranslation("misc");
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
        {copied ? t("iosInstall.copied") : t("iosInstall.copy")}
      </Button>
      <span role="status" className="sr-only">
        {copied ? t("iosInstall.copiedStatus") : ""}
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
  const { t } = useTranslation("misc");
  return (
    <div
      aria-hidden
      className={cn(
        "flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-semibold",
        TAP,
      )}
    >
      {t("iosInstall.addToHome")}
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
  const { t } = useTranslation(["misc", "common"]);
  const open = useIosInstallOpen();
  const platform = usePlatform();
  const session = useQuery({ ...sessionQuery, enabled: open });
  const signedIn = Boolean(session.data);
  const url = `${HOSTS?.appOrigin ?? window.location.origin}/`;
  const notIphone = platform.os !== "ios";
  const wrongBrowser = platform.os === "ios" && !platform.isIosSafari;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && closeIosInstall()}
      title={t("iosInstall.title")}
      description={t("iosInstall.description")}
    >
      {(wrongBrowser || notIphone) && (
        <div className="mb-4 rounded-3xl bg-makan-soft p-4 text-makan-ink">
          <p className="flex items-center gap-2 text-sm font-bold">
            {wrongBrowser ? (
              <TriangleAlert className="size-4 shrink-0" aria-hidden />
            ) : (
              <Smartphone className="size-4 shrink-0" aria-hidden />
            )}
            {wrongBrowser ? t("iosInstall.wrongBrowser.title") : t("iosInstall.notIphone.title")}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed">
            {wrongBrowser ? t("iosInstall.wrongBrowser.body") : t("iosInstall.notIphone.body")}
          </p>
          <CopyLink url={url} />
        </div>
      )}

      <div className="mb-5 rounded-3xl bg-primary/10 p-4">
        <p className="flex items-center gap-2 text-sm font-bold">
          <AppleMark />
          {t("iosInstall.appStore.title")}
        </p>
        <p className="mt-1.5 text-sm leading-relaxed">{t("iosInstall.appStore.body")}</p>
        <Button
          className="mt-4 w-full"
          render={
            <a
              href={APP_STORE_URL}
              target="_blank"
              rel="noopener"
              data-revklik-goal="ios_app_store_click"
              data-revklik-goal-location="ios_sheet"
            />
          }
        >
          <ExternalLink aria-hidden />
          {t("iosInstall.appStore.open")}
        </Button>
      </div>

      <p className="mb-3 text-sm font-bold">{t("iosInstall.appStore.orWeb")}</p>

      <ol className="space-y-3">
        <Step n={1} title={t("iosInstall.steps.safari.title")} illustration={<SafariMark />}>
          {t("iosInstall.steps.safari.body")}
        </Step>
        <Step n={2} title={t("iosInstall.steps.share.title")} illustration={<SafariToolbar />}>
          {t("iosInstall.steps.share.body")}
        </Step>
        <Step n={3} title={t("iosInstall.steps.add.title")} illustration={<ShareSheetRow />}>
          {t("iosInstall.steps.add.body")}
        </Step>
      </ol>

      <details className="group mt-4 text-sm text-muted-foreground">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 font-semibold select-none [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
          {t("iosInstall.notesTitle")}
        </summary>
        <p className="mt-1.5 pl-5.5 leading-relaxed">{t("iosInstall.doneNote")}</p>
      </details>

      {signedIn ? (
        <Button className="mt-5 w-full" variant="secondary" onClick={closeIosInstall}>
          {t("iosInstall.gotIt")}
        </Button>
      ) : (
        <Button
          className="mt-5 w-full"
          render={
            <AppLink
              to="/login"
              onClick={closeIosInstall}
              data-revklik-goal="signup_click"
              data-revklik-goal-location="ios_sheet"
            />
          }
        >
          {t("iosInstall.signUp")}
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
  const { t } = useTranslation(["misc", "common"]);
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
            {t("iosInstall.banner.title")}
            <span className="block text-xs font-medium opacity-80">{t("iosInstall.banner.body")}</span>
          </span>
        </button>
        <button
          type="button"
          aria-label={t("common:actions.close")}
          onClick={dismissIosInstallBanner}
          className="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-black/5 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none dark:hover:bg-white/10"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
