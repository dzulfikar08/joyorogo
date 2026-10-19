import { ENERGY_SOURCES } from "@joyorogo/api/lib/energy-sources";
import { ACTIVITY_LEVELS, computeTargets } from "@joyorogo/api/lib/engine";
import type { ActivityLevel } from "@joyorogo/api/lib/engine";
import { DEFAULT_ADD_BACK_SETTINGS, exerciseCredit } from "@joyorogo/api/lib/exercise-credit";
import { STEP_LEVEL_BOUNDS } from "@joyorogo/api/lib/activity-guide";
import { Button } from "@joyorogo/ui/components/button";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";

import { BarRows, CreditDiagram, Swatch, TdeeStackedBar } from "@/components/kalori-diagrams";
import type { CreditDay } from "@/components/kalori-diagrams";
import { PublicFooter } from "@/components/public-footer";
import { PublicHeader } from "@/components/public-header";
import { fmtFactor, fmtInt } from "@/lib/format";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/panduan/kalori")({
  component: PanduanKaloriPage,
  head: () => pageHead("/panduan/kalori"),
});

// The worked example is computed by the same engine the app uses, on a fixed day, so the page never drifts from it.
const EXAMPLE_TODAY = "2026-10-19";
const EXAMPLE = {
  birthYear: 2000, // 26 on EXAMPLE_TODAY
  gender: "male" as const,
  heightCm: 171.5,
  weightKg: 107.7,
  targetWeightKg: 78,
  targetDate: "2027-06-04",
};
/** The level the stacked bar and the credit diagram are drawn for. */
const DEMO_LEVEL: ActivityLevel = "light";

const plans = ACTIVITY_LEVELS.map((level) => ({
  level,
  targets: computeTargets({ ...EXAMPLE, activityLevel: level }, { today: EXAMPLE_TODAY }),
}));
const demo = plans.find((plan) => plan.level === DEMO_LEVEL)!.targets;
const OLD_TARGET = computeTargets({ ...EXAMPLE, activityLevel: DEMO_LEVEL }, { today: EXAMPLE_TODAY, activityFactor: 1 }).eatKcal;
const FLOOR_KCAL = 1500;

/** What a day of `measuredKcal` all-day activity adds for the demo person, by the real credit function. */
const addedOn = (measuredKcal: number) =>
  exerciseCredit({
    settings: DEFAULT_ADD_BACK_SETTINGS,
    rows: [],
    readings: [{ source: "health_connect", kcal: measuredKcal }],
    steps: null,
    includedKcal: demo.includedKcal,
  }).countedKcal;

const SECTIONS = ["why", "formula", "levels", "credit", "recommend", "example", "sources"] as const;
const STEP_ROWS = ["r1", "r2", "r3", "r4", "r5"] as const;

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 rounded-3xl bg-card p-5">
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

const P = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-3 text-sm leading-relaxed">{children}</p>
);

const Caption = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{children}</p>
);

