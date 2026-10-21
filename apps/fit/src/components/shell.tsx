import { LOCALES, LOCALE_NAMES, isLocale } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";
import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useTheme } from "@joyorogo/ui/hooks/use-theme";
import type { Theme } from "@joyorogo/ui/hooks/use-theme";
import { cn } from "@joyorogo/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  Bike,
  BedDouble,
  LayoutDashboard,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Settings,
  Sun,
  Newspaper,
  Plug,
  Upload,
} from "lucide-react";
import { useState } from "react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";

import { setLocale } from "@/lib/i18n";
import { type Session, signOut } from "@/lib/auth-client";
import { orpc } from "@/lib/orpc";

import { RIDE_URL, STUDIO_URL, WHATS_NEW_URL } from "@/lib/ride";

import { PALETTES, usePalette } from "@/lib/palette";

import { BrandMark } from "./brand-mark";
import { PaletteDecoration } from "./palette-decoration";
import { PageLoader } from "./states";
import { Segmented } from "./kit";

type NavItem = {
  to: "/" | "/latihan" | "/tidur" | "/unggah" | "/koneksi";
  label: "nav.overview" | "nav.workouts" | "nav.sleep" | "nav.upload" | "nav.connect";
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  exact?: boolean;
};

const NAV: readonly NavItem[] = [
  { to: "/", label: "nav.overview", Icon: LayoutDashboard, exact: true },
  { to: "/latihan", label: "nav.workouts", Icon: Activity },
  { to: "/tidur", label: "nav.sleep", Icon: BedDouble },
  { to: "/unggah", label: "nav.upload", Icon: Upload },
  { to: "/koneksi", label: "nav.connect", Icon: Plug },
];

function Brand() {
  return (
    <Link
      to="/"
      className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      <BrandMark />
      <span className="text-lg font-extrabold tracking-tight">JoyoFit</span>
      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.6875rem] font-bold tracking-wide text-primary uppercase">
        Web
      </span>
    </Link>
  );
}

function SideLink({ item }: { item: NavItem }) {
  const { t } = useTranslation("fitWeb");
  return (
    <Link
      to={item.to}
      activeOptions={{ exact: item.exact === true }}
      className="group flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[status=active]:bg-primary/10 data-[status=active]:text-primary"
    >
      <item.Icon className="size-[1.125rem]" aria-hidden />
      {t(item.label)}
    </Link>
  );
}

function BottomLink({ item }: { item: NavItem }) {
  const { t } = useTranslation("fitWeb");
  return (
    <Link
      to={item.to}
      activeOptions={{ exact: item.exact === true }}
      className="group flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[0.6875rem] font-semibold text-muted-foreground transition-colors outline-none data-[status=active]:text-primary"
    >
      <span className="grid h-7 w-14 place-items-center rounded-full transition-colors group-focus-visible:ring-[3px] group-focus-visible:ring-ring/40 group-data-[status=active]:bg-primary/10">
        <item.Icon className="size-5" aria-hidden />
      </span>
      <span className="text-center leading-tight">{t(item.label)}</span>
    </Link>
  );
}

/**
 * External: a full-page site of its own, opened in this tab (a plain link, not the router's). They sit outside the Pro
 * gate. The tab bar is full, so small screens reach them from the settings sheet.
 */
