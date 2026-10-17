import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Wallet } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/kit/surface";
import { MetaLine } from "@/components/meta-line";
import { fmtRupiah } from "@/lib/app-config";
import { fmtGramsLabel, fmtIdr, fmtNumber } from "@joyorogo/i18n";
import { orpc } from "@/utils/orpc";

const spendingOptions = orpc.plate.spending.queryOptions();
const bestValueOptions = orpc.plate.bestValue.queryOptions();

/**
 * "Belanja makan": totals for today/week/month, what is left of the budget
 * (next to the kcal the home screen already shows), and the best-value plates
 * the user actually paid for. `variant="line"` renders the compact Beranda
 * version; the default renders the full Makan page section.
 */
export function BelanjaCard({ variant = "full" }: { variant?: "full" | "line" }) {
  const { t } = useTranslation(["makan", "common"]);
  const spending = useQuery(spendingOptions);
  const bestValue = useQuery(bestValueOptions);
  // Full section is a long list; collapsed by default, header keeps today's total.
  const [open, setOpen] = useState(false);

  if (spending.isPending || bestValue.isPending) return null;
  if (spending.error || bestValue.error) return null;

  const { today, week, month, budget } = spending.data;
  const priced = bestValue.data.length > 0;

  if (variant === "line") {
    // Nothing to say until a price exists — keep Beranda quiet then.
    if (today === 0 && week === 0 && !budget) return null;
    return (
      <div className="mt-3 flex items-center gap-3 rounded-3xl bg-card px-5 py-3 text-sm">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-makan-soft">
          <Wallet className="size-4 text-makan-ink" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold">
            {t("plate.belanja.todayLine", { amount: fmtRupiah(today) })}
          </span>
          <span className="block text-xs text-muted-foreground">
            {budget
              ? t(`plate.belanja.budgetLeft.${budget.period}`, {
                  amount: fmtRupiah(budget.remaining ?? 0),
                })
              : t("plate.belanja.weekMeta", { amount: fmtRupiah(week) })}
          </span>
        </span>
      </div>
    );
  }

  return (
    <section className="mt-7" aria-label={t("plate.belanja.title")}>
      <Card className="px-5 py-4">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="belanja-detail"
          onClick={() => setOpen((v) => !v)}
          className="-mx-2 -my-1 flex w-[calc(100%+1rem)] items-center gap-3 rounded-2xl px-2 py-1 text-left focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-makan-soft">
            <Wallet className="size-4 text-makan-ink" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[0.9375rem] font-bold">{t("plate.belanja.title")}</span>
            <span className="block text-xs text-muted-foreground tabular-nums">
              <MetaLine
                items={[
                  t("plate.belanja.todayMeta", { amount: fmtRupiah(today) }),
                  budget
                    ? t(`plate.belanja.leftMeta.${budget.period}`, {
                        amount: fmtRupiah(budget.remaining ?? 0),
                      })
                    : t("plate.belanja.weekMeta", { amount: fmtRupiah(week) }),
                ]}
              />
            </span>
          </span>
          <ChevronDown
            className={`size-5 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>
        {open && (
          <div id="belanja-detail" className="mt-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-xs font-semibold text-muted-foreground">{t("common:date.today")}</p>
                <p className="text-base font-extrabold tabular-nums">{fmtRupiah(today)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground">
                  {t("plate.belanja.thisWeek")}
                </p>
                <p className="text-base font-extrabold tabular-nums">{fmtRupiah(week)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground">
                  {t("plate.belanja.thisMonth")}
                </p>
                <p className="text-base font-extrabold tabular-nums">{fmtRupiah(month)}</p>
              </div>
            </div>
            {budget && (
              <p
                className={`mt-3 rounded-2xl px-4 py-2 text-sm font-semibold ${
                  budget.remaining != null && budget.remaining < 0
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {t(`plate.belanja.budgetLeft.${budget.period}`, {
                  amount: fmtRupiah(budget.remaining ?? 0),
                })}
              </p>
            )}
            {priced && (
              <div className="mt-4">
                <p className="text-sm font-bold">{t("plate.belanja.bestValue")}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("plate.belanja.bestValueHint", { price: fmtIdr(1000) })}
                </p>
                <ul className="mt-2 space-y-1.5">
                  {bestValue.data.slice(0, 3).map((entry) => (
                    <li
                      key={entry.key}
                      className="flex items-baseline justify-between gap-3 rounded-2xl bg-muted px-4 py-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate font-semibold">{entry.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        <MetaLine
                          items={[
                            fmtRupiah(entry.priceIdr),
                            t("plate.belanja.proteinOf", {
                              g: fmtGramsLabel(entry.nutrients.proteinG),
                            }),
                            t("plate.belanja.perPrice", {
                              g: `${fmtNumber(entry.proteinPer1000, 1)} g`,
                              price: fmtIdr(1000),
                            }),
                          ]}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!priced && (
              <p className="mt-3 text-xs text-muted-foreground">
                {t("plate.belanja.empty")}
              </p>
            )}
          </div>
        )}
      </Card>
    </section>
  );
}
