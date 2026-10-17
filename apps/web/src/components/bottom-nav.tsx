import { cn } from "@joyorogo/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { Camera, Ellipsis, House, Newspaper, Utensils } from "lucide-react";
import { useTranslation } from "react-i18next";

import { orpc } from "@/utils/orpc";

const TABS = [
  { to: "/beranda", label: "nav.home", Icon: House },
  { to: "/makan", label: "nav.food", Icon: Utensils },
  { to: "/feed", label: "nav.feed", Icon: Newspaper },
  { to: "/lainnya", label: "nav.more", Icon: Ellipsis },
] as const;

/** Routes the Lainnya tab/desktop link stands in for. */
const LAINNYA_GROUP = ["/lainnya", "/profil", "/grup", "/inbox", "/berat", "/rekap"] as const;

function inLainnyaGroup(pathname: string, to: string): boolean {
  return to === "/lainnya" && LAINNYA_GROUP.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Unread nudge pill; sits on the icon's top-right corner. */
function UnreadBadge({ count }: { count: number }) {
  return (
    <span className="absolute -top-1 right-2 grid min-w-[1.05rem] place-items-center rounded-full bg-destructive px-1 text-[0.5625rem] leading-[0.95rem] font-bold text-white">
      {count > 9 ? "9+" : count}
    </span>
  );
}

function Tab({ to, label, Icon, badge }: (typeof TABS)[number] & { badge?: number }) {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const groupedActive = inLainnyaGroup(pathname, to);
  return (
    <Link
      to={to}
      activeOptions={{ exact: true, includeSearch: false }}
      className={cn(
        "group flex min-h-14 flex-col items-center justify-center gap-1 text-[0.6875rem] font-semibold transition-colors focus-visible:outline-none",
        groupedActive
          ? "text-foreground"
          : "text-foreground/45 data-[status=active]:text-foreground",
      )}
    >
      <span className="relative flex h-8 w-14 items-center justify-center rounded-full transition-colors group-focus-visible:ring-[3px] group-focus-visible:ring-ring/40 group-data-[status=active]:bg-muted">
        <Icon className="size-[1.375rem] group-data-[status=active]:stroke-[2.4]" aria-hidden />
        {badge ? <UnreadBadge count={badge} /> : null}
      </span>
      {t(label)}
    </Link>
  );
}

/**
 * Mobile tab bar. The camera is the center FAB: logging a plate is the habit
 * the whole app exists for, so it is always one tap away. Feed is a primary
 * tab (its badge counts feed notifications); Profil, Grup, and the group
 * inbox live behind the Lainnya tab, which carries the group unread badge.
 */
export default function BottomNav() {
  const { t } = useTranslation();
  const unread = useQuery(orpc.group.unreadCount.queryOptions());
  const socialUnread = useQuery(orpc.social.notificationsUnreadCount.queryOptions());
  const count = unread.data?.count ?? 0;
  const feedCount = socialUnread.data?.count ?? 0;
  return (
    <nav
      aria-label={t("nav.primary")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-card pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] shadow-[0_-8px_24px_-12px_oklch(0.3_0.02_85/18%)] md:hidden"
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
            aria-label={t("nav.photo")}
            className="pressable -mt-6 mb-2 flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-float ring-[6px] ring-background focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Camera className="size-7" aria-hidden />
          </Link>
        </li>
        {TABS.slice(2).map((tab) => (
          <li key={tab.to}>
            <Tab
              {...tab}
              {...(tab.to === "/lainnya" && count > 0 ? { badge: count } : {})}
              {...(tab.to === "/feed" && feedCount > 0 ? { badge: feedCount } : {})}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

const DESKTOP_LINKS = [
  { to: "/beranda", label: "nav.home" },
  { to: "/makan", label: "nav.food" },
  { to: "/olahraga", label: "nav.exercise" },
  { to: "/berat", label: "nav.weight" },
  { to: "/feed", label: "nav.feed" },
  { to: "/tidur", label: "nav.sleep" },
  { to: "/lainnya", label: "nav.more" },
] as const;

/** Desktop top bar (md+). Mobile uses page headers + the tab bar instead. */
export function DesktopBar() {
  const { t } = useTranslation();
  const unread = useQuery(orpc.group.unreadCount.queryOptions());
  const socialUnread = useQuery(orpc.social.notificationsUnreadCount.queryOptions());
  const count = unread.data?.count ?? 0;
  const feedCount = socialUnread.data?.count ?? 0;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <header className="sticky top-0 z-40 hidden border-b border-border/70 bg-background/90 backdrop-blur-sm md:block">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-6 px-6">
        <Link to="/beranda" className="flex items-center gap-2">
          <img src="/brand/logo-mark.svg" alt="" className="h-7 w-auto" />
          <span className="text-lg font-extrabold tracking-tight">JoyoRogo</span>
        </Link>
        <nav aria-label={t("nav.primary")} className="flex-1">
          <ul className="flex gap-1">
            {DESKTOP_LINKS.map(({ to, label }) => {
              const groupedActive = inLainnyaGroup(pathname, to);
              return (
                <li key={to}>
                  <Link
                    to={to}
                    activeOptions={{ exact: true, includeSearch: false }}
                    className={cn(
                      "inline-flex h-10 items-center rounded-full px-4 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
                      groupedActive
                        ? "bg-card text-foreground"
                        : "data-[status=active]:bg-card data-[status=active]:text-foreground",
                    )}
                  >
                    {t(label)}
                    {to === "/lainnya" && count > 0 && (
                      <span className="ml-1.5 grid min-w-[1.15rem] place-items-center rounded-full bg-destructive px-1 text-[0.625rem] leading-4 font-bold text-white">
                        {count > 9 ? "9+" : count}
                      </span>
                    )}
                    {to === "/feed" && feedCount > 0 && (
                      <span className="ml-1.5 grid min-w-[1.15rem] place-items-center rounded-full bg-destructive px-1 text-[0.625rem] leading-4 font-bold text-white">
                        {feedCount > 9 ? "9+" : feedCount}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <Link
          to="/makan/ai"
          className="pressable inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <Camera className="size-[1.125rem]" aria-hidden />
          {t("nav.photo")}
        </Link>
      </div>
    </header>
  );
}
