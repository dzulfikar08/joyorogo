import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Bell,
  ChevronRight,
  Info,
  LayoutList,
  LogOut,
  Palette,
  Plug,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  User,
  Users,
  Utensils,
  Watch,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { LOCALE_NAMES } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";
import { Avatar } from "@/components/avatar";
import { BrandMark } from "@/components/kit/brand-mark";
import {
  IconChip,
  ListButtonRow,
  ListGroup,
  ListLinkRow,
  SectionTitle,
} from "@/components/kit/surface";
import { useAccountActions } from "@/components/profil/account-actions";
import { ConfirmSheet } from "@/components/profil/confirm-sheet";
import type { ProfilCtx } from "@/components/profil/shared";
import { useTheme } from "@/components/theme-provider";
import { useAppConfig } from "@/lib/app-config";
import { fmtFounderDate } from "@/lib/billing";
import { orpc } from "@/utils/orpc";

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      {title && <SectionTitle className="mb-2">{title}</SectionTitle>}
      <ListGroup>{children}</ListGroup>
    </section>
  );
}

/** Pro or free line under the name: expiry date, daily AI scan quota, or just the tier. */
function useSummaryLine({ tier, founderUntil }: ProfilCtx): string {
  const { t } = useTranslation("settings");
  const config = useAppConfig();
  if (tier === "founder") {
    return founderUntil
      ? t("hub.summary.proUntil", { date: fmtFounderDate(founderUntil) })
      : t("hub.summary.pro");
  }
  return config.data?.billing === true
    ? t("hub.summary.freeScans", { count: config.data.freeDailyScans })
    : t("hub.summary.free");
}