function ExternalLink({
  href,
  Icon,
  title,
  description,
  newTab = false,
}: {
  href: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  description: string;
  /** A site of its own, not part of this app: it opens beside it. */
  newTab?: boolean;
}) {
  return (
    <a
      href={href}
      {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="group flex items-center gap-3 rounded-xl px-3 py-2 text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      <Icon className="size-[1.125rem] shrink-0" aria-hidden />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs leading-snug">{description}</span>
      </span>
    </a>
  );
}

/** Ride game, watch-face Studio and the product site's "what is new". */
function ExternalLinks() {
  const { t } = useTranslation("fitWeb");
  return (
    <>
      <ExternalLink
        href={RIDE_URL}
        Icon={Bike}
        title={t("ride.title")}
        description={t("ride.description")}
      />
      <ExternalLink
        href={STUDIO_URL}
        Icon={Palette}
        title={t("studio.title")}
        description={t("studio.description")}
      />
      <ExternalLink
        href={WHATS_NEW_URL}
        Icon={Newspaper}
        title={t("whatsNew.title")}
        description={t("whatsNew.description")}
        newTab
      />
    </>
  );
}

/** Language, theme and sign-out: inline in the sidebar, inside a sheet on small screens. */
function SettingsPanel({ session }: { session: Session }) {
  const { t, i18n } = useTranslation("fitWeb");
  const { theme, setTheme } = useTheme();
  const palette = usePalette();
  const navigate = useNavigate();
  const saveLocale = useMutation(orpc.profile.setLocale.mutationOptions());
  const current: Locale = isLocale(i18n.language) ? i18n.language : "id";

  const pickLocale = (locale: Locale) => {
    void setLocale(locale);
    // The account keeps the choice for the other JoyoRogo apps. A failure (no profile yet) never blocks the switch.
    saveLocale.mutate({ locale });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="min-w-0">
        <p className="break-words text-sm font-bold">{session.user.name}</p>
        <p className="text-xs break-all text-muted-foreground">{session.user.email}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-semibold text-muted-foreground">{t("menu.language")}</p>
        <Segmented
          label={t("menu.language")}
          value={current}
          onChange={pickLocale}
          options={LOCALES.map((locale) => ({
            value: locale,
            label: locale.toUpperCase(),
            name: LOCALE_NAMES[locale],
          }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-semibold text-muted-foreground">{t("menu.theme")}</p>
        {palette.info.pin ? (
          <p className="text-xs text-muted-foreground">
            {t(palette.info.pin === "light" ? "menu.pinnedLight" : "menu.pinnedDark")}
          </p>
        ) : (
          <Segmented<Theme>
            label={t("menu.theme")}
            value={theme}
            onChange={setTheme}
            options={[
              {
                value: "light",
                label: <Sun className="size-4" aria-hidden />,
                name: t("menu.light"),
              },
              {
                value: "dark",
                label: <Moon className="size-4" aria-hidden />,
                name: t("menu.dark"),
              },
              {
                value: "system",
                label: <Monitor className="size-4" aria-hidden />,
                name: t("menu.system"),
              },
            ]}
          />
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-semibold text-muted-foreground">
          {t("menu.palette")}: {palette.info.name ?? t("menu.paletteDefault")}
        </p>
        <div role="radiogroup" aria-label={t("menu.palette")} className="flex flex-wrap gap-1.5">
          {PALETTES.map((option) => {
            const name = option.name ?? t("menu.paletteDefault");
            const selected = option.id === palette.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={name}
                title={name}
                onClick={() => palette.choose(option.id)}
                style={{
                  background: `linear-gradient(135deg, ${option.canvas} 50%, ${option.primary} 50%)`,
                }}
                className={cn(
                  "size-9 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                  selected
                    ? "ring-2 ring-foreground ring-offset-2 ring-offset-card"
                    : "ring-1 ring-foreground/20",
                )}
              />
            );
          })}
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start"
        onClick={async () => {
          await signOut();
          await navigate({ to: "/login" });
        }}
      >
        <LogOut aria-hidden />
        {t("menu.signOut")}
      </Button>
    </div>
  );
}

/** App chrome: sidebar from `lg`, top bar and tab bar below it. */
/** The frame while the session and Pro check are in flight: the brand and nav slots hold their place, so the page does not jump. */
export function ShellSkeleton() {
  return (
    <div className="min-h-svh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-svh flex-col gap-6 border-r border-border bg-sidebar px-3 py-5 lg:flex">
        <div className="px-2">
          <Brand />
        </div>
        <div className="flex flex-col gap-1">
          {NAV.map((item) => (
            <Skeleton key={item.to} className="h-11 rounded-xl" />
          ))}
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center border-b border-border bg-background/90 px-4 pt-[env(safe-area-inset-top)] lg:hidden">
          <Brand />
        </header>
        <main className="mx-auto w-full max-w-[1500px] px-4 pt-4 pb-28 sm:px-6 sm:pt-6 lg:px-8 lg:pb-12">
          <PageLoader />
        </main>
      </div>
    </div>
  );
}

export function Shell({ session, children }: { session: Session; children: React.ReactNode }) {
  const { t } = useTranslation("fitWeb");
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <div className="min-h-svh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-svh flex-col gap-6 overflow-y-auto border-r border-border bg-sidebar px-3 py-5 lg:flex">
        <div className="px-2">
          <Brand />
        </div>
        <nav aria-label={t("nav.main")} className="flex flex-col gap-1">
          {NAV.map((item) => (
            <SideLink key={item.to} item={item} />
          ))}
          <ExternalLinks />
        </nav>
        <div className="mt-auto rounded-2xl bg-card p-3 ring-1 ring-foreground/5">
          <SettingsPanel session={session} />
        </div>
      </aside>

      <div className="relative min-w-0">
        <PaletteDecoration />
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden">
          <Brand />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("menu.open")}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings aria-hidden />
          </Button>
        </header>
        <Sheet open={settingsOpen} onOpenChange={setSettingsOpen} title={t("menu.title")}>
          <div className="flex flex-col gap-4">
            <ExternalLinks />
            <SettingsPanel session={session} />
          </div>
        </Sheet>

        <main
          className={cn(
            "relative z-10 mx-auto w-full max-w-[1500px] px-4 pt-4 pb-28 sm:px-6 sm:pt-6 lg:px-8 lg:pb-12",
          )}
        >
          {children}
        </main>

        <nav
          aria-label={t("nav.main")}
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] lg:hidden"
        >
          <ul
            className={cn("mx-auto grid max-w-xl px-2")}
            style={{ gridTemplateColumns: `repeat(${NAV.length}, minmax(0, 1fr))` }}
          >
            {NAV.map((item) => (
              <li key={item.to}>
                <BottomLink item={item} />
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}