function PanduanKaloriPage() {
  const { t } = useTranslation(["kalori", "energy", "common"]);
  const levelName = (level: ActivityLevel) => t(`energy:levels.${level}.name`);
  const demoName = levelName(DEMO_LEVEL);
  const tef = Math.round(demo.tdee * 0.1);
  const move = demo.tdee - demo.bmr - tef;
  const cap = DEFAULT_ADD_BACK_SETTINGS.cap;
  const capText = cap === "none" ? "" : fmtInt(cap);

  const dayKcal = [10, 700, 1500] as const;
  const dayKeys = ["desk", "normal", "busy"] as const;
  const creditDays: [CreditDay, CreditDay, CreditDay] = dayKeys.map((key, i): CreditDay => {
    const added = addedOn(dayKcal[i]!);
    return {
      key,
      label: t(`kalori:credit.days.${key}`),
      measuredKcal: dayKcal[i]!,
      measuredText: t("kalori:credit.measured", { kcal: fmtInt(dayKcal[i]!) }),
      addedText: added > 0 ? t("kalori:credit.added", { kcal: fmtInt(added) }) : t("kalori:credit.none"),
    };
  }) as [CreditDay, CreditDay, CreditDay];

  return (
    <div className="min-h-svh">
      <PublicHeader />
      <main className="mx-auto w-full max-w-2xl px-4 py-8 md:px-6 md:py-12">
        <header>
          <h1 className="text-3xl font-extrabold tracking-tight text-balance md:text-4xl">{t("kalori:title")}</h1>
          <p className="mt-2 text-muted-foreground">{t("kalori:subtitle")}</p>
        </header>

        <nav aria-label={t("kalori:toc")} className="mt-6 rounded-3xl bg-card p-5">
          <p className="text-[0.6875rem] font-bold tracking-[0.14em] text-muted-foreground uppercase">
            {t("kalori:toc")}
          </p>
          <ul className="mt-2 grid gap-x-4 sm:grid-cols-2">
            {SECTIONS.map((id) => (
              <li key={id}>
                <a href={`#${id}`} className="inline-flex min-h-11 items-center text-sm font-semibold hover:text-primary">
                  {t(`kalori:${id}.title`)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-6 space-y-3">
          <Section id="why" title={t("kalori:why.title")}>
            <P>{t("kalori:why.p1")}</P>
            <P>{t("kalori:why.p2")}</P>
            <P>{t("kalori:why.p3")}</P>
          </Section>

          <Section id="formula" title={t("kalori:formula.title")}>
            <P>{t("kalori:formula.p1")}</P>
            <P>{t("kalori:formula.p2")}</P>
            <div className="mt-4 rounded-2xl bg-muted p-4">
              <TdeeStackedBar
                bmr={demo.bmr}
                move={move}
                tef={tef}
                label={t("kalori:formula.chartLabel", {
                  bmr: fmtInt(demo.bmr),
                  move: fmtInt(move),
                  tef: fmtInt(tef),
                  tdee: fmtInt(demo.tdee),
                })}
              />
              <ul className="mt-3 space-y-1.5 text-xs leading-relaxed">
                {(
                  [
                    ["bmr", "bg-chart-1", demo.bmr],
                    ["move", "bg-chart-2", move],
                    ["tef", "bg-chart-3", tef],
                  ] as const
                ).map(([key, swatch, kcal]) => (
                  <li key={key} className="flex gap-2">
                    <Swatch className={swatch} />
                    <span className="min-w-0 flex-1">{t(`kalori:formula.${key}`)}</span>
                    <span className="shrink-0 font-bold tabular-nums">{fmtInt(kcal)}</span>
                  </li>
                ))}
                <li className="flex gap-2 border-t border-border pt-1.5 font-bold">
                  <span className="mt-1 size-3 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">{t("kalori:formula.total")}</span>
                  <span className="shrink-0 tabular-nums">{fmtInt(demo.tdee)}</span>
                </li>
              </ul>
            </div>
            <Caption>
              {t("kalori:formula.chart", { level: demoName, factor: fmtFactor(demo.factor) })}
            </Caption>
          </Section>

          <Section id="levels" title={t("kalori:levels.title")}>
            <P>{t("kalori:levels.intro")}</P>
            <ul className="mt-4 space-y-2">
              {plans.map(({ level, targets }) => (
                <li key={level} className="rounded-2xl bg-muted p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="min-w-0 text-sm font-bold">{levelName(level)}</h3>
                    <span className="shrink-0 text-xs font-bold text-muted-foreground tabular-nums">
                      {t("energy:factor", { factor: fmtFactor(targets.factor) })}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed">{t(`energy:levels.${level}.desc`)}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {t(`energy:levels.${level}.example`)}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-4 rounded-2xl bg-makan-soft p-4 text-sm leading-relaxed font-medium text-makan-ink">
              {t("energy:pickRule")}
            </p>
            <P>{t("kalori:levels.tip")}</P>
            <div className="mt-4 rounded-2xl bg-muted p-4">
              <BarRows
                label={t("kalori:levels.chartLabel")}
                rows={plans.map(({ level, targets }) => ({
                  key: level,
                  label: `${levelName(level)} · ${fmtFactor(targets.factor)}`,
                  value: `${fmtInt(targets.tdee)}`,
                  kcal: targets.tdee,
                  solidKcal: targets.bmr,
                }))}
              />
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <li className="flex items-center gap-1.5">
                  <Swatch className="bg-chart-1" />
                  {t("kalori:levels.bmrLegend")}
                </li>
                <li className="flex items-center gap-1.5">
                  <Swatch className="bg-chart-2" />
                  {t("kalori:levels.restLegend")}
                </li>
              </ul>
            </div>
            <Caption>{t("kalori:levels.chart")}</Caption>
          </Section>

          <Section id="credit" title={t("kalori:credit.title")}>
            <P>{t("kalori:credit.p1")}</P>
            <P>{t("kalori:credit.p2", { level: demoName, included: fmtInt(demo.includedKcal) })}</P>
            <P>
              {t("kalori:credit.p3", {
                pct: DEFAULT_ADD_BACK_SETTINGS.pct,
                cap: capText,
              })}
            </P>
            <div className="mt-4 rounded-2xl bg-muted p-4">
              <CreditDiagram
                days={creditDays}
                includedKcal={demo.includedKcal}
                label={t("kalori:credit.chartLabel", {
                  a: dayKcal[0],
                  b: dayKcal[1],
                  c: dayKcal[2],
                  included: demo.includedKcal,
                })}
              />
              <ul className="mt-3 space-y-1.5 text-xs leading-relaxed">
                <li className="flex gap-2">
                  <Swatch className="bg-muted-foreground/35" />
                  <span>{t("kalori:credit.legendBelow")}</span>
                </li>
                <li className="flex gap-2">
                  <Swatch className="bg-chart-1" />
                  <span>{t("kalori:credit.legendAbove")}</span>
                </li>
                <li className="flex gap-2">
                  <span aria-hidden className="mt-1.5 inline-block h-0 w-3 shrink-0 border-t-2 border-dashed border-foreground" />
                  <span>
                    {t("kalori:credit.line")}: {fmtInt(demo.includedKcal)}
                  </span>
                </li>
              </ul>
            </div>
            <Caption>
              {t("kalori:credit.chart", { level: demoName, included: fmtInt(demo.includedKcal) })}
            </Caption>
            <h3 className="mt-5 text-sm font-bold">{t("kalori:credit.deskTitle")}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t("kalori:credit.deskBody")}</p>
          </Section>

          <Section id="recommend" title={t("kalori:recommend.title")}>
            <P>{t("kalori:recommend.intro")}</P>
            <h3 className="mt-4 text-sm font-bold">{t("kalori:recommend.stepsTitle")}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t("kalori:recommend.stepsBody")}</p>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-3 font-semibold">{t("kalori:recommend.stepsHeader.steps")}</th>
                  <th className="py-1.5 font-semibold">{t("kalori:recommend.stepsHeader.level")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {STEP_ROWS.map((row, i) => (
                  <tr key={row}>
                    <td className="py-2 pr-3 tabular-nums">{t(`kalori:recommend.stepsRows.${row}`)}</td>
                    <td className="py-2 font-semibold">{levelName(STEP_LEVEL_BOUNDS[i]!.level)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3 className="mt-5 text-sm font-bold">{t("kalori:recommend.trendTitle")}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t("kalori:recommend.trendBody")}</p>
            <Caption>{t("kalori:recommend.trendNote")}</Caption>
          </Section>

          <Section id="example" title={t("kalori:example.title")}>
            <P>
              {t("kalori:example.intro", {
                bmr: fmtInt(demo.bmr),
                raw: fmtInt(demo.rawDeficitKcal),
                deficit: fmtInt(demo.deficitKcal),
              })}
            </P>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-2 font-semibold">{t("kalori:example.level")}</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">{t("kalori:example.factor")}</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">{t("kalori:example.tdee")}</th>
                  <th className="py-1.5 text-right font-semibold">{t("kalori:example.target")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {plans.map(({ level, targets }) => (
                  <tr key={level}>
                    <td className="py-2 pr-2 font-semibold">{levelName(level)}</td>
                    <td className="py-2 pr-2 text-right">{fmtFactor(targets.factor)}</td>
                    <td className="py-2 pr-2 text-right">{fmtInt(targets.tdee)}</td>
                    <td className="py-2 text-right font-bold">{fmtInt(targets.eatKcal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 rounded-2xl bg-muted p-4">
              <BarRows
                label={t("kalori:example.chartLabel")}
                rows={plans.map(({ level, targets }) => ({
                  key: level,
                  label: levelName(level),
                  value: fmtInt(targets.eatKcal),
                  kcal: targets.eatKcal,
                }))}
              />
            </div>
            <Caption>{t("kalori:example.chart")}</Caption>
            <P>{t("kalori:example.floorNote", { floor: fmtInt(FLOOR_KCAL) })}</P>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("kalori:example.oldNote", { old: fmtInt(OLD_TARGET) })}
            </p>
            <div className="mt-5 rounded-2xl bg-makan-soft p-4">
              <p className="text-sm font-bold text-makan-ink">{t("kalori:cta.title")}</p>
              <p className="mt-1 text-sm leading-relaxed text-makan-ink/85">{t("kalori:cta.body")}</p>
              <Button
                size="sm"
                className="mt-3 min-h-11"
                render={<Link to="/profil/target" search={{}} hash="activity-level" />}
              >
                {t("kalori:cta.action")}
              </Button>
            </div>
          </Section>

          <Section id="sources" title={t("kalori:sources.title")}>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t("kalori:sources.intro")}</p>
            <ol className="mt-3 divide-y divide-border">
              {ENERGY_SOURCES.map((source) => (
                <li key={source.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-sm leading-relaxed font-semibold break-words">
                    {t(`energy:sources.items.${source.id}.ref`)}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {t(`energy:sources.items.${source.id}.use`)}
                  </p>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                  >
                    {t("energy:sources.open")}
                    <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                </li>
              ))}
            </ol>
          </Section>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
