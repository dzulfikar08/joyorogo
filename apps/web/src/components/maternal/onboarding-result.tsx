import { Baby, Beef, Utensils } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { Targets } from "@joyorogo/api/lib/engine";
import type { MaternalInfo } from "@joyorogo/api/lib/maternal";

import { StatTile } from "@/components/kit/surface";
import { fmtInt } from "@/lib/format";
import { MaternalDisclaimer } from "./disclaimer";
import { MaternalFlagNotes } from "./flag-notes";
import { useMaternalStageLine } from "./use-maternal";

/** Onboarding result for Hamil / Menyusui: the need (base + AKG addition), protein, stage and the disclaimer. */
export function MaternalOnboardingResult({ targets, info }: { targets: Targets; info: MaternalInfo }) {
  const { t } = useTranslation(["maternal", "common"]);
  const stageLine = useMaternalStageLine();
  const protein = info.nutrients.find((n) => n.key === "protein");
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 rounded-2xl bg-makan-soft px-4 py-3 text-[0.9375rem] font-bold text-makan-ink">
        <Baby className="size-5 shrink-0" aria-hidden />
        {stageLine(info)}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <StatTile
          metric="makan"
          icon={<Utensils className="size-[1.125rem]" aria-hidden />}
          label={t("maternal:target.total")}
          value={fmtInt(targets.eatKcal)}
          unit={t("maternal:target.kcal")}
          sub={`${t("maternal:target.base")} ${fmtInt(info.baseKcal)} + ${t("maternal:target.add")} ${fmtInt(info.addKcal)}`}
        />
        {protein && (
          <StatTile
            metric="bakar"
            icon={<Beef className="size-[1.125rem]" aria-hidden />}
            label={t("maternal:nutrients.protein.name")}
            value={fmtInt(protein.target)}
            unit={t(`maternal:nutrients.unit.${protein.unit}`)}
            sub={t("maternal:nutrients.base", { base: `${fmtInt(protein.base)} g` })}
          />
        )}
      </div>
      <p className="px-1 text-sm leading-relaxed text-muted-foreground">{t("maternal:target.noDeficit")}</p>
      <MaternalFlagNotes info={info} />
      <MaternalDisclaimer />
    </div>
  );
}
