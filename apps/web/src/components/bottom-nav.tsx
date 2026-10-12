import { cn } from "@joyorogo/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { Camera, House, Scale, User, Utensils } from "lucide-react";

const TABS = [
  { to: "/beranda", label: "Beranda", Icon: House },
  { to: "/makan", label: "Makan", Icon: Utensils },
  { to: "/berat", label: "Berat", Icon: Scale },
  { to: "/profil", label: "Profil", Icon: User },
] as const;

function Tab({ to, label, Icon }: (typeof TABS)[number]) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: true, includeSearch: false }}
      className="group flex min-h-14 flex-col items-center justify-center gap-1 text-[0.6875rem] font-semibold text-foreground/45 transition-colors focus-visible:outline-none data-[status=active]:text-foreground"
    >
      <span className="flex h-8 w-14 items-center justify-center rounded-full transition-colors group-focus-visible:ring-[3px] group-focus-visible:ring-ring/40 group-data-[status=active]:bg-muted">
        <Icon className="size-[1.375rem] group-data-[status=active]:stroke-[2.4]" aria-hidden />
      </span>
      {label}
    </Link>
  );
}

/**
 * Mobile tab bar. The camera is the center FAB: logging a plate is the habit
 * the whole app exists for, so it is always one tap away. Olahraga and Tidur
 * live behind the Beranda tiles.
 */
export default function BottomNav() {
  return (
    <nav
      aria-label="Navigasi utama"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-card pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-12px_oklch(0.3_0.02_85/18%)] md:hidden"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-5 items-end px-2">
        {TABS.slice(0, 2).map((tab) => (
          <li key={tab.to}>
            <Tab {...tab} />
          </li>
        ))}
        <li className="flex justify-center">
          <Link
            to="/makan/ai"
            aria-label="Foto makanan"
            className="pressable -mt-6 mb-2 flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-float ring-[6px] ring-background focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Camera className="size-7" aria-hidden />
          </Link>
        </li>
        {TABS.slice(2).map((tab) => (
          <li key={tab.to}>
            <Tab {...tab} />
          </li>
        ))}
      </ul>
    </nav>
  );
}

const DESKTOP_LINKS = [
  { to: "/beranda", label: "Beranda" },
  { to: "/makan", label: "Makan" },
  { to: "/olahraga", label: "Olahraga" },
  { to: "/berat", label: "Berat" },
  { to: "/tidur", label: "Tidur" },
  { to: "/profil", label: "Profil" },
] as const;

/** Desktop top bar (md+). Mobile uses page headers + the tab bar instead. */
export function DesktopBar() {
  return (
    <header className="sticky top-0 z-40 hidden border-b border-border/70 bg-background/90 backdrop-blur-sm md:block">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-6 px-6">
        <Link to="/beranda" className="flex items-center gap-2">
          <img src="/brand/logo-mark.svg" alt="" className="h-7 w-auto" />
          <span className="text-lg font-extrabold tracking-tight">JoyoRogo</span>
        </Link>
        <nav aria-label="Navigasi utama" className="flex-1">
          <ul className="flex gap-1">
            {DESKTOP_LINKS.map(({ to, label }) => (
              <li key={to}>
                <Link
                  to={to}
                  activeOptions={{ exact: true, includeSearch: false }}
                  className={cn(
                    "inline-flex h-10 items-center rounded-full px-4 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
                    "data-[status=active]:bg-card data-[status=active]:text-foreground",
                  )}
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <Link
          to="/makan/ai"
          className="pressable inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <Camera className="size-[1.125rem]" aria-hidden />
          Foto makanan
        </Link>
      </div>
    </header>
  );
}
