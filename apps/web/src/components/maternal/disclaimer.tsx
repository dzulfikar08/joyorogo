import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@joyorogo/ui/lib/utils";

/** "Bukan alat medis": the full text in setup and Settings, one line on the dashboard card. */
export function MaternalDisclaimer({
  short = false,
  className,
}: {
  short?: boolean;
  className?: string;
}) {
  const { t } = useTranslation("maternal");
  if (short) {
    return (
      <p className={cn("flex items-start gap-1.5 text-xs leading-snug text-muted-foreground", className)}>
        <Info className="mt-px size-3.5 shrink-0" aria-hidden />
        {t("disclaimer.short")}
      </p>
    );
  }
  return (
    <div className={cn("rounded-2xl bg-muted p-4", className)}>
      <p className="flex items-center gap-1.5 text-sm font-bold">
        <Info className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        {t("disclaimer.title")}
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t("disclaimer.body")}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t("disclaimer.kia")}</p>
    </div>
  );
}
