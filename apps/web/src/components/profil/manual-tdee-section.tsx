import { Calculator } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { Targets } from "@joyorogo/api/lib/engine";

import { Card, IconChip, SectionTitle } from "@/components/kit/surface";
import { ManualTdeeForm, ManualTdeeSuggestionCard } from "@/components/manual-tdee";
import { fmtInt } from "@/lib/format";

const note = "text-sm leading-relaxed text-muted-foreground";

/** Pakai TDEE sendiri: type your own maintenance kcal; the goal pace and floors stay on top of it. */
export function ManualTdeeSection({ targets }: { targets: Targets }) {
  const { t } = useTranslation("energy");
  const info = targets.manualTdee;
  if (!info) return null;
  return (
    <section id="tdee-sendiri" className="scroll-mt-4">
      <SectionTitle className="mt-7">{t("manual.title")}</SectionTitle>
      <Card className="space-y-4">
        <div className="flex items-start gap-3">
          <IconChip tone="makan">
            <Calculator />
          </IconChip>
          <p className={`min-w-0 flex-1 ${note}`}>{t("manual.subtitle")}</p>
        </div>
        {info.kcal !== null && (
          <div className="rounded-2xl bg-muted px-4 py-3">
            <p className="text-sm leading-relaxed font-semibold tabular-nums">
              {t("manual.active", { kcal: fmtInt(info.kcal) })}
            </p>
            <p className={`mt-1 ${note}`}>{t("manual.activeCalibration")}</p>
          </div>
        )}
        <ManualTdeeForm
          // a new key re-seeds the draft after a save, a reset or a "Pakai angka ini"
          key={info.kcal ?? "auto"}
          info={info}
        />
        <ManualTdeeSuggestionCard info={info} />
      </Card>
    </section>
  );
}
