import { Button } from "@joyorogo/ui/components/button";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ExternalLink } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { TFunction } from "@joyorogo/i18n";
import type {
  SleepCard,
  SleepInsightsStatus,
  SleepInsightsView,
  SleepLastNight,
  SleepProgressRow,
} from "@joyorogo/api/lib/sleep-insights-types";

import { Card, SectionTitle } from "@/components/kit/surface";
import { ErrorNote } from "@/components/kit/error-note";
import { SleepConsentSheet } from "@/components/sleep-insights/consent";
import {
  useSleepSettings,
  useSleepStatus,
  useSleepView,
} from "@/components/sleep-insights/use-sleep-insights";
import { fmtDateShort } from "@/lib/format";

function duration(t: TFunction<"sleepInsights">, minutes: number): string {
  const total = Math.round(minutes);
  return total < 60
    ? t("ui.durationM", { m: total })
    : t("ui.durationHm", { h: Math.floor(total / 60), m: total % 60 });
}

/** Dots of the compared nights, newest first: filled = night with the habit. */
function NightDots({ nights }: { nights: SleepCard["nights"] }) {
  const { t } = useTranslation("sleepInsights");
  return (
    <div className="mt-2 space-y-2">
      <ul className="flex flex-wrap gap-1.5">
        {nights.map((night) => (
          <li
            key={night.date}
            title={fmtDateShort(night.date)}
            aria-label={`${fmtDateShort(night.date)}: ${
              night.exposed ? t("ui.legendExposed") : t("ui.legendOther")
            }`}
            className={cn("size-3.5 rounded-full border-2 border-tidur", night.exposed && "bg-tidur")}
          />
        ))}
      </ul>
      <div className="space-y-1 text-xs text-muted-foreground">
        <p className="flex items-center gap-2">
          <span className="size-3.5 rounded-full border-2 border-tidur bg-tidur" aria-hidden />
          {t("ui.legendExposed")}
        </p>
        <p className="flex items-center gap-2">
          <span className="size-3.5 rounded-full border-2 border-tidur" aria-hidden />
          {t("ui.legendOther")}
        </p>
      </div>
    </div>
  );
}

const ACTION =
  "inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-bold text-tidur-ink focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none";

function InsightCard({
  card,
  busy,
  onDismiss,
}: {
  card: SleepCard;
  busy: boolean;
  onDismiss: () => void;
}) {
  const { t } = useTranslation("sleepInsights");
  const [open, setOpen] = useState(false);
  const personal = card.kind === "personal";
  return (
    <Card className="p-5">
      <p className="text-sm font-bold text-tidur-ink">
        {personal ? t("ui.personal") : t("ui.general")}
      </p>
      <p className="mt-1 text-[0.9375rem] leading-relaxed break-words">{card.text}</p>
      {personal && card.exposed !== null && card.other !== null ? (
        <p className="mt-2 text-sm font-semibold text-muted-foreground">
          {t("ui.compare", { exposed: card.exposed, other: card.other })}
          {card.confidence ? ` · ${t(`confidence.${card.confidence}`)}` : ""}
        </p>
      ) : null}
      {card.nights.length > 0 ? (
        <div className="mt-1">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className={ACTION}
          >
            {open ? t("ui.hideNights") : t("ui.showNights")}
            <ChevronDown
              className={cn("size-4 transition-transform duration-200", open && "rotate-180")}
              aria-hidden
            />
          </button>
          {open ? <NightDots nights={card.nights} /> : null}
        </div>
      ) : null}
      {card.sources.length > 0 ? (
        <div className="mt-1">
          <p className="text-xs text-muted-foreground">{t("ui.sources")}</p>
          {card.sources.map((source) => (
            <a
              key={source.url}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className={ACTION}
            >
              <span className="min-w-0 break-words">{source.label}</span>
              <ExternalLink className="size-3.5 shrink-0" aria-hidden />
            </a>
          ))}
        </div>
      ) : null}
      <div className="mt-1 flex">
        <button
          type="button"
          disabled={busy}
          onClick={onDismiss}
          className="min-h-11 rounded-lg text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-60"
        >
          {t("ui.dismiss")}
        </button>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("disclaimer")}</p>
    </Card>
  );
}

function ProgressRows({ rows }: { rows: SleepProgressRow[] }) {
  const { t } = useTranslation("sleepInsights");
  return (
    <Card className="space-y-4 p-5">
      <p className="text-sm font-bold text-tidur-ink">{t("ui.progress")}</p>
      {rows.map((row) => {
        const have = Math.min(row.have, row.need);
        return (
          <div key={row.id}>
            <p className="text-sm leading-snug">{row.text}</p>
            <div className="mt-2 flex items-center gap-3">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={row.need}
                aria-valuenow={have}
                className="h-2 flex-1 overflow-hidden rounded-full bg-tidur-soft"
              >
                <div
                  className="h-full rounded-full bg-tidur"
                  style={{ width: `${row.need > 0 ? (have / row.need) * 100 : 0}%` }}
                />
              </div>
              <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                {have}/{row.need}
              </span>
            </div>
          </div>
        );
      })}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-20">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-base font-bold tabular-nums">{value}</dd>
    </div>
  );
}

