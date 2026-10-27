import { PRIORITY_SUPPORT, PRO_BENEFIT_GROUPS } from "@joyorogo/i18n";
import type { Locale, ProBenefit, ProBenefitGroup } from "@joyorogo/i18n";
import { cn } from "@joyorogo/ui/lib/utils";
import type { ParseKeys, TOptions } from "i18next";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";

/** The Pro benefit text in one language: `t` is the pinned `billing` translator, `text` one benefit's line. */
export interface ProBenefitsText {
  t: (key: ParseKeys<"billing">, options?: TOptions) => string;
  groupTitle: (group: ProBenefitGroup) => string;
  /** `founderDailyCap` is the live /api/config cap, null when Pro scans are unlimited. */
  text: (item: ProBenefit, founderDailyCap: number | null) => string;
}

/**
 * Text of the shared Pro benefit list (`PRO_BENEFIT_GROUPS` in @joyorogo/i18n) in one language. `lng` pins it
 * (the Indonesian pages stay Indonesian whatever the UI language is, /my Malay, /sg and the USD plans English);
 * without it the UI language wins.
 */
export function useProBenefits(lng?: Locale): ProBenefitsText {
  const { t } = useTranslation("billing");
  const tl = (key: ParseKeys<"billing">, options?: TOptions): string =>
    t(key, { ...options, lng }) as string;
  return {
    t: tl,
    groupTitle: (group) => tl(`pro.groups.${group}`),
    text: (item, founderDailyCap) => {
      if (item === "scans") {
        return founderDailyCap === null
          ? tl("benefits.scansUnlimited")
          : tl("benefits.scansCapped", { count: founderDailyCap });
      }
      if (item === "support") return tl("pro.items.support", { count: PRIORITY_SUPPORT.replyWorkdays });
      return tl(`pro.items.${item}`);
    },
  };
}

/**
 * The Pro benefits, grouped, as checked lists under small group headings. `exclude` drops items a page already shows
 * in its own words (the /my and /sg pricing say "foto AI" / "AI photos" where the shared list says "imbasan AI" /
 * "AI scans").
 */
export function ProBenefitGroups({
  founderDailyCap,
  lng,
  tone = "primary",
  exclude = [],
  className,
}: {
  founderDailyCap: number | null;
  lng?: Locale;
  tone?: "primary" | "makan";
  exclude?: readonly ProBenefit[];
  className?: string;
}) {
  const benefits = useProBenefits(lng);
  return (
    <div className={cn("space-y-4", className)}>
      {PRO_BENEFIT_GROUPS.map((group) => {
        const items = group.items.filter((item) => !exclude.includes(item));
        if (items.length === 0) return null;
        return (
          <section key={group.id} aria-label={benefits.groupTitle(group.id)}>
            <h3 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
              {benefits.groupTitle(group.id)}
            </h3>
            <ul className="mt-1.5 space-y-1.5">
              {items.map((item) => (
                <li key={item} className="flex gap-2.5 text-sm leading-snug">
                  <Check
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      tone === "makan" ? "text-makan-ink" : "text-primary",
                    )}
                    aria-hidden
                  />
                  <span>{benefits.text(item, founderDailyCap)}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
