import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";

import { AppLink } from "@/components/app-link";
import { GITHUB_URL, GithubMark } from "@/components/public-header";
import { ANDROID_ROBOT_CREDIT } from "@/lib/credits";
import { CONTACT_EMAIL } from "@/lib/landing-ms";

const FOCUS = "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none";

const NAV = [
  { href: "#imbas", label: "Cara imbas" },
  { href: "#sumber", label: "Sumber data" },
  { href: "#harga", label: "Harga" },
  { href: "#soalan", label: "Soalan lazim" },
] as const;

const NAV_LINK = cn(
  "inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground",
  FOCUS,
);

/**
 * Header of the Malaysian landing. The Indonesian PublicHeader links to pages and labels that exist only in
 * Indonesian, so /my has its own: Malay section anchors that exist on the page, a way back to the Indonesian site,
 * and Log masuk. On a phone the anchors and the language link live behind a labelled Menu button.
 */
export function HeaderMy() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b border-transparent bg-background/90 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 md:h-16 md:px-6">
        <a
          href="/my"
          aria-label="JoyoRogo, ke permulaan halaman"
          className={cn("flex items-center gap-2 rounded-full", FOCUS)}
        >
          <img src="/brand/logo-mark.svg" alt="" className="h-7 w-auto md:h-8" />
          <span className="text-lg font-extrabold tracking-tight">JoyoRogo</span>
        </a>
        <nav aria-label="Utama" className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} className={NAV_LINK}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link to="/" lang="id" hrefLang="id" className={cn(NAV_LINK, "hidden md:inline-flex")}>
            Bahasa Indonesia
          </Link>
          <Button
            render={
              <AppLink to="/login" data-revklik-goal="login_click" data-revklik-goal-location="my-header" />
            }
          >
            Log masuk
          </Button>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="menu-my"
            onClick={() => setOpen((value) => !value)}
            className={cn(
              "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold hover:bg-muted md:hidden",
              FOCUS,
            )}
          >
            {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
            Menu
          </button>
        </div>
      </div>
      {open && (
        <nav
          id="menu-my"
          aria-label="Menu"
          className="mx-auto flex max-w-6xl flex-col border-t border-border/70 px-4 pb-3 md:hidden"
        >
          {NAV.map((item) => (
            <a key={item.href} href={item.href} onClick={() => setOpen(false)} className={cn(NAV_LINK, "px-2")}>
              {item.label}
            </a>
          ))}
          <Link to="/" lang="id" hrefLang="id" className={cn(NAV_LINK, "px-2")}>
            Bahasa Indonesia
          </Link>
        </nav>
      )}
    </header>
  );
}

const FOOT_LINK = cn("inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold hover:text-primary", FOCUS, "rounded-md");

/**
 * Footer of the Malaysian landing. Pages that exist only in Indonesian are linked with that written in the label, so
 * nobody lands on Indonesian text by surprise.
 */
export function FooterMy() {
  return (
    <footer className="mt-8 border-t border-border/70">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 pt-12 pb-6 md:grid-cols-[1.4fr_1fr_1fr] md:px-6">
        <div className="max-w-sm">
          <p className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
            <img src="/brand/logo-mark.svg" alt="" className="h-7 w-auto" />
            JoyoRogo
          </p>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
            Tiga angka setiap hari: boleh <span className="font-semibold text-makan-ink">makan</span> berapa, perlu{" "}
            <span className="font-semibold text-bakar-ink">bakar</span> berapa, perlu{" "}
            <span className="font-semibold text-tidur-ink">tidur</span> berapa jam.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Dibuat oleh Joyo Digitama di Malang, Indonesia. Foto asal tidak disimpan kecuali anda memintanya.
          </p>
        </div>

        <nav aria-label="Halaman" className="flex flex-col">
          <p className="text-[0.6875rem] font-bold tracking-[0.14em] text-muted-foreground uppercase">Halaman</p>
          <Link to="/" lang="id" hrefLang="id" className={FOOT_LINK}>
            Bahasa Indonesia
          </Link>
          <a href="/blog/" lang="id" hrefLang="id" className={FOOT_LINK}>
            Blog (Bahasa Indonesia)
          </a>
          <Link to="/privasi" lang="id" hrefLang="id" className={FOOT_LINK}>
            Privasi (Bahasa Indonesia)
          </Link>
          <Link to="/syarat" lang="id" hrefLang="id" className={FOOT_LINK}>
            Syarat (Bahasa Indonesia)
          </Link>
          <Link to="/pengembalian-dana" lang="id" hrefLang="id" className={FOOT_LINK}>
            Bayaran balik (Bahasa Indonesia)
          </Link>
        </nav>

        <nav aria-label="Hubungi dan kod" className="flex flex-col">
          <p className="text-[0.6875rem] font-bold tracking-[0.14em] text-muted-foreground uppercase">Hubungi</p>
          <a href={`mailto:${CONTACT_EMAIL}`} className={FOOT_LINK}>
            {CONTACT_EMAIL}
          </a>
          <a href={GITHUB_URL} target="_blank" rel="noopener" className={FOOT_LINK}>
            <GithubMark className="size-4" />
            Kod sumber (AGPL-3.0)
          </a>
          <a href="#muat-turun" className={FOOT_LINK}>
            Cara memasang aplikasi
          </a>
        </nav>
      </div>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 pb-8 text-xs leading-relaxed text-muted-foreground md:px-6">
        <p>© {new Date().getFullYear()} JoyoRogo · AGPL-3.0</p>
        <p lang="en">{ANDROID_ROBOT_CREDIT}</p>
      </div>
    </footer>
  );
}
