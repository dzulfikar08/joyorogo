import { LOCALES, LOCALE_NAMES, isLocale } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";
import { Button } from "@joyorogo/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@joyorogo/ui/components/popover";
import { useTheme } from "@joyorogo/ui/hooks/use-theme";
import type { Theme } from "@joyorogo/ui/hooks/use-theme";
import { cn } from "@joyorogo/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Bike, ChevronsUpDown, LogOut, Monitor, Moon, Newspaper, Palette, Sun } from "lucide-react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";

import { type Session, signOut } from "@/lib/auth-client";
import { setLocale } from "@/lib/i18n";
import { orpc } from "@/lib/orpc";
import { PALETTES, type PaletteInfo, usePalette } from "@/lib/palette";
import { RIDE_URL, STUDIO_URL, WHATS_NEW_URL } from "@/lib/ride";

import { Segmented } from "./kit";

type IconType = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

function initialsOf(name: string, email: string): string {
  const source = name.trim() || email.trim();
  const parts = source.split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1 ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}` : source.slice(0, 2);
  return letters.toUpperCase();
}

function Avatar({ user, className }: { user: Session["user"]; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-primary/10 text-xs font-bold text-primary",
        className,
      )}
    >
      {user.image ? (
        <img src={user.image} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        initialsOf(user.name, user.email)
      )}
    </span>
  );
}

function MenuLink({
  href,
  Icon,
  title,
  description,
  newTab = false,
}: {
  href: string;
  Icon: IconType;
  title: string;
  description: string;
  /** A site of its own, not part of this app: it opens beside it. */
  newTab?: boolean;
}) {
  return (
    <a
      href={href}
      {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="flex items-center gap-3 rounded-xl px-2.5 py-2 text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      <Icon className="size-[1.125rem] shrink-0" aria-hidden />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs leading-snug">{description}</span>
      </span>
    </a>
  );
}

/** Ride game, watch-face Studio and the product site's "what is new": full-page sites of their own, outside the Pro gate. */
function MenuLinks() {
  const { t } = useTranslation("fitWeb");
  return (
    <div className="flex flex-col">
      <MenuLink
        href={RIDE_URL}
        Icon={Bike}
        title={t("ride.title")}
        description={t("ride.description")}
      />
      <MenuLink
        href={STUDIO_URL}
        Icon={Palette}
        title={t("studio.title")}
        description={t("studio.description")}
      />
      <MenuLink
        href={WHATS_NEW_URL}
        Icon={Newspaper}
        title={t("whatsNew.title")}
        description={t("whatsNew.description")}
        newTab
      />
    </div>
  );
}

function MenuSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function usePaletteName() {
  const { t } = useTranslation("fitWeb");
  return (option: PaletteInfo) =>
    option.id === "default"
      ? t("menu.paletteDefault")
      : option.id === "titik"
        ? t("menu.paletteTitik")
        : (option.name ?? option.id);
}

function AccountPanel({ session, close }: { session: Session; close: () => void }) {
  const { t, i18n } = useTranslation("fitWeb");
  const { theme, setTheme } = useTheme();
  const palette = usePalette();
  const nameOf = usePaletteName();
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
      <div className="flex min-w-0 items-center gap-3">
        <Avatar user={session.user} className="size-10 text-sm" />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{session.user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{session.user.email}</p>
        </div>
      </div>

      <MenuSection title={t("menu.theme")}>
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
              { value: "light", label: <Sun className="size-4" aria-hidden />, name: t("menu.light") },
              { value: "dark", label: <Moon className="size-4" aria-hidden />, name: t("menu.dark") },
              {
                value: "system",
                label: <Monitor className="size-4" aria-hidden />,
                name: t("menu.system"),
              },
            ]}
          />
        )}
      </MenuSection>

      <MenuSection title={`${t("menu.palette")}: ${nameOf(palette.info)}`}>
        <div role="radiogroup" aria-label={t("menu.palette")} className="flex flex-wrap gap-2">
          {PALETTES.map((option) => {
            const name = nameOf(option);
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
                    ? "ring-2 ring-foreground ring-offset-2 ring-offset-popover"
                    : "ring-1 ring-foreground/20",
                )}
              />
            );
          })}
        </div>
      </MenuSection>

      <MenuSection title={t("menu.language")}>
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
      </MenuSection>

      <div className="-mx-1 border-t border-border pt-2">
        <MenuLinks />
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start"
        onClick={async () => {
          close();
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

/**
 * The account popover: theme, color, language, the sites beside JoyoFit and sign-out. Opened from a compact account row
 * at the bottom of the sidebar, or from the avatar in the top bar below `lg`. Modal, so focus stays inside and Esc closes it.
 */
export function AccountMenu({
  session,
  variant,
  open,
  onOpenChange,
}: {
  session: Session;
  variant: "row" | "avatar";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("fitWeb");
  return (
    <Popover modal open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        {variant === "row" ? (
          <button
            type="button"
            aria-label={t("menu.open")}
            className="flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[state=open]:bg-muted"
          >
            <Avatar user={session.user} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{session.user.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {session.user.email}
              </span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            aria-label={t("menu.open")}
            className="grid size-11 place-items-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            <Avatar user={session.user} />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align={variant === "row" ? "start" : "end"}
        side={variant === "row" ? "top" : "bottom"}
        sideOffset={8}
        collisionPadding={12}
        aria-label={t("menu.title")}
        className="max-h-[min(var(--radix-popover-content-available-height),40rem)] w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl p-4"
      >
        <AccountPanel session={session} close={() => onOpenChange(false)} />
      </PopoverContent>
    </Popover>
  );
}
