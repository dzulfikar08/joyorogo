import { Link } from "@tanstack/react-router";

import { Button } from "@joyorogo/ui/components/button";

import { useAppConfig } from "@/lib/app-config";

const NAV_LINK =
  "inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none";

/**
 * Header for public pages (landing, harga, privasi): brand, section links
 * on wider screens, Masuk on the right. The signed-in app has its own chrome.
 */
export function PublicHeader() {
  const config = useAppConfig();
  return (
    <header className="sticky top-0 z-40 border-b border-transparent bg-background/90 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 md:h-16 md:px-6">
        <Link
          to="/"
          aria-label="JoyoRogo, ke halaman utama"
          className="flex items-center gap-2 rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <img src="/brand/logo-mark.svg" alt="" className="h-7 w-auto md:h-8" />
          <span className="text-lg font-extrabold tracking-tight">JoyoRogo</span>
        </Link>
        <nav aria-label="Utama" className="hidden items-center gap-1 md:flex">
          <Link to="/" hash="fitur" className={NAV_LINK}>
            Fitur
          </Link>
          <Link to="/" hash="coba" className={NAV_LINK}>
            Coba gratis
          </Link>
          {config.data?.paywall && (
            <Link to="/harga" className={NAV_LINK} activeProps={{ className: "text-foreground!" }}>
              Harga
            </Link>
          )}
          {/* Static pages outside the SPA router: a full page load, not <Link>. */}
          <a href="/blog/" className={NAV_LINK}>
            Blog
          </a>
        </nav>
        <Button
          render={
            <Link to="/login" data-revklik-goal="login_click" data-revklik-goal-location="header" />
          }
        >
          Masuk
        </Button>
      </div>
    </header>
  );
}
