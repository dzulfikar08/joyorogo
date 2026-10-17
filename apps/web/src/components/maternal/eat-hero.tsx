import { Link } from "@tanstack/react-router";
import { CircleHelp } from "lucide-react";
import { useTranslation } from "react-i18next";

import { CountUp } from "@/components/kit/count-up";
import { Ring } from "@/components/kit/ring";
import { Card } from "@/components/kit/surface";
import type { DaySummary } from "@/lib/api-types";
import { fmtInt } from "@/lib/format";

/**
 * "Kebutuhanmu hari ini": the Beranda ring for Hamil / Menyusui. Progress
 * toward a need, never a remaining budget: no "Sisa", no over-target tone.
 */
export function MaternalEatHero({ summary }: { summary: DaySummary }) {
  const { t } = useTranslation(["maternal", "home"]);
  const target = summary.targets.eatKcal;
  const eaten = summary.eatenKcal;
  const pct = target > 0 ? Math.round((eaten / target) * 100) : 0;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-4">
        <Ring
          metric="makan"
          value={eaten}
          max={target}
          size={132}
          stroke={12}
          label={t("maternal:target.ofTarget", { eaten: fmtInt(eaten), target: fmtInt(target) })}
        >
          <div>
            <p className="text-[2.25rem] leading-none font-extrabold tracking-tighter tabular-nums">
              <CountUp value={eaten} />
            </p>
            <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
              {t("maternal:target.kcal")}
            </p>
          </div>
        </Ring>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{t("maternal:target.title")}</p>
          <p className="mt-1 text-lg font-extrabold tabular-nums">
            <CountUp value={target} />
            <span className="ml-1 text-xs font-semibold text-muted-foreground">
              {t("maternal:target.kcal")}
            </span>
          </p>
          <p className="text-xs font-semibold text-muted-foreground tabular-nums">
            {t("maternal:target.progress", { pct })}
          </p>
          <div className="-mr-2.5 -mb-2.5 mt-1 flex justify-end">
            <Link
              to="/profil"
              search={{ needs: true }}
              aria-label={t("home:eat.help")}
              className="flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              <CircleHelp className="size-5" aria-hidden />
            </Link>
          </div>
        </div>
      </div>
      {eaten >= target && target > 0 && (
        <p className="mt-2 text-sm leading-snug font-semibold text-makan-ink">
          {t("maternal:target.reached")}
        </p>
      )}
    </Card>
  );
}
