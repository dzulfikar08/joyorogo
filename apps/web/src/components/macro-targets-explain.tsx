import { useTranslation } from "react-i18next";

import { fmtInt } from "@/lib/format";
import { MACRO_META, type MacroKey } from "@/lib/macro-icons";

export type MacroTargetValues = {
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
};

/**
 * How each macro target is set, with today's numbers. Shown in Beranda's "Cara baca angka ini" sheet and behind the (i)
 * on Makan's day summary, so both read the same text. The rules mirror `macroGoals` in packages/api/src/lib/plan.ts.
 */
export function MacroTargetsExplain({ targets, gain }: { targets: MacroTargetValues; gain: boolean }) {
  const { t } = useTranslation("home");
  const rows: Array<{
    macro: MacroKey;
    g: number | null;
    text:
      | "explain.macros.protein"
      | "explain.macros.proteinGain"
      | "explain.macros.fat"
      | "explain.macros.carbs"
      | "explain.macros.fiber";
  }> = [
    {
      macro: "protein",
      g: targets.proteinG,
      text: gain ? "explain.macros.proteinGain" : "explain.macros.protein",
    },
    { macro: "fat", g: targets.fatG, text: "explain.macros.fat" },
    { macro: "carbs", g: targets.carbsG, text: "explain.macros.carbs" },
    { macro: "fiber", g: targets.fiberG, text: "explain.macros.fiber" },
  ];
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-bold">{t("explain.macros.title")}</p>
      <p className="text-sm leading-relaxed text-muted-foreground">{t("explain.macros.intro")}</p>
      {rows.map(({ macro, g, text }) => {
        if (g === null) return null;
        const { Icon, tone } = MACRO_META[macro];
        return (
          <div key={macro} className="flex items-start gap-2">
            <Icon className={`mt-1 size-3.5 shrink-0 ${tone}`} aria-hidden />
            <p className="text-sm leading-relaxed text-muted-foreground">{t(text, { g: fmtInt(g) })}</p>
          </div>
        );
      })}
      <p className="text-sm leading-relaxed text-muted-foreground">
        {gain ? t("explain.macros.overGain") : t("explain.macros.over")}
      </p>
    </div>
  );
}