function LastNightCard({
  night,
  regularity,
}: {
  night: SleepLastNight | null;
  regularity: SleepInsightsView["regularity"];
}) {
  const { t } = useTranslation("sleepInsights");
  if (!night && !regularity) return null;
  return (
    <Card className="p-5">
      {night ? (
        <>
          <p className="text-sm font-bold text-tidur-ink">
            {t("ui.lastNight")} · {fmtDateShort(night.wakeDate)}
          </p>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
            <Stat label={t("ui.asleep")} value={duration(t, night.asleepMin)} />
            <Stat label={t("ui.awake")} value={duration(t, night.awakeMin)} />
            <Stat label={t("ui.awakenings")} value={String(night.awakenings)} />
            {night.hasStages && night.deepMin !== null ? (
              <Stat label={t("ui.deep")} value={duration(t, night.deepMin)} />
            ) : null}
            {night.hasStages && night.remMin !== null ? (
              <Stat label={t("ui.rem")} value={duration(t, night.remMin)} />
            ) : null}
            {night.hrvMs !== null ? (
              <Stat label={t("ui.hrv")} value={`${Math.round(night.hrvMs)} ms`} />
            ) : null}
            {night.rhrBpm !== null ? (
              <Stat label={t("ui.rhr")} value={`${Math.round(night.rhrBpm)} bpm`} />
            ) : null}
            {night.room ? (
              <Stat
                label={t("ui.room")}
                value={t("ui.roomValue", { temp: Math.round(night.room.tempC), rh: Math.round(night.room.rhPct) })}
              />
            ) : null}
          </dl>
        </>
      ) : null}
      {regularity ? (
        <div className={cn(night && "mt-4 border-t border-border pt-4")}>
          <p className="text-sm font-bold text-tidur-ink">{t("ui.regularity")}</p>
          <p className="mt-1 text-sm">
            {t("ui.regularitySd", { minutes: Math.round(regularity.sdMin) })}
          </p>
        </div>
      ) : null}
    </Card>
  );
}

function LockedTeaser({ count }: { count: number }) {
  const { t } = useTranslation("sleepInsights");
  return (
    <Card className="p-5">
      <p className="text-[0.9375rem] leading-relaxed">{t("ui.lockedTeaser", { count })}</p>
      <Button
        variant="ghost"
        className="-ml-5 mt-1 min-h-11 text-primary"
        render={<Link to="/pro" search={{ from: "banner", next: "/tidur" }} />}
      >
        {t("ui.lockedCta")}
      </Button>
    </Card>
  );
}

function EnabledSection({ view }: { view: SleepInsightsView }) {
  const { t } = useTranslation("sleepInsights");
  const { dismiss } = useSleepSettings();
  const cards = view.cards.slice(0, 3);
  const nightsRow = view.progress.find((row) => row.id === "nights");
  const teaser = view.personal === "locked" && view.lockedCount > 0;
  const showEmpty = cards.length === 0 && view.progress.length === 0 && !teaser && !nightsRow;
  return (
    <div className="space-y-3">
      {view.personal === "needs_nights" && nightsRow ? (
        <p className="px-1 text-sm text-muted-foreground">
          {t("ui.needsNights", {
            need: Math.max(0, nightsRow.need - nightsRow.have),
            have: nightsRow.have,
          })}
        </p>
      ) : null}
      {cards.map((card) => (
        <InsightCard
          key={card.id}
          card={card}
          busy={dismiss.isPending}
          onDismiss={() => dismiss.mutate({ id: card.id })}
        />
      ))}
      {teaser ? <LockedTeaser count={view.lockedCount} /> : null}
      {view.progress.length > 0 ? <ProgressRows rows={view.progress} /> : null}
      <LastNightCard night={view.lastNight} regularity={view.regularity} />
      {showEmpty ? <p className="px-1 text-sm text-muted-foreground">{t("ui.empty")}</p> : null}
    </div>
  );
}

/** 'Wawasan tidur' on the Tidur screen: enable card, or cards + progress + last night + regularity. */
export function SleepInsightsSection() {
  const { t } = useTranslation("sleepInsights");
  const [consentOpen, setConsentOpen] = useState(false);
  const statusQuery = useSleepStatus();
  const status: SleepInsightsStatus | undefined = statusQuery.data;
  const viewQuery = useSleepView(status?.enabled === true);

  let body;
  if (statusQuery.isPending) {
    body = <Skeleton className="h-36 rounded-3xl" />;
  } else if (!status) {
    body = (
      <ErrorNote
        message={statusQuery.error?.message ?? ""}
        onRetry={() => statusQuery.refetch()}
      />
    );
  } else if (!status.enabled) {
    body = (
      <Card className="p-5">
        <p className="text-sm font-bold text-tidur-ink">{t("ui.off.title")}</p>
        <p className="mt-1 text-[0.9375rem] leading-relaxed">{t("ui.off.body")}</p>
        <Button className="mt-3 min-h-11" onClick={() => setConsentOpen(true)}>
          {t("ui.off.enable")}
        </Button>
        <SleepConsentSheet open={consentOpen} onOpenChange={setConsentOpen} status={status} />
      </Card>
    );
  } else if (viewQuery.isError) {
    body = <ErrorNote message={viewQuery.error.message} onRetry={() => viewQuery.refetch()} />;
  } else if (viewQuery.data) {
    body = <EnabledSection view={viewQuery.data} />;
  } else {
    body = <Skeleton className="h-36 rounded-3xl" />;
  }

  return (
    <section aria-label={t("title")} className="mt-6">
      <SectionTitle>{t("title")}</SectionTitle>
      {body}
    </section>
  );
}
