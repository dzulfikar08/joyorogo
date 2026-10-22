import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { Activity, BedDouble, LayoutDashboard, Plug, Upload } from "lucide-react";
import { useState } from "react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";

import type { Session } from "@/lib/auth-client";

import { AccountMenu } from "./account-menu";
import { BrandMark } from "./brand-mark";
import { PaletteDecoration } from "./palette-decoration";
import { PageLoader } from "./states";

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

/** App chrome: sidebar from `lg` (primary navigation and the account row), top bar with the account avatar and tab bar below it. */
export function Shell({ session, children }: { session: Session; children: React.ReactNode }) {
  const { t } = useTranslation("fitWeb");
  const [sideMenuOpen, setSideMenuOpen] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
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
        </nav>
        <div className="mt-auto">
          <AccountMenu
            session={session}
            variant="row"
            open={sideMenuOpen}
            onOpenChange={setSideMenuOpen}
          />
        </div>
      </aside>

      <div className="relative min-w-0">
        <PaletteDecoration />
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden">
          <Brand />
          <AccountMenu
            session={session}
            variant="avatar"
            open={headerMenuOpen}
            onOpenChange={setHeaderMenuOpen}
          />
        </header>

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