function SummaryCard({ ctx }: { ctx: ProfilCtx }) {
  const { t } = useTranslation(["settings", "common"]);
  const line = useSummaryLine(ctx);
  const { name, email, image, tier } = ctx;
  return (
    <Link
      to="/profil/akun"
      className="flex items-center gap-3.5 rounded-3xl bg-card p-3.5 transition-colors hover:bg-muted/60 active:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      <Avatar name={name ?? email ?? "?"} image={image} className="size-12 text-base" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[1.0625rem] font-extrabold tracking-tight">
            {name ?? t("common:more.fallbackNameWeb")}
          </span>
          {tier === "founder" && (
            <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-makan-soft px-2 text-[0.6875rem] font-bold text-makan-ink">
              Pro
            </span>
          )}
        </span>
        <span className="block truncate text-sm text-muted-foreground">
          {email ?? t("profile.emailFallback")}
        </span>
        <span className="mt-0.5 block truncate text-[0.8125rem] font-semibold text-makan-ink">
          {line}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

/** Profil hub: summary card, grouped rows that open sub-screens, then Keluar and Hapus akun. */
export function HubScreen({ ctx }: { ctx: ProfilCtx }) {
  const { t, i18n: instance } = useTranslation([
    "settings",
    "koneksi",
    "notifications",
    "home",
    "coros",
  ]);
  const { theme } = useTheme();
  const strava = useQuery(orpc.strava.status.queryOptions());
  const coros = useQuery(orpc.coros.status.queryOptions());
  const apps = useQuery(orpc.mcpConnection.list.queryOptions());
  const actions = useAccountActions();
  const displayValue = `${t(`theme.${theme}`)} · ${LOCALE_NAMES[instance.language as Locale] ?? instance.language}`;

  return (
    <>
      <SummaryCard ctx={ctx} />

      <Group title={t("hub.groups.account")}>
        <ListLinkRow
          to="/profil/akun"
          icon={
            <IconChip tone="tidur">
              <User />
            </IconChip>
          }
          title={t("hub.rows.account.title")}
          subtitle={t("hub.rows.account.subtitle")}
          oneLineSubtitle
        />
        <ListLinkRow
          to="/profil/langganan"
          icon={
            <IconChip tone="bakar">
              <Sparkles />
            </IconChip>
          }
          title={t("hub.rows.subscription.title")}
          subtitle={t("hub.rows.subscription.subtitle")}
          oneLineSubtitle
          value={
            ctx.tier === "founder"
              ? t("hub.rows.subscription.valuePro")
              : t("hub.rows.subscription.valueFree")
          }
        />
      </Group>

      <Group title={t("hub.groups.body")}>
        <ListLinkRow
          to="/profil/target"
          icon={
            <IconChip tone="makan">
              <Target />
            </IconChip>
          }
          title={t("hub.rows.body.title")}
          subtitle={t("hub.rows.body.subtitle")}
          oneLineSubtitle
        />
        <ListLinkRow
          to="/profil/makan"
          icon={
            <IconChip tone="bakar">
              <Utensils />
            </IconChip>
          }
          title={t("hub.rows.meals.title")}
          subtitle={t("hub.rows.meals.subtitle")}
          oneLineSubtitle
        />
      </Group>

      <Group title={t("hub.groups.connections")}>
        <ListLinkRow
          to="/profil/strava"
          icon={<BrandMark brand="strava" />}
          title={t("hub.rows.strava.title")}
          subtitle={t("hub.rows.strava.subtitle")}
          oneLineSubtitle
          value={strava.data?.connected ? t("hub.rows.strava.valueConnected") : undefined}
        />
        {coros.data?.configured ? (
        <ListLinkRow
          to="/profil/coros"
          icon={
            <IconChip tone="bakar">
              <Watch />
            </IconChip>
          }
          title={t("coros:title")}
          subtitle={t("coros:hub.subtitle")}
          oneLineSubtitle
          value={coros.data?.connected ? t("coros:hub.valueConnected") : undefined}
        />
        ) : null}
        <ListLinkRow
          to="/koneksi"
          icon={
            <IconChip tone="tidur">
              <Plug />
            </IconChip>
          }
          title={t("koneksi:title")}
          subtitle={t("hub.rows.ai.subtitle")}
          oneLineSubtitle
          value={apps.data && apps.data.length > 0 ? apps.data.length : undefined}
        />
      </Group>

      <Group title={t("hubWeb.groups.community")}>
        <ListLinkRow
          to="/profil/feed"
          icon={
            <IconChip tone="makan">
              <Users />
            </IconChip>
          }
          title={t("hub.rows.feed.title")}
          subtitle={t("hub.rows.feed.subtitle")}
          oneLineSubtitle
        />
      </Group>

      <Group title={t("hub.groups.app")}>
        <ListLinkRow
          to="/profil/notifikasi"
          icon={
            <IconChip tone="bakar">
              <Bell />
            </IconChip>
          }
          title={t("notifications:title")}
          subtitle={t("notifications:web.hubSubtitle")}
          oneLineSubtitle
        />
        <ListLinkRow
          to="/profil/tampilan"
          icon={
            <IconChip tone="tidur">
              <Palette />
            </IconChip>
          }
          title={t("hub.rows.display.title")}
          subtitle={displayValue}
          oneLineSubtitle
        />
        <ListLinkRow
          to="/beranda-kartu"
          icon={
            <IconChip tone="makan">
              <LayoutList />
            </IconChip>
          }
          title={t("home:cards.title")}
          oneLineSubtitle
        />
        <ListLinkRow
          to="/profil/privasi"
          icon={
            <IconChip tone="makan">
              <ShieldCheck />
            </IconChip>
          }
          title={t("hub.rows.privacy.title")}
          subtitle={t("hub.rows.privacy.subtitle")}
          oneLineSubtitle
        />
        <ListLinkRow
          to="/profil/tentang"
          icon={
            <IconChip tone="muted">
              <Info />
            </IconChip>
          }
          title={t("hub.rows.about.title")}
          subtitle={t("hubWeb.rows.about.subtitle")}
          oneLineSubtitle
        />
      </Group>

      <Group>
        <ListButtonRow
          destructive
          icon={<LogOut aria-hidden />}
          title={t("account.signOut")}
          onClick={() => actions.setSignOutOpen(true)}
        />
        <ListButtonRow
          destructive
          icon={<Trash2 aria-hidden />}
          title={t("account.delete.title")}
          onClick={() => actions.setDeleteAccountOpen(true)}
        />
      </Group>

      <ConfirmSheet
        open={actions.signOutOpen}
        onOpenChange={actions.setSignOutOpen}
        title={t("hubWeb.signOut.confirmTitle")}
        body={t("hubWeb.signOut.confirmBody")}
        confirmLabel={actions.signingOut ? t("account.signingOut") : t("account.signOut")}
        pending={actions.signingOut}
        onConfirm={actions.signOut}
      />
      <ConfirmSheet
        open={actions.deleteAccountOpen}
        onOpenChange={actions.setDeleteAccountOpen}
        title={t("account.delete.confirmTitle")}
        body={t("account.delete.confirmMessage")}
        confirmLabel={t("account.delete.title")}
        pending={actions.deletingAccount}
        onConfirm={actions.deleteAccount}
      />
    </>
  );
}
