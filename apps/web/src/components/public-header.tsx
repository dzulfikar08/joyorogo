import { Link } from "@tanstack/react-router";

import { Button } from "@joyorogo/ui/components/button";

import { useAppConfig } from "@/lib/app-config";

export const GITHUB_URL = "https://github.com/dzulfikar08/joyorogo";

/** GitHub's mark; lucide dropped brand icons. */
export function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className={className}>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

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
          <Link to="/" hash="roadmap" className={NAV_LINK}>
            Roadmap
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
        <div className="flex items-center gap-2">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener"
            aria-label="Kode JoyoRogo di GitHub (open source)"
            data-revklik-goal="github_click"
            data-revklik-goal-location="header"
            className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <GithubMark className="size-5" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
          <Button
            render={
              <Link to="/login" data-revklik-goal="login_click" data-revklik-goal-location="header" />
            }
          >
            Masuk
          </Button>
        </div>
      </div>
    </header>
  );
}
