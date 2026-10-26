import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";

import { AppLink } from "@/components/app-link";
import { WhatsAppLink } from "@/components/landing/my-whatsapp";
import { GITHUB_URL, GithubMark } from "@/components/public-header";
import { ANDROID_ROBOT_CREDIT } from "@/lib/credits";
import { CONTACT_EMAIL } from "@/lib/contact";

const FOCUS = "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none";

const NAV = [
  { href: "#how", label: "How it counts" },
  { href: "#sources", label: "Data sources" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
] as const;

const NAV_LINK = cn(
  "inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground",
  FOCUS,
);

/**
 * Header of the Singapore landing. The Indonesian PublicHeader links to pages and labels that exist only in
 * Indonesian, so /sg has its own: English section anchors that exist on the page, the other two languages, and Log in.
 */
export function HeaderSg() {
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
          href="/sg"
          aria-label="JoyoRogo, back to the top of the page"
          className={cn("flex items-center gap-2 rounded-full", FOCUS)}
        >
          <img src="/brand/joyo-head.webp" alt="" width={104} height={96} className="h-7 w-auto md:h-8" />
          <span className="text-lg font-extrabold tracking-tight">JoyoRogo</span>
        </a>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
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
              <AppLink to="/login" data-revklik-goal="login_click" data-revklik-goal-location="sg-header" />
            }
          >
            Log in
          </Button>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="menu-sg"
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
          id="menu-sg"
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
 * Footer of the Singapore landing. Pages that exist only in another language say so in the label, so nobody lands on
 * Indonesian text by surprise.
 */
export function FooterSg() {
  return (
    <footer className="mt-8 border-t border-border/70">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 pt-12 pb-6 md:grid-cols-[1.4fr_1fr_1fr] md:px-6">
        <div className="max-w-sm">
          <p className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
            <img src="/brand/joyo-head.webp" alt="" width={104} height={96} className="h-7 w-auto" />
            JoyoRogo
          </p>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
            Three numbers every day: how much you can <span className="font-semibold text-makan-ink">eat</span>, how
            much to <span className="font-semibold text-bakar-ink">burn</span>, how many hours to{" "}
            <span className="font-semibold text-tidur-ink">sleep</span>.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Made by Joyo Digitama in Malang, Indonesia. The original photo is not kept unless you ask for it.
          </p>
        </div>

        <nav aria-label="Pages" className="flex flex-col">
          <p className="text-[0.6875rem] font-bold tracking-[0.14em] text-muted-foreground uppercase">Pages</p>
          <Link to="/" lang="id" hrefLang="id" className={FOOT_LINK}>
            Bahasa Indonesia
          </Link>
          <Link to="/my" lang="ms" hrefLang="ms-MY" className={FOOT_LINK}>
            Bahasa Melayu
          </Link>
          <a href="/blog/" lang="id" hrefLang="id" className={FOOT_LINK}>
            Blog (Bahasa Indonesia)
          </a>
          <a href="/my/privacy" lang="en" hrefLang="en" className={FOOT_LINK}>
            Privacy notice
          </a>
          <a href="/my/terms" lang="en" hrefLang="en" className={FOOT_LINK}>
            Terms
          </a>
        </nav>

        <nav aria-label="Contact and code" className="flex flex-col">
          <p className="text-[0.6875rem] font-bold tracking-[0.14em] text-muted-foreground uppercase">Contact</p>
          <a href={`mailto:${CONTACT_EMAIL}`} className={FOOT_LINK}>
            {CONTACT_EMAIL}
          </a>
          <WhatsAppLink location="sg-footer" lang="en" className={FOOT_LINK} />
          <a href={GITHUB_URL} target="_blank" rel="noopener" className={FOOT_LINK}>
            <GithubMark className="size-4" />
            Source code (AGPL-3.0)
          </a>
          <a href="#install" className={FOOT_LINK}>
            How to install the app
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
