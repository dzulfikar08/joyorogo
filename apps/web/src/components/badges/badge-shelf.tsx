import { Sheet } from "@joyorogo/ui/components/sheet";
import { cn } from "@joyorogo/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Trophy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { BadgeMedal, badgeKey } from "@/components/badges/badge-medal";
import { ListLinkRow, SectionTitle } from "@/components/kit/surface";
import type { BadgeView } from "@/lib/api-types";
import { orpc } from "@/utils/orpc";

/** badge.mine; `enabled: false` means the feature is off for this person and every entry point hides. */
export function useMyBadges() {
  return useQuery({ ...orpc.badge.mine.queryOptions(), staleTime: 60_000 });
}

function useBadgeText() {
  const { t, i18n } = useTranslation("badges");
  return {
    t,
    name: (b: Pick<BadgeView, "id">) => t(badgeKey(b.id, "name")),
    rule: (b: Pick<BadgeView, "id" | "tiers">, tier = 0) =>
      t(badgeKey(b.id, "desc"), { n: b.tiers[Math.max(0, tier - 1)] ?? b.tiers[0] }),
    date: (ms: number) =>
      new Date(ms).toLocaleDateString(i18n.language, {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
  };
}

/** Detail sheet for one badge: medallion, name, rule, earned date, next level. */
export function BadgeDetailSheet({
  badge,
  onClose,
}: {
  badge: BadgeView | null;
  onClose: () => void;
}) {
  const { t, name, rule, date } = useBadgeText();
  const earned = badge !== null && badge.tier > 0;
  const next = badge && earned ? badge.tiers[badge.tier] : undefined;
  return (
    <Sheet
      open={badge !== null}
      onOpenChange={(open) => !open && onClose()}
      title={badge ? name(badge) : ""}
    >
      {badge && (
        <div className="flex flex-col items-center gap-3 pb-2 text-center">
          <BadgeMedal badge={badge} size="lg" />
          <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
            {earned && badge.tiers.length > 1
              ? t("board.tier", { n: badge.tier })
              : earned
                ? null
                : t("board.locked")}
          </p>
          <div className="w-full rounded-2xl bg-muted px-4 py-3 text-left">
            <p className="text-xs font-semibold text-muted-foreground">{t("detail.ruleLabel")}</p>
            <p className="mt-0.5 text-sm">{rule(badge, badge.tier || 1)}</p>
          </div>
          {earned && badge.awardedAt !== null && (
            <p className="text-sm font-semibold">{t("detail.earned", { date: date(badge.awardedAt) })}</p>
          )}
          {next !== undefined && (
            <p className="text-sm text-muted-foreground">{t("detail.next", { n: next })}</p>
          )}
        </div>
      )}
    </Sheet>
  );
}

function BadgeCell({ badge, onOpen }: { badge: BadgeView; onOpen: (b: BadgeView) => void }) {
  const { name, rule } = useBadgeText();
  const earned = badge.tier > 0;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(badge)}
        className="flex w-full flex-col items-center gap-1.5 rounded-2xl px-1 py-2 text-center transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <BadgeMedal badge={badge} />
        <span className={cn("text-[0.8125rem] leading-tight font-bold", !earned && "text-muted-foreground")}>
          {name(badge)}
        </span>
        {!earned && (
          <span className="text-[0.6875rem] leading-tight text-muted-foreground">{rule(badge)}</span>
        )}
      </button>
    </li>
  );
}

/** Profile shelf: every badge, earned in colour with ring + stars, locked greyed with the rule. Renders nothing while the feature is off. */
export function BadgeShelf() {
  const { t } = useTranslation("badges");
  const mine = useMyBadges();
  const [open, setOpen] = useState<BadgeView | null>(null);
  if (!mine.data?.enabled) return null;
  const earned = mine.data.badges.filter((b) => b.tier > 0).length;
  return (
    <section className="mt-5" aria-label={t("board.badgesTitle")}>
      <SectionTitle
        className="mb-2"
        action={
          <span className="text-sm text-muted-foreground tabular-nums">
            {t("shelf.count", { earned, total: mine.data.badges.length })}
          </span>
        }
      >
        {t("board.badgesTitle")}
      </SectionTitle>
      <div className="rounded-3xl bg-card p-3">
        <ul className="grid grid-cols-3 gap-1 sm:grid-cols-4">
          {mine.data.badges.map((badge) => (
            <BadgeCell key={badge.id} badge={badge} onOpen={setOpen} />
          ))}
        </ul>
        <Link
          to="/papan"
          className="mt-2 flex min-h-11 items-center gap-2 rounded-2xl px-3 text-sm font-semibold hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <Trophy className="size-4 text-primary" aria-hidden />
          <span className="flex-1">{t("board.title")}</span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>
      </div>
      <BadgeDetailSheet badge={open} onClose={() => setOpen(null)} />
    </section>
  );
}

/** Earned badges on a public profile (caller only renders it when the API returned some). */
export function PublicBadgeRow({ badges }: { badges: BadgeView[] }) {
  const { t, name } = useBadgeText();
  const [open, setOpen] = useState<BadgeView | null>(null);
  return (
    <section className="rounded-3xl bg-card p-4" aria-label={t("public.title")}>
      <h2 className="mb-2 px-1 text-base font-bold tracking-tight">{t("public.title")}</h2>
      <ul className="flex flex-wrap gap-x-3 gap-y-2">
        {badges.map((badge) => (
          <li key={badge.id}>
            <button
              type="button"
              onClick={() => setOpen(badge)}
              aria-label={name(badge)}
              className="rounded-2xl p-1 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              <BadgeMedal badge={badge} size="sm" />
            </button>
          </li>
        ))}
      </ul>
      <BadgeDetailSheet badge={open} onClose={() => setOpen(null)} />
    </section>
  );
}

/** "Papan konsistensi" row for the Lainnya list; hidden while the feature is off. */
export function PapanLinkRow() {
  const { t } = useTranslation("badges");
  const mine = useMyBadges();
  if (!mine.data?.enabled) return null;
  return (
    <ListLinkRow
      to="/papan"
      icon={
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-bakar-soft">
          <Trophy className="size-5 text-bakar-ink" aria-hidden />
        </span>
      }
      title={t("board.title")}
      subtitle={t("board.subtitle")}
      oneLineSubtitle
    />
  );
}
